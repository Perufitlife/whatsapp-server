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

async function createWhatsAppConnection(merchantId) {
  console.log(`=== CREATE WHATSAPP CONNECTION for ${merchantId} ===`);
  
  try {
    console.log(`Creating WhatsApp connection for merchant: ${merchantId}`);
    
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

    // Handle incoming messages
    socket.ev.on('messages.upsert', async (m) => {
      const message = m.messages[0];
      if (!message.key.fromMe && message.message) {
        console.log(`Incoming message for ${merchantId}:`, message);
        
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
