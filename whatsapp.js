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

// CRITICAL: Rate limiting store to prevent "Waiting for this message" issue
global.messageSendTimestamps = global.messageSendTimestamps || new Map(); // phone -> timestamp
global.deliveryConfirmations = global.deliveryConfirmations || new Map(); // messageId -> status

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
      
      // Basic configuration for reliable QR generation
      browser: ['WhatsApp Business', 'Desktop', '2.2.24'],
      syncFullHistory: false,
      markOnlineOnConnect: true,
      
      // Simplified logging
      logger: {
        level: 'info',
        log: (level, ...args) => {
          const timestamp = new Date().toISOString();
          console.log(`[${timestamp}] [${merchantId}] [${level.toUpperCase()}]`, ...args);
        }
      },
      
      // Simplified getMessage implementation
      getMessage: async (key) => {
        try {
          const store = global.messageStores.get(merchantId);
          if (!store) {
            console.log(`❌ [${merchantId}] No message store found`);
            return undefined;
          }
          
          const message = store.getMessage(key);
          if (message) {
            console.log(`✅ [${merchantId}] Message retrieved from store: ${key.id}`);
            return message;
          }
          
          console.log(`⚠️ [${merchantId}] Message not found in store: ${key.id}`);
          return undefined;
          
        } catch (error) {
          console.error(`❌ [${merchantId}] Error in getMessage:`, error);
          return undefined;
        }
      }
    });

    // CRITICAL: Add mobile-specific event handlers for reliability
    
    // Handle group metadata updates (for better group message handling)
    socket.ev.on('groups.update', async (updates) => {
      for (const update of updates) {
        console.log(`👥 [${merchantId}] Group update:`, update.id, update);
      }
    });
    
    // Handle participant updates in groups
    socket.ev.on('group-participants.update', async (update) => {
      console.log(`👤 [${merchantId}] Group participant update:`, update);
    });
    
    // CRITICAL: Handle message receipts for mobile reliability tracking
    socket.ev.on('message-receipt.update', async (updates) => {
      for (const update of updates) {
        const messageId = update.key.id;
        const receipt = update.receipt;
        
        console.log(`📨 [${merchantId}] Message receipt:`, {
          messageId,
          receipt,
          timestamp: Date.now()
        });
        
        // PHASE 1: CRITICAL DELIVERY CONFIRMATION UPDATE
        const confirmation = global.deliveryConfirmations.get(messageId);
        if (confirmation) {
          // Update delivery status based on receipt type
          if (receipt?.type === 'delivery' || receipt?.deliveryTimestamp) {
            confirmation.status = 'delivered';
            confirmation.deliveredAt = Date.now();
            console.log(`✅ [${merchantId}] Message ${messageId} DELIVERED`);
          } else if (receipt?.type === 'read' || receipt?.readTimestamp) {
            confirmation.status = 'read';
            confirmation.readAt = Date.now();
            console.log(`👀 [${merchantId}] Message ${messageId} READ`);
          }
          
          global.deliveryConfirmations.set(messageId, confirmation);
        }
      }
    });

    // CRITICAL: Enhanced message handling for mobile reliability
    socket.ev.on('messages.upsert', async (m) => {
      const processingStart = Date.now();
      try {
        const messageStore = global.messageStores.get(merchantId);
        console.log(`📥 [${merchantId}] Processing ${m.messages.length} message(s), type: ${m.type}`);
        
        for (const message of m.messages) {
          const messageStart = Date.now();
          
          // CRITICAL: Store ALL messages immediately for getMessage retrieval
          if (messageStore) {
            messageStore.storeMessage(message);
            console.log(`💾 [${merchantId}] Stored message ${message.key.id} in ${Date.now() - messageStart}ms`);
          }
          
          // CRITICAL: Enhanced incoming message processing
          if (!message.key.fromMe && message.message) {
            const messageInfo = {
              messageId: message.key.id,
              from: message.key.remoteJid,
              timestamp: message.messageTimestamp,
              hasMessage: !!message.message,
              messageType: Object.keys(message.message)[0],
              participant: message.key.participant
            };
            
            console.log(`📨 [${merchantId}] Incoming message:`, messageInfo);
            
            // Extract message text with better handling
            let messageText = 'Non-text message';
            if (message.message.conversation) {
              messageText = message.message.conversation;
            } else if (message.message.extendedTextMessage?.text) {
              messageText = message.message.extendedTextMessage.text;
            } else if (message.message.imageMessage?.caption) {
              messageText = `[Image] ${message.message.imageMessage.caption}`;
            } else if (message.message.videoMessage?.caption) {
              messageText = `[Video] ${message.message.videoMessage.caption}`;
            } else if (message.message.documentMessage?.caption) {
              messageText = `[Document] ${message.message.documentMessage.caption}`;
            }
            
            // CRITICAL: Async notification to avoid blocking message processing
            setImmediate(async () => {
              try {
                await notifySupabase(merchantId, 'message_received', {
                  messageId: message.key.id,
                  from: message.key.remoteJid,
                  text: messageText,
                  timestamp: message.messageTimestamp,
                  messageType: messageInfo.messageType,
                  participant: message.key.participant
                });
              } catch (notifyError) {
                console.error(`❌ [${merchantId}] Error notifying Supabase:`, notifyError);
              }
            });
          }
        }
        
        const totalTime = Date.now() - processingStart;
        console.log(`✅ [${merchantId}] Processed ${m.messages.length} messages in ${totalTime}ms`);
        
      } catch (error) {
        const totalTime = Date.now() - processingStart;
        console.error(`❌ [${merchantId}] Error processing messages after ${totalTime}ms:`, error);
      }
    });

    // CRITICAL: Enhanced message status tracking for mobile
    socket.ev.on('messages.update', async (updates) => {
      try {
        const messageStore = global.messageStores.get(merchantId);
        if (!messageStore) return;
        
        console.log(`📝 [${merchantId}] Processing ${updates.length} message update(s)`);
        
        for (const update of updates) {
          const existingMessage = messageStore.getMessage(update.key);
          if (existingMessage) {
            // CRITICAL: Update message status and track delivery
            Object.assign(existingMessage, update);
            
            const statusInfo = {
              messageId: update.key.id,
              status: update.status,
              timestamp: Date.now()
            };
            
            console.log(`✅ [${merchantId}] Updated message status:`, statusInfo);
            
            // Track important status changes for debugging
            if (update.status === 'ERROR' || update.status === 'PENDING') {
              console.warn(`⚠️ [${merchantId}] Message ${update.key.id} status: ${update.status}`);
            }
          } else {
            console.warn(`⚠️ [${merchantId}] Received update for unknown message: ${update.key.id}`);
          }
        }
      } catch (error) {
        console.error(`❌ [${merchantId}] Error updating message status:`, error);
      }
    });

    // CRITICAL: Handle connection state changes for mobile reliability
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, receivedPendingNotifications } = update;
      
      console.log(`🔄 [${merchantId}] Connection update:`, {
        connection,
        hasQr: !!qr,
        pendingNotifications: receivedPendingNotifications,
        lastDisconnectCode: lastDisconnect?.error?.output?.statusCode || 'none'
      });
      
      // CRITICAL: Handle QR code generation with enhanced logging
      if (qr) {
        console.log(`📱 [${merchantId}] QR Code generated`);
        try {
          const qrCodeUrl = await QRCode.toDataURL(qr);
          global.qrCodes.set(merchantId, qrCodeUrl);
          
          await notifySupabase(merchantId, 'qr_generated', { qrCode: qrCodeUrl });
          console.log(`✅ [${merchantId}] QR code saved and notified`);
        } catch (error) {
          console.error(`❌ [${merchantId}] Error generating QR code:`, error);
        }
      }
      
      // CRITICAL: Enhanced connection close handling for mobile
      if (connection === 'close') {
        const disconnectReason = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = disconnectReason !== DisconnectReason.loggedOut;
        
        console.log(`❌ [${merchantId}] Connection CLOSED:`, {
          reason: disconnectReason,
          shouldReconnect,
          errorDetails: lastDisconnect?.error?.message
        });
        
        if (shouldReconnect) {
          // CRITICAL: Progressive reconnection delay for mobile stability
          const reconnectDelay = disconnectReason === DisconnectReason.connectionClosed ? 1000 : 3000;
          console.log(`🔄 [${merchantId}] Reconnecting in ${reconnectDelay}ms...`);
          
          setTimeout(() => {
            console.log(`🔄 [${merchantId}] Starting reconnection...`);
            createWhatsAppConnection(merchantId).catch(error => {
              console.error(`❌ [${merchantId}] Reconnection failed:`, error);
            });
          }, reconnectDelay);
        } else {
          console.log(`🚫 [${merchantId}] Permanently disconnected - logged out`);
          global.connections.delete(merchantId);
          global.qrCodes.delete(merchantId);
          global.messageStores.delete(merchantId);
          await notifySupabase(merchantId, 'disconnected');
        }
      } 
      // CRITICAL: Enhanced connection open handling
      else if (connection === 'open') {
        console.log(`✅ [${merchantId}] WhatsApp CONNECTED successfully`);
        
        const userInfo = {
          id: socket.user?.id,
          name: socket.user?.name,
          phone: socket.user?.id?.split(':')[0] || null
        };
        
        console.log(`👤 [${merchantId}] User info:`, userInfo);
        
        const connectionInfo = {
          socket,
          status: 'connected',
          phone: userInfo.phone,
          pushName: userInfo.name,
          connectedAt: new Date().toISOString(),
          lastActivity: Date.now()
        };
        
        global.connections.set(merchantId, connectionInfo);
        global.qrCodes.delete(merchantId);
        
        await notifySupabase(merchantId, 'connected', {
          phone: connectionInfo.phone,
          pushName: connectionInfo.pushName
        });
        
        console.log(`💾 [${merchantId}] Connection info saved and notified`);
      }
    });

    // CRITICAL: Enhanced credential management for mobile persistence
    socket.ev.on('creds.update', async () => {
      try {
        console.log(`🔐 [${merchantId}] Credentials updated, saving...`);
        await saveCreds();
        console.log(`✅ [${merchantId}] Credentials saved successfully`);
      } catch (error) {
        console.error(`❌ [${merchantId}] Error saving credentials:`, error);
      }
    });
    
    // CRITICAL: Handle blocking events for mobile app compatibility
    socket.ev.on('blocklist.set', async ({ blocklist }) => {
      console.log(`🚫 [${merchantId}] Blocklist updated:`, blocklist.length, 'contacts');
    });
    
    // Handle chat updates for mobile sync
    socket.ev.on('chats.set', async ({ chats }) => {
      console.log(`💬 [${merchantId}] Chats synced:`, chats.length, 'chats');
    });
    
    // Handle contact updates for mobile sync
    socket.ev.on('contacts.set', async ({ contacts }) => {
      console.log(`📞 [${merchantId}] Contacts synced:`, contacts.length, 'contacts');
    });
    
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

