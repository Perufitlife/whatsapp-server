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
      
      // PHASE 3: CRITICAL - Mobile-specific socket configurations
      keepAliveIntervalMs: 20000, // 20 seconds - aggressive for mobile stability
      connectTimeoutMs: 180000, // 3 minutes - extended for poor mobile networks
      defaultQueryTimeoutMs: 150000, // 2.5 minutes for mobile queries
      qrTimeout: 90000, // 1.5 minutes QR timeout for mobile scanning
      
      // PHASE 3: CRITICAL - Adaptive retry configuration for mobile
      retryRequestDelayMs: 300, // Slightly higher for mobile processing
      maxMsgRetryCount: 8, // More retries for unreliable mobile networks
      emitOwnEvents: false, // Reduce event processing load
      
      // PHASE 3: CRITICAL - Enhanced session persistence for multi-device
      syncFullHistory: false, // Never sync full history on mobile
      markOnlineOnConnect: true, // Always mark online for mobile
      msgRetryCounterCache: new Map(), // Dedicated retry cache
      transactionOpts: {
        maxCommitRetries: 10,
        delayBetweenTriesMs: 1000
      },
      
      // PHASE 3: CRITICAL - Mobile-optimized browser configuration
      browser: ['COD WhatsApp Business', 'Mobile', '4.1.0'],
      version: [2, 2413, 1], // Latest stable version for mobile
      
      // PHASE 3: CRITICAL - Mobile network optimizations
      waWebSocketUrl: 'wss://web.whatsapp.com/ws/chat',
      connectTimeoutMs: 180000,
      queryTimeoutMs: 150000,
      alwaysUseTakeOver: false, // Reduce conflicts on mobile
      
      // CRITICAL: Enhanced logging for debugging
      logger: {
        level: 'debug',
        log: (level, ...args) => {
          const timestamp = new Date().toISOString();
          console.log(`[${timestamp}] [${merchantId}] [${level.toUpperCase()}]`, ...args);
        }
      },
      
      // PHASE 2: CRITICAL - Enhanced getMessage implementation with improved LID handling
      getMessage: async (key) => {
        const startTime = Date.now();
        console.log(`📨 [${merchantId}] PHASE2: getMessage called for key:`, {
          id: key.id,
          remoteJid: key.remoteJid,
          fromMe: key.fromMe,
          participant: key.participant,
          isLid: key.id && key.id.includes('LID')
        });
        
        try {
          const store = global.messageStores.get(merchantId);
          if (!store) {
            console.log(`❌ [${merchantId}] PHASE2: No message store found`);
            return undefined;
          }
          
          // PHASE 2: STEP 1 - Enhanced LID message handling
          const isLidMessage = key.id && key.id.includes('LID');
          if (isLidMessage) {
            console.log(`🔗 [${merchantId}] PHASE2: LID message detected: ${key.id}`);
            
            // For LID messages, try multiple resolution strategies
            const lidMessage = store.getMessage(key);
            if (lidMessage) {
              const duration = Date.now() - startTime;
              console.log(`✅ [${merchantId}] PHASE2: LID message found in store in ${duration}ms`);
              return lidMessage;
            }
            
            // Try to find by partial LID match
            const lidBase = key.id.split('_')[0]; // Get LID prefix
            for (const [storedId, storedMessage] of store.messages) {
              if (storedId.includes(lidBase)) {
                const duration = Date.now() - startTime;
                console.log(`✅ [${merchantId}] PHASE2: LID message found by partial match in ${duration}ms`);
                return storedMessage;
              }
            }
            
            console.log(`⚠️ [${merchantId}] PHASE2: LID message ${key.id} not found, allowing Baileys to handle`);
          }
          
          // PHASE 2: STEP 2 - Standard message retrieval
          const message = store.getMessage(key);
          if (message) {
            const duration = Date.now() - startTime;
            console.log(`✅ [${merchantId}] PHASE2: Standard message retrieved from store in ${duration}ms:`, {
              messageId: key.id,
              hasContent: !!message.message,
              messageType: Object.keys(message.message || {})[0],
              isFromMe: key.fromMe
            });
            return message;
          }
          
          // PHASE 2: STEP 3 - Recent message retry with exponential backoff
          const messageAge = Date.now() - (key.messageTimestamp || 0) * 1000;
          if (messageAge < 30000) { // Last 30 seconds
            console.log(`⏳ [${merchantId}] PHASE2: Recent message (${messageAge}ms old), attempting retry...`);
            
            // First retry after 50ms
            await new Promise(resolve => setTimeout(resolve, 50));
            const retryMessage1 = store.getMessage(key);
            if (retryMessage1) {
              const duration = Date.now() - startTime;
              console.log(`✅ [${merchantId}] PHASE2: Message found on first retry in ${duration}ms`);
              return retryMessage1;
            }
            
            // Second retry after 150ms total
            await new Promise(resolve => setTimeout(resolve, 100));
            const retryMessage2 = store.getMessage(key);
            if (retryMessage2) {
              const duration = Date.now() - startTime;
              console.log(`✅ [${merchantId}] PHASE2: Message found on second retry in ${duration}ms`);
              return retryMessage2;
            }
          }
          
          // PHASE 2: STEP 4 - Final fallback with detailed logging
          const duration = Date.now() - startTime;
          console.log(`🔄 [${merchantId}] PHASE2: Message not found after ${duration}ms, details:`, {
            messageId: key.id,
            storeSize: store.messages.size,
            messageAge: messageAge,
            isLid: isLidMessage,
            fromMe: key.fromMe
          });
          
          return undefined;
          
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`❌ [${merchantId}] PHASE2: Error in getMessage after ${duration}ms:`, error);
          return undefined;
        }
      },
      
      // CRITICAL: Enhanced message retry and state management
      msgRetryCounterMap: new Map(), // Use Map for better performance
      
      // CRITICAL: JID filtering for mobile optimization
      shouldIgnoreJid: (jid) => {
        // Ignore status broadcasts and large groups for mobile performance
        if (jid?.includes('status@broadcast')) return true;
        if (jid?.includes('@g.us') && jid.split('-').length > 3) return true; // Large groups
        return false;
      },
      
      // CRITICAL: Mobile-specific message handling
      generateHighQualityLinkPreview: false, // Faster message sending
      linkPreviewImageThumbnailWidth: 192, // Smaller thumbnails for mobile
      
      // PHASE 2: CRITICAL - Fixed patchMessageBeforeSending - ONLY for interactive messages
      patchMessageBeforeSending: (message) => {
        try {
          // PHASE 2: CRITICAL FIX - Only patch interactive messages, not simple text
          const isInteractiveMessage = !!(
            message.buttonsMessage ||
            message.templateMessage ||
            message.listMessage ||
            message.interactiveMessage ||
            message.requestPaymentMessage ||
            message.sendPaymentMessage ||
            message.liveLocationMessage ||
            message.stickerMessage ||
            message.audioMessage ||
            message.videoMessage ||
            message.imageMessage ||
            message.documentMessage
          );
          
          // CRITICAL: Do NOT patch simple text messages - this was causing "Waiting for this message"
          if (!isInteractiveMessage && message.conversation) {
            console.log(`📝 [${merchantId}] Simple text message - NO patching applied`);
            return message;
          }
          
          if (!isInteractiveMessage && message.extendedTextMessage?.text) {
            console.log(`📝 [${merchantId}] Extended text message - NO patching applied`);
            return message;
          }
          
          // Only patch interactive/media messages
          if (isInteractiveMessage) {
            console.log(`🔧 [${merchantId}] Patching interactive/media message for mobile compatibility`);
            
            const deviceContext = {
              deviceListMetadataVersion: 2,
              deviceListMetadata: {},
            };
            
            // Apply viewOnceMessage wrapper only for interactive content
            message = {
              viewOnceMessage: {
                message: {
                  messageContextInfo: deviceContext,
                  ...message,
                },
              },
            };
            
            console.log(`📱 [${merchantId}] Interactive message patch applied`);
          }
          
          return message;
        } catch (error) {
          console.error(`❌ [${merchantId}] Error patching message:`, error);
          return message; // Return original message if patching fails
        }
      },
      
      // CRITICAL: Enhanced receive message processing for mobile
      shouldSyncHistoryMessage: (msg) => {
        // Only sync recent messages to reduce mobile load
        const messageAge = Date.now() - (msg.messageTimestamp || 0) * 1000;
        return messageAge < 3600000; // Only sync messages from last hour
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

// CRITICAL: Enhanced sendMessage with rate limiting and delivery confirmation
async function sendMessage(merchantId, to, message, options = {}) {
  const startTime = Date.now();
  console.log(`📤 [${merchantId}] Starting message send to ${to}`);
  
  try {
    const connection = global.connections.get(merchantId);
    
    if (!connection || !connection.socket) {
      throw new Error('WhatsApp not connected for this merchant');
    }

    // PHASE 1: CRITICAL RATE LIMITING - Prevent "Waiting for this message"
    const lastSentKey = `${merchantId}:${to}`;
    const lastSentTime = global.messageSendTimestamps.get(lastSentKey) || 0;
    const timeSinceLastMessage = Date.now() - lastSentTime;
    const MIN_DELAY_MS = 2000; // 2 seconds minimum between messages to same recipient
    
    if (timeSinceLastMessage < MIN_DELAY_MS) {
      const waitTime = MIN_DELAY_MS - timeSinceLastMessage;
      console.log(`⏰ [${merchantId}] Rate limiting: waiting ${waitTime}ms before sending to ${to}`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Update timestamp BEFORE sending
    global.messageSendTimestamps.set(lastSentKey, Date.now());
    
    // PHASE 1: CRITICAL MESSAGE PREPARATION
    let messagePayload = { text: message };
    
    // Only apply patching to interactive messages, not simple text
    if (options.isInteractive) {
      console.log(`🔧 [${merchantId}] Applying interactive message patch`);
      messagePayload = options.interactivePayload || messagePayload;
    }
    
    console.log(`📨 [${merchantId}] Sending message to ${to} (delay: ${Date.now() - startTime}ms)`);
    
    // CRITICAL: Send message with enhanced error handling
    const result = await connection.socket.sendMessage(to, messagePayload);
    const messageId = result.key.id;
    
    console.log(`✅ [${merchantId}] Message sent successfully:`, {
      messageId,
      to,
      totalTime: Date.now() - startTime
    });
    
    // PHASE 1: CRITICAL DELIVERY CONFIRMATION TRACKING
    global.deliveryConfirmations.set(messageId, {
      status: 'sent',
      timestamp: Date.now(),
      merchantId,
      to,
      attempt: 1
    });
    
    // PHASE 1: WAIT FOR DELIVERY CONFIRMATION (with timeout)
    if (options.waitForDelivery !== false) {
      console.log(`⏳ [${merchantId}] Waiting for delivery confirmation for ${messageId}`);
      
      const deliveryTimeout = new Promise((resolve) => {
        setTimeout(() => resolve({ confirmed: false, reason: 'timeout' }), 5000);
      });
      
      const deliveryCheck = new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const confirmation = global.deliveryConfirmations.get(messageId);
          if (confirmation && confirmation.status === 'delivered') {
            clearInterval(checkInterval);
            resolve({ confirmed: true, confirmation });
          }
        }, 100);
        
        // Clear interval after timeout
        setTimeout(() => clearInterval(checkInterval), 5000);
      });
      
      const deliveryResult = await Promise.race([deliveryTimeout, deliveryCheck]);
      
      if (deliveryResult.confirmed) {
        console.log(`✅ [${merchantId}] Message ${messageId} delivered successfully`);
      } else {
        console.warn(`⚠️ [${merchantId}] Message ${messageId} delivery not confirmed: ${deliveryResult.reason}`);
      }
    }
    
    return {
      success: true,
      messageId: result.key.id,
      timestamp: result.messageTimestamp,
      deliveryWaitTime: Date.now() - startTime,
      rateLimit: {
        applied: timeSinceLastMessage < MIN_DELAY_MS,
        waitTime: timeSinceLastMessage < MIN_DELAY_MS ? MIN_DELAY_MS - timeSinceLastMessage : 0
      }
    };
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ [${merchantId}] Error sending message after ${totalTime}ms:`, error);
    
    // Track failed attempts
    const errorKey = `${merchantId}:${to}:error`;
    const errorCount = (global.messageSendTimestamps.get(errorKey) || 0) + 1;
    global.messageSendTimestamps.set(errorKey, errorCount);
    
    throw error;
  }
}

module.exports = {
  createWhatsAppConnection,
  sendMessage
};
