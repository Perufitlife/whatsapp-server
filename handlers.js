const { createWhatsAppConnection, sendMessage } = require('./whatsapp');
const { v4: uuidv4 } = require('uuid');

async function handleAuth(req, res) {
  try {
    const { merchantId } = req.body;
    
    if (!merchantId) {
      return res.status(400).json({ error: 'Merchant ID is required' });
    }
    
    console.log(`Starting auth for merchant: ${merchantId}`);
    
    // Check if already connected
    const existingConnection = global.connections.get(merchantId);
    if (existingConnection && existingConnection.status === 'connected') {
      return res.json({
        success: true,
        status: 'already_connected',
        message: 'WhatsApp is already connected',
        phone: existingConnection.phone,
        pushName: existingConnection.pushName
      });
    }
    
    // Start new connection
    await createWhatsAppConnection(merchantId);
    
    // Wait a moment for QR generation
    setTimeout(() => {
      const qrCode = global.qrCodes.get(merchantId);
      
      if (qrCode) {
        res.json({
          success: true,
          status: 'qr_generated',
          qrCode: qrCode,
          message: 'Scan the QR code with your WhatsApp to connect'
        });
      } else {
        res.json({
          success: true,
          status: 'connecting',
          message: 'Initializing connection...'
        });
      }
    }, 2000);
    
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({
      error: 'Failed to start WhatsApp authentication',
      details: error.message
    });
  }
}

async function handleDisconnect(req, res) {
  try {
    const { merchantId } = req.body;
    
    if (!merchantId) {
      return res.status(400).json({ error: 'Merchant ID is required' });
    }
    
    console.log(`Disconnecting WhatsApp for merchant: ${merchantId}`);
    
    const connection = global.connections.get(merchantId);
    
    if (connection && connection.socket) {
      await connection.socket.logout();
      connection.socket.end();
    }
    
    // Clean up
    global.connections.delete(merchantId);
    global.qrCodes.delete(merchantId);
    
    // Clean up session files
    const sessionPath = require('path').join(__dirname, 'sessions', merchantId);
    const fs = require('fs');
    
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    
    res.json({
      success: true,
      message: 'WhatsApp disconnected successfully'
    });
    
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({
      error: 'Failed to disconnect WhatsApp',
      details: error.message
    });
  }
}

async function handleMessage(req, res) {
  try {
    const { merchantId, to, message, messageId } = req.body;
    
    if (!merchantId || !to || !message) {
      return res.status(400).json({
        error: 'Missing required fields: merchantId, to, message'
      });
    }
    
    // Format phone number (ensure it includes country code)
    let formattedTo = to.replace(/\D/g, ''); // Remove non-digits
    if (!formattedTo.includes('@')) {
      formattedTo = formattedTo + '@s.whatsapp.net';
    }
    
    console.log(`Sending message from ${merchantId} to ${formattedTo}`);
    
    const result = await sendMessage(merchantId, formattedTo, message);
    
    res.json({
      success: true,
      ...result,
      originalMessageId: messageId
    });
    
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      error: 'Failed to send message',
      details: error.message
    });
  }
}

module.exports = {
  handleAuth,
  handleDisconnect,
  handleMessage
};
