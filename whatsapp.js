console.log('=== LOADING WHATSAPP MODULE DEPENDENCIES ===');

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

console.log('✓ All dependencies loaded successfully');

// Create sessions directory if it doesn't exist
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// Message store to handle message history and resolve "Waiting for this message"
class MessageStore {
  constructor(merchantId) {
    this.merchantId = merchantId;
    this.messages = new Map(); // messageId -> message data
    this.messagesByJid = new Map(); // jid -> Set of messageIds
    this.maxMessages = 1000; // Limit to prevent memory issues
  }

  storeMessage(message) {
    try {
      const messageId = message.key.id;
      const jid = message.key.remoteJid;
      
      // Store message with key components needed for retrieval
      const messageData = {
        key: message.key,
        message: message.message,
        messageTimestamp: message.messageTimestamp,
        status: message.status || null,
        participant: message.key.participant || null
      };
      
      this.messages.set(messageId, messageData);
      
      // Index by JID for faster lookup
      if (!this.messagesByJid.has(jid)) {
        this.messagesByJid.set(jid, new Set());
      }
      this.messagesByJid.get(jid).add(messageId);
      
      // Cleanup old messages if we exceed limit
      if (this.messages.size > this.maxMessages) {
        this.cleanup();
      }
      
      console.log(`💾 Stored message ${messageId} for ${this.merchantId}`);
    } catch (error) {
      console.error('Error storing message:', error);
    }
  }

  getMessage(key) {
    try {
      const messageId = key.id;
      const storedMessage = this.messages.get(messageId);
      
      if (storedMessage) {
        console.log(`✅ Found message ${messageId} in store for ${this.merchantId}`);
        return storedMessage;
      }
      
      console.log(`❌ Message ${messageId} not found in store for ${this.merchantId}`);
      return undefined;
    } catch (error) {
      console.error('Error retrieving message:', error);
      return undefined;
    }
  }