// Simplified sendMessage function
async function sendMessage(merchantId, to, message, options = {}) {
  const startTime = Date.now();
  console.log(`📤 [${merchantId}] Starting message send to ${to}`);
  
  try {
    const connection = global.connections.get(merchantId);
    
    if (!connection || !connection.socket) {
      throw new Error('WhatsApp not connected for this merchant');
    }

    // Simple rate limiting
    const lastSentKey = `${merchantId}:${to}`;
    const lastSentTime = global.messageSendTimestamps.get(lastSentKey) || 0;
    const timeSinceLastMessage = Date.now() - lastSentTime;
    const MIN_DELAY_MS = 1000; // 1 second minimum between messages
    
    if (timeSinceLastMessage < MIN_DELAY_MS) {
      const waitTime = MIN_DELAY_MS - timeSinceLastMessage;
      console.log(`⏰ [${merchantId}] Rate limiting: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    global.messageSendTimestamps.set(lastSentKey, Date.now());
    
    // Simple message payload
    const messagePayload = { text: message };
    
    console.log(`📨 [${merchantId}] Sending message to ${to}`);
    
    // Send message
    const result = await connection.socket.sendMessage(to, messagePayload);
    
    console.log(`✅ [${merchantId}] Message sent successfully:`, {
      messageId: result.key.id,
      to,
      totalTime: Date.now() - startTime
    });
    
    return {
      success: true,
      messageId: result.key.id,
      timestamp: result.messageTimestamp
    };
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ [${merchantId}] Error sending message after ${totalTime}ms:`, error);
    throw error;
  }
}

module.exports = {
  createWhatsAppConnection,
  sendMessage
};
