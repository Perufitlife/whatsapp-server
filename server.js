require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createWhatsAppConnection } = require('./whatsapp');
const { handleMessage, handleAuth, handleDisconnect } = require('./handlers');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WhatsApp endpoints
app.post('/auth/start', handleAuth);
app.post('/auth/disconnect', handleDisconnect);
app.post('/send-message', handleMessage);
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

app.listen(PORT, () => {
  console.log(`WhatsApp Baileys Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
