// Load WhatsApp connection only when needed to avoid startup issues
let createWhatsAppConnection;
const { v4: uuidv4 } = require('uuid');

async function handleAuth(req, res) {
  console.log('=== HANDLE AUTH STARTED ===');
  
  try {
    console.log('Auth request received');
    console.log('Request body:', req.body);
    
    const { merchantId } = req.body;
    
    if (!merchantId) {
      console.log('Missing merchant ID');
      return res.status(400).json({ error: 'Merchant ID is required' });
    }
    
    console.log(`Starting auth for merchant: ${merchantId}`);
    
    // Initialize globals if they don't exist
    if (!global.connections) {
      global.connections = new Map();
    }
    if (!global.qrCodes) {
      global.qrCodes = new Map();
    }
    
    // Check if already connected
    const existingConnection = global.connections.get(merchantId);
    if (existingConnection && existingConnection.status === 'connected') {
      console.log('Already connected');
      return res.json({
        success: true,
        status: 'already_connected',
        message: 'WhatsApp is already connected',
        phone: existingConnection.phone,
        pushName: existingConnection.pushName
      });
    }
    
    console.log('Creating new connection...');
    
    // Load WhatsApp module only when needed
    if (!createWhatsAppConnection) {
      console.log('Loading WhatsApp module...');
      createWhatsAppConnection = require('./whatsapp').createWhatsAppConnection;
    }
    
    // Send immediate response
    res.json({
      success: true,
      status: 'initializing',
      message: 'Starting WhatsApp connection...'
    });
    
    // Start connection in background
    console.log('Starting background connection...');
    createWhatsAppConnection(merchantId).catch(error => {
      console.error('Background connection error:', error);
    });
    
  } catch (error) {
    console.error('Auth error:', error);
    
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to start WhatsApp authentication',
        details: error.message
      });
    }
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
    // Load sendMessage only when needed
    const { sendMessage } = require('./whatsapp');
    
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
