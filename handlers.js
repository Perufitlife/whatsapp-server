// Load WhatsApp connection function
const { createWhatsAppConnection } = require('./whatsapp');
const { v4: uuidv4 } = require('uuid');

async function handleAuth(req, res) {
  console.log('=== HANDLE AUTH STARTED ===');
  console.log('Request headers:', req.headers);
  console.log('Request method:', req.method);
  
  try {
    console.log('✓ Step 1: Auth request received');
    console.log('Request body:', req.body);
    
    const { merchantId } = req.body;
    console.log('✓ Step 2: Extracted merchantId:', merchantId);
    
    if (!merchantId) {
      console.log('❌ Missing merchant ID');
      return res.status(400).json({ error: 'Merchant ID is required' });
    }
    
    console.log(`✓ Step 3: Starting auth for merchant: ${merchantId}`);
    
    // Initialize globals if they don't exist
    if (!global.connections) {
      global.connections = new Map();
      console.log('✓ Step 4: Initialized global.connections');
    }
    if (!global.qrCodes) {
      global.qrCodes = new Map();
      console.log('✓ Step 5: Initialized global.qrCodes');
    }
    
    // Check if already connected
    console.log('✓ Step 6: Checking existing connection...');
    const existingConnection = global.connections.get(merchantId);
    console.log('✓ Step 7: Existing connection:', existingConnection ? 'found' : 'not found');
    
    if (existingConnection && existingConnection.status === 'connected') {
      console.log('✓ Step 8: Already connected, returning existing connection');
      return res.json({
        success: true,
        status: 'already_connected',
        message: 'WhatsApp is already connected',
        phone: existingConnection.phone,
        pushName: existingConnection.pushName
      });
    }
    
    console.log('✓ Step 9: Sending immediate response and starting WhatsApp connection...');
    
    // Send immediate success response
    res.json({
      success: true,
      status: 'connecting',
      message: 'WhatsApp connection started - scan QR code to complete'
    });
    
    console.log('✓ Step 10: Response sent successfully, now starting WhatsApp connection...');
    
    // Start the actual WhatsApp connection in background
    try {
      console.log('✓ Step 11: Calling createWhatsAppConnection...');
      await createWhatsAppConnection(merchantId);
      console.log('✓ Step 12: WhatsApp connection process started successfully');
    } catch (connectionError) {
      console.error('❌ Step 12 ERROR: Error starting WhatsApp connection:', connectionError);
      console.error('❌ Connection error stack:', connectionError.stack);
      // Don't throw here since we already sent response
      // The connection will be retried or user can try again
    }
    
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
    
    const connection = global.connections?.get(merchantId);
    
    if (connection && connection.socket) {
      try {
        await connection.socket.logout();
        connection.socket.end();
      } catch (socketError) {
        console.error('Error closing socket:', socketError);
        // Continue with cleanup even if socket close fails
      }
    }
    
    // Clean up global state
    if (global.connections) {
      global.connections.delete(merchantId);
    }
    if (global.qrCodes) {
      global.qrCodes.delete(merchantId);
    }
    
    // Clean up session files
    try {
      const sessionPath = require('path').join(__dirname, 'sessions', merchantId);
      const fs = require('fs');
      
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log(`Session files cleaned for ${merchantId}`);
      }
    } catch (fsError) {
      console.error('Error cleaning session files:', fsError);
      // Don't fail the disconnect if file cleanup fails
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
    // Load sendMessage function
    const { sendMessage } = require('./whatsapp');
    
    const { 
      merchantId, 
      to, 
      message, 
      messageId, 
      waitForDelivery, 
      isInteractive, 
      template_name, 
      template_variables,
      options 
    } = req.body;
    
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
    
    console.log(`📤 [${merchantId}] Enhanced message send request:`, {
      to: formattedTo,
      messageLength: message.length,
      isInteractive: isInteractive || false,
      waitForDelivery: waitForDelivery !== false,
      hasTemplate: !!template_name,
      priority: options?.priority || 5
    });
    
    // Check if WhatsApp is connected for this merchant
    const connection = global.connections?.get(merchantId);
    if (!connection || connection.status !== 'connected') {
      return res.status(400).json({
        error: 'WhatsApp not connected for this merchant',
        status: connection?.status || 'disconnected'
      });
    }
    
    // PHASE 1: Call enhanced sendMessage with new options
    const result = await sendMessage(merchantId, formattedTo, message, {
      waitForDelivery: waitForDelivery !== false,
      isInteractive: isInteractive || false,
      template_name,
      template_variables,
      priority: options?.priority || 5,
      instant_delivery: options?.instant_delivery || false
    });
    
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
