require('dotenv').config();

console.log('=== STARTING WHATSAPP SERVER ===');
console.log('Node version:', process.version);
console.log('Environment:', process.env.NODE_ENV || 'development');

const express = require('express');
const cors = require('cors');

console.log('✓ Express and CORS loaded');

// Wrap handlers loading in try-catch
let handleMessage, handleAuth, handleDisconnect;
try {
  const handlers = require('./handlers');
  handleMessage = handlers.handleMessage;
  handleAuth = handlers.handleAuth;
  handleDisconnect = handlers.handleDisconnect;
  console.log('✓ Handlers loaded successfully');
} catch (error) {
  console.error('FATAL: Error loading handlers:', error);
  process.exit(1);
}

console.log('Initializing Express app...');
const app = express();
const PORT = process.env.PORT || 3001;

console.log('Setting up middleware...');
// Middleware
app.use(cors());
app.use(express.json());

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} from ${req.ip}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  next();
});

// Health check
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    connections: global.connections?.size || 0,
    qrCodes: global.qrCodes?.size || 0
  });
});

console.log('Setting up WhatsApp endpoints...');
// WhatsApp endpoints with error handling
app.post('/auth/start', async (req, res) => {
  try {
    console.log('=== AUTH START REQUEST RECEIVED ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    
    await handleAuth(req, res);
    console.log('✓ AUTH START REQUEST COMPLETED');
  } catch (error) {
    console.error('✗ Error in auth start:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Auth failed', details: error.message });
    }
  }
});

app.post('/auth/disconnect', async (req, res) => {
  try {
    console.log('DISCONNECT REQUEST');
    await handleDisconnect(req, res);
  } catch (error) {
    console.error('Error in disconnect:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Disconnect failed', details: error.message });
    }
  }
});

app.post('/send-message', async (req, res) => {
  try {
    console.log('SEND MESSAGE REQUEST');
    await handleMessage(req, res);
  } catch (error) {
    console.error('Error in send message:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Send message failed', details: error.message });
    }
  }
});
app.get('/status/:merchantId', (req, res) => {
  const { merchantId } = req.params;
  const connection = global.connections?.get(merchantId);
  
  if (!connection) {
    return res.json({ connected: false, status: 'disconnected' });
  }
  
  res.json({
    connected: true,
    status: connection.status || 'connected',
    phone: connection.phone || null,
    pushName: connection.pushName || null
  });
});

// Initialize global connections map
global.connections = new Map();
global.qrCodes = new Map();

// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

const server = app.listen(PORT, () => {
  console.log(`WhatsApp Baileys Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Global maps initialized - connections: ${global.connections.size}, qrCodes: ${global.qrCodes.size}`);
});

// Handle server shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;
