console.log('=== STARTING WHATSAPP-WEB.JS SERVER ===');
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);

require('dotenv').config();

// Environment diagnostics
console.log('🔍 Environment diagnostics:');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('- SUPABASE_URL:', process.env.SUPABASE_URL ? 'configured' : 'missing');
console.log('- SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'configured' : 'missing');
console.log('- PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH || 'not set');

// Comprehensive Chromium diagnostic and functionality testing
const fs = require('fs');
const { execSync } = require('child_process');

console.log('🔍 Comprehensive Chromium Diagnostics:');

const chromiumPaths = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/snap/bin/chromium'
];

let foundExecutable = null;
let chromiumDetails = [];

for (const path of chromiumPaths) {
  if (path) {
    const exists = fs.existsSync(path);
    console.log(`- ${path}: ${exists ? '✅ found' : '❌ not found'}`);
    
    if (exists) {
      try {
        // Check if executable
        fs.accessSync(path, fs.constants.X_OK);
        console.log(`  └─ ✅ Executable permissions verified`);
        
        // Try to get version with timeout
        const version = execSync(`timeout 10s ${path} --version 2>&1 || echo "version check failed"`, { 
          encoding: 'utf8',
          timeout: 15000
        });
        console.log(`  └─ Version: ${version.trim()}`);
        
        // Test basic functionality
        console.log(`  └─ 🧪 Testing basic functionality...`);
        try {
          const testResult = execSync(`timeout 15s ${path} --no-sandbox --disable-dev-shm-usage --disable-gpu --headless --virtual-time-budget=2000 about:blank 2>&1`, { 
            encoding: 'utf8',
            timeout: 20000
          });
          console.log(`  └─ ✅ Functionality test passed`);
          
          if (!foundExecutable) {
            foundExecutable = path;
            console.log(`  └─ 🎯 Selected as primary executable`);
          }
          
          chromiumDetails.push({
            path: path,
            version: version.trim(),
            functional: true
          });
          
        } catch (funcError) {
          console.log(`  └─ ❌ Functionality test failed: ${funcError.message.slice(0, 100)}`);
          chromiumDetails.push({
            path: path,
            version: version.trim(),
            functional: false,
            error: funcError.message.slice(0, 200)
          });
        }
        
      } catch (error) {
        console.log(`  └─ ❌ Failed basic checks: ${error.message.slice(0, 100)}`);
      }
    }
  }
}

// Enhanced diagnostics and fallback handling
if (!foundExecutable) {
  console.error('💥 CRITICAL: No working Chromium executable found!');
  console.error('📊 Chromium Analysis:', JSON.stringify(chromiumDetails, null, 2));
  
  console.error('🔍 Searching for any Chromium installations...');
  try {
    const searchResult = execSync('find /usr /opt /snap -name "*chromium*" -o -name "*chrome*" 2>/dev/null | head -15', { encoding: 'utf8' });
    console.error('Found these Chromium-related files:');
    console.error(searchResult || 'No Chromium files found');
  } catch (e) {
    console.error('Could not search filesystem for Chromium');
  }
  
  // System information for debugging
  try {
    console.error('🖥️ System information:');
    console.error('APT packages:', execSync('dpkg -l | grep chromium', { encoding: 'utf8' }).trim());
  } catch (e) {
    console.error('Could not get APT package info');
  }
  
} else {
  console.log(`✅ Chromium verification complete - using: ${foundExecutable}`);
  console.log('📊 Available Chromium installations:', chromiumDetails.map(d => `${d.path} (${d.functional ? 'working' : 'broken'})`).join(', '));
}

const express = require('express');
const cors = require('cors');
const { 
  createWhatsAppConnection, 
  sendMessage, 
  disconnectClient, 
  forceCleanSession 
} = require('./whatsapp-web');

const app = express();
const PORT = process.env.PORT || 8080;

// Enhanced global state management
global.whatsappClients = new Map();
global.qrCodes = new Map();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Enhanced request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const userAgent = req.get('User-Agent') || 'unknown';
  console.log(`${timestamp} - ${req.method} ${req.path} - Agent: ${userAgent}`);
  
  // Log request body for debugging (limit size)
  if (req.body && Object.keys(req.body).length > 0) {
    const bodyStr = JSON.stringify(req.body, null, 2);
    const truncatedBody = bodyStr.length > 500 ? bodyStr.substring(0, 500) + '...' : bodyStr;
    console.log(`📦 Request body: ${truncatedBody}`);
  }
  
  next();
});

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  console.error('💥 Server error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    timestamp: new Date().toISOString()
  });
  
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.json({ 
    status: 'ok',
    service: 'whatsapp-web.js-server',
    timestamp: new Date().toISOString(),
    connections: global.whatsappClients.size,
    qr_codes: global.qrCodes.size,
    memory: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// Simple test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    message: 'WhatsApp-Web.js server is running!',
    timestamp: new Date().toISOString(),
    service: 'whatsapp-web.js'
  });
});