  cleanup() {
    try {
      // Remove oldest 20% of messages
      const messagesToRemove = Math.floor(this.messages.size * 0.2);
      const messageIds = Array.from(this.messages.keys());
      
      for (let i = 0; i < messagesToRemove; i++) {
        const messageId = messageIds[i];
        const messageData = this.messages.get(messageId);
        
        if (messageData) {
          const jid = messageData.key.remoteJid;
          this.messagesByJid.get(jid)?.delete(messageId);
        }
        
        this.messages.delete(messageId);
      }
      
      console.log(`🧹 Cleaned up ${messagesToRemove} old messages for ${this.merchantId}`);
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

// Global store for message stores by merchantId
global.messageStores = global.messageStores || new Map();

async function createWhatsAppConnection(merchantId) {
  console.log(`=== CREATE WHATSAPP CONNECTION for ${merchantId} ===`);
  
  try {
    console.log(`Creating WhatsApp connection for merchant: ${merchantId}`);
    
    // Initialize message store for this merchant
    const messageStore = new MessageStore(merchantId);
    global.messageStores.set(merchantId, messageStore);
    
    const sessionPath = path.join(sessionsDir, merchantId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      // Configuración para mejor persistencia
      keepAliveIntervalMs: 60000, // 1 minuto
      connectTimeoutMs: 60000, // 1 minuto timeout
      defaultQueryTimeoutMs: 60000,
      // Remove logger to use default Baileys logger
      
      // Enhanced getMessage implementation for resolving "Waiting for this message"
      getMessage: async (key) => {
        console.log(`📨 getMessage called for merchant ${merchantId}, key:`, key);
        try {
          const store = global.messageStores.get(merchantId);
          if (!store) {
            console.log(`❌ No message store found for merchant ${merchantId}`);
            return undefined;
          }
          
          // Try to get message from our store
          const message = store.getMessage(key);
          if (message) {
            console.log(`✅ Retrieved message from store for ${merchantId}`);
            return message;
          }
          
          // Return undefined so Baileys can handle message retrieval
          console.log(`🔄 Message not in store, letting Baileys handle it for ${merchantId}`);
          return undefined;
        } catch (error) {
          console.error(`Error in getMessage for ${merchantId}:`, error);
          return undefined;
        }
      },
      
      // Store para manejar el estado de los mensajes
      msgRetryCounterMap: {},
      
      // Configuración adicional para manejo de mensajes
      shouldIgnoreJid: (jid) => {
        // No ignorar ningún JID por ahora
        return false;
      },
      
      // Manejo de recibos de lectura
      markOnlineOnConnect: true,
      
      // Configuración para evitar problemas de "Waiting for this message"
      generateHighQualityLinkPreview: false,
      patchMessageBeforeSending: (message) => {
        // Patch para asegurar que los mensajes se envíen correctamente
        const requiresPatch = !!(
          message.buttonsMessage ||
          message.templateMessage ||
          message.listMessage
        );
        
        if (requiresPatch) {
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {},
                },
                ...message,
              },
            },
          };
        }
        
        return message;
      }
    });

    // Handle QR code generation
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      console.log(`🔄 Connection update for ${merchantId}:`, {
        connection,
        hasQr: !!qr,
        lastDisconnect: lastDisconnect?.error?.output?.statusCode || 'none'
      });
      
      if (qr) {
        console.log(`📱 QR Code generated for ${merchantId}`);
        try {
          const qrCodeUrl = await QRCode.toDataURL(qr);
          global.qrCodes.set(merchantId, qrCodeUrl);
          
          // Notify Supabase about QR code
          await notifySupabase(merchantId, 'qr_generated', { qrCode: qrCodeUrl });
        } catch (error) {
          console.error('Error generating QR code:', error);
        }
      }
      
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`❌ Connection CLOSED for ${merchantId}:`);
        console.log('- Disconnect reason:', lastDisconnect?.error?.output?.statusCode);
        console.log('- Should reconnect:', shouldReconnect);
        console.log('- Error details:', lastDisconnect?.error);
        
        if (shouldReconnect) {
          console.log(`🔄 Attempting reconnection for ${merchantId} in 3 seconds...`);
          setTimeout(() => createWhatsAppConnection(merchantId), 3000);
        } else {
          console.log(`🚫 Permanently disconnected ${merchantId} - logged out`);
          global.connections.delete(merchantId);
          global.qrCodes.delete(merchantId);
          global.messageStores.delete(merchantId); // Clean up message store
          await notifySupabase(merchantId, 'disconnected');
        }
      } else if (connection === 'open') {
        console.log(`✅ WhatsApp CONNECTED successfully for ${merchantId}`);
        console.log('- User ID:', socket.user?.id);
        console.log('- User name:', socket.user?.name);
        
        const connectionInfo = {
          socket,
          status: 'connected',
          phone: socket.user?.id?.split(':')[0] || null,
          pushName: socket.user?.name || null,
          connectedAt: new Date().toISOString()
        };
        
        global.connections.set(merchantId, connectionInfo);
        global.qrCodes.delete(merchantId);
        
        console.log(`💾 Saved connection info for ${merchantId}:`, {
          phone: connectionInfo.phone,
          pushName: connectionInfo.pushName
        });
        
        // Notify Supabase about successful connection
        await notifySupabase(merchantId, 'connected', {
          phone: connectionInfo.phone,
          pushName: connectionInfo.pushName
        });
      }
    });

    // Handle incoming messages and store them
    socket.ev.on('messages.upsert', async (m) => {
      try {
        const messageStore = global.messageStores.get(merchantId);
        
        for (const message of m.messages) {
          // Store ALL messages (sent and received) for getMessage retrieval
          if (messageStore) {
            messageStore.storeMessage(message);
          }
          
          // Process incoming messages (not sent by us)
          if (!message.key.fromMe && message.message) {
            console.log(`📥 Incoming message for ${merchantId}:`, {
              messageId: message.key.id,
              from: message.key.remoteJid,
              hasMessage: !!message.message
            });
            
            // Forward to Supabase for processing
            await notifySupabase(merchantId, 'message_received', {
              messageId: message.key.id,
              from: message.key.remoteJid,
              text: message.message.conversation || 
                    message.message.extendedTextMessage?.text ||
                    'Non-text message',
              timestamp: message.messageTimestamp
            });
          }
        }
      } catch (error) {
        console.error(`Error processing messages for ${merchantId}:`, error);
      }
    });

    // Handle message status updates (read receipts, delivery, etc.)
    socket.ev.on('messages.update', async (updates) => {
      try {
        const messageStore = global.messageStores.get(merchantId);
        if (!messageStore) return;
        
        for (const update of updates) {
          const existingMessage = messageStore.getMessage(update.key);
          if (existingMessage) {
            // Update message status
            Object.assign(existingMessage, update);
            console.log(`📝 Updated message status for ${merchantId}:`, {
              messageId: update.key.id,
              status: update.status
            });
          }
        }
      } catch (error) {
        console.error(`Error updating message status for ${merchantId}:`, error);
      }
    });

    // Save credentials when updated
    socket.ev.on('creds.update', saveCreds);
    
    return socket;
    
  } catch (error) {
    console.error(`Error creating WhatsApp connection for ${merchantId}:`, error);
    throw error;
  }
}

async function notifySupabase(merchantId, event, data = {}) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn('Supabase credentials not configured');
      return;
    }

    await axios.post(`${supabaseUrl}/functions/v1/whatsapp-webhook`, {
      merchantId,
      event,
      data,
      timestamp: new Date().toISOString()
    }, {
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Notified Supabase: ${event} for ${merchantId}`);
  } catch (error) {
    console.error('Error notifying Supabase:', error.message);
  }
}

async function sendMessage(merchantId, to, message) {
  try {
    const connection = global.connections.get(merchantId);
    
    if (!connection || !connection.socket) {
      throw new Error('WhatsApp not connected for this merchant');
    }
    
    const result = await connection.socket.sendMessage(to, { text: message });
    console.log(`Message sent from ${merchantId} to ${to}`);
    
    return {
      success: true,
      messageId: result.key.id,
      timestamp: result.messageTimestamp
    };
    
  } catch (error) {
    console.error(`Error sending message for ${merchantId}:`, error);
    throw error;
  }
}

module.exports = {
  createWhatsAppConnection,
  sendMessage
};
