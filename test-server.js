// Minimal test server to verify Railway deployment works
require('dotenv').config();

console.log('=== STARTING TEST WHATSAPP SERVER ===');
console.log('Node version:', process.version);

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'Test server is running'
  });
});

// Simple auth endpoint
app.post('/auth/start', (req, res) => {
  console.log('AUTH START REQUEST');
  console.log('Body:', req.body);
  
  try {
    const { merchantId } = req.body;
    
    if (!merchantId) {
      return res.status(400).json({ error: 'Merchant ID is required' });
    }
    
    console.log(`Test auth for merchant: ${merchantId}`);
    
    res.json({
      success: true,
      status: 'test_mode',
      message: 'Test server - no real WhatsApp connection',
      merchantId: merchantId
    });
    
    console.log('Test auth response sent successfully');
    
  } catch (error) {
    console.error('Test auth error:', error);
    res.status(500).json({ error: 'Test auth failed', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Test WhatsApp Server running on port ${PORT}`);
});

module.exports = app;