// Start WhatsApp authentication
app.post('/auth/start', async (req, res) => {
  console.log('=== WHATSAPP AUTH START REQUEST ===');
  console.log('Request body:', req.body);
  
  try {
    const { merchantId } = req.body;
    
    if (!merchantId) {
      return res.status(400).json({ 
        error: 'Merchant ID is required',
        received: req.body
      });
    }
    
    console.log(`🚀 Starting WhatsApp auth for merchant: ${merchantId}`);
    
    // Check if already connected
    const existingConnection = global.whatsappClients.get(merchantId);
    if (existingConnection && existingConnection.status === 'connected') {
      console.log(`✅ [${merchantId}] Already connected`);
      return res.json({
        success: true,
        status: 'already_connected',
        message: 'WhatsApp is already connected',
        phone: existingConnection.phone,
        merchantId: merchantId
      });
    }
    
    // Clean any existing session first
    console.log(`🧹 [${merchantId}] Cleaning existing session...`);
    try {
      if (existingConnection && existingConnection.client) {
        await existingConnection.client.destroy();
      }
      global.whatsappClients.delete(merchantId);
      global.qrCodes.delete(merchantId);
      forceCleanSession(merchantId);
    } catch (cleanupError) {
      console.warn(`⚠️ [${merchantId}] Cleanup warning:`, cleanupError.message);
    }
    
    // Start new connection
    console.log(`📱 [${merchantId}] Initiating new WhatsApp connection...`);
    await createWhatsAppConnection(merchantId);
    
    res.json({
      success: true,
      status: 'connecting',
      message: 'WhatsApp connection initiated - QR code will be generated',
      merchantId: merchantId
    });
    
    console.log(`✅ [${merchantId}] Auth start response sent successfully`);
    
  } catch (error) {
    console.error('💥 Auth start error:', error);
    res.status(500).json({ 
      error: 'Failed to start WhatsApp authentication', 
      details: error.message,
      merchantId: req.body.merchantId
    });
  }
});

// Get connection status and QR code
app.get('/status/:merchantId', (req, res) => {
  const { merchantId } = req.params;
  console.log(`📊 Status check for merchant: ${merchantId}`);
  
  try {
    const connection = global.whatsappClients.get(merchantId);
    const qrCode = global.qrCodes.get(merchantId);
    
    console.log(`📡 [${merchantId}] Status check:`, {
      hasConnection: !!connection,
      connectionStatus: connection?.status,
      hasQrCode: !!qrCode,
      qrCodeLength: qrCode ? qrCode.length : 0
    });
    
    const response = {
      connected: !!connection && connection.status === 'connected',
      status: connection?.status || (qrCode ? 'waiting_for_qr_scan' : 'disconnected'),
      qrCode: qrCode || null,
      phone: connection?.phone || null,
      pushName: connection?.pushName || null,
      connectedAt: connection?.connectedAt || null,
      lastActivity: connection?.lastActivity || null,
      timestamp: new Date().toISOString(),
      merchantId: merchantId
    };
    
    console.log(`📤 [${merchantId}] Sending status response:`, {
      connected: response.connected,
      status: response.status,
      hasQrCode: !!response.qrCode,
      phone: response.phone
    });
    
    res.json(response);
    
  } catch (error) {
    console.error(`❌ Status check error for ${merchantId}:`, error);
    res.status(500).json({ 
      error: 'Failed to get status',
      details: error.message,
      merchantId: merchantId
    });
  }
});

// Disconnect WhatsApp session
app.post('/auth/disconnect', async (req, res) => {
  console.log('=== WHATSAPP DISCONNECT REQUEST ===');
  console.log('Request body:', req.body);
  
  try {
    const { merchantId } = req.body;
    
    if (!merchantId) {
      return res.status(400).json({ 
        error: 'Merchant ID is required',
        received: req.body
      });
    }
    
    console.log(`🔌 Disconnecting WhatsApp for merchant: ${merchantId}`);
    
    await disconnectClient(merchantId);
    
    res.json({
      success: true,
      status: 'disconnected',
      message: 'WhatsApp disconnected successfully',
      merchantId: merchantId
    });
    
    console.log(`✅ [${merchantId}] Disconnect response sent successfully`);
    
  } catch (error) {
    console.error('💥 Disconnect error:', error);
    res.status(500).json({ 
      error: 'Failed to disconnect WhatsApp', 
      details: error.message,
      merchantId: req.body.merchantId
    });
  }
});

// Send WhatsApp message
app.post('/send-message', async (req, res) => {
  console.log('=== WHATSAPP SEND MESSAGE REQUEST ===');
  console.log('Request body:', req.body);
  
  try {
    const { merchantId, to, message, options = {} } = req.body;
    
    if (!merchantId || !to || !message) {
      return res.status(400).json({ 
        error: 'merchantId, to, and message are required',
        received: req.body
      });
    }
    
    console.log(`📤 Sending message for merchant: ${merchantId} to ${to}`);
    
    const result = await sendMessage(merchantId, to, message, options);
    
    res.json({
      success: true,
      message: 'Message sent successfully',
      messageId: result.messageId,
      timestamp: result.timestamp,
      to: to,
      merchantId: merchantId
    });
    
    console.log(`✅ [${merchantId}] Message send response sent successfully`);
    
  } catch (error) {
    console.error('💥 Send message error:', error);
    res.status(500).json({ 
      error: 'Failed to send message', 
      details: error.message,
      merchantId: req.body.merchantId
    });
  }
});

// Global error handlers for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💀 Uncaught Exception:', error);
  // Don't exit process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💀 Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit process, just log the error
});

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('📴 SIGTERM received. Shutting down gracefully...');
  
  // Disconnect all WhatsApp clients
  for (const [merchantId, connection] of global.whatsappClients) {
    try {
      console.log(`🔌 Disconnecting client for merchant: ${merchantId}`);
      if (connection.client) {
        await connection.client.destroy();
      }
    } catch (error) {
      console.error(`❌ Error disconnecting ${merchantId}:`, error);
    }
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📴 SIGINT received. Shutting down gracefully...');
  
  // Disconnect all WhatsApp clients
  for (const [merchantId, connection] of global.whatsappClients) {
    try {
      console.log(`🔌 Disconnecting client for merchant: ${merchantId}`);
      if (connection.client) {
        await connection.client.destroy();
      }
    } catch (error) {
      console.error(`❌ Error disconnecting ${merchantId}:`, error);
    }
  }
  
  process.exit(0);
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp-Web.js Server running on port ${PORT}`);
  console.log(`📊 Global state initialized:`, {
    whatsappClients: global.whatsappClients.size,
    qrCodes: global.qrCodes.size
  });
});

module.exports = app;
