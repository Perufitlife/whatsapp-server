console.log('=== LOADING WHATSAPP-WEB.JS MODULE DEPENDENCIES ===');

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

console.log('✓ All whatsapp-web.js dependencies loaded successfully');

// Enhanced environment validation
function validateEnvironment() {
  console.log('🔍 Validating environment variables...');
  
  const required = ['SUPABASE_URL'];
  const optional = ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing);
    return false;
  }
  
  // Check for at least one auth key
  const hasAuthKey = optional.some(key => process.env[key]);
  if (!hasAuthKey) {
    console.warn('⚠️ No Supabase authentication keys found - database updates may fail');
  }
  
  // Log available environment variables (without exposing secrets)
  console.log('📊 Environment status:', {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || 'not set',
    NODE_ENV: process.env.NODE_ENV || 'not set'
  });
  
  console.log('✅ Environment variables validated');
  return true;
}

// Enhanced session management
const sessionsDir = path.join(__dirname, 'wa-sessions');
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  console.log('📁 WhatsApp sessions directory created');
}

// Force clean session data for problematic merchants
function forceCleanSession(merchantId) {
  const sessionPath = path.join(sessionsDir, merchantId);
  try {
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`🧹 [${merchantId}] Forced session cleanup completed`);
    }
    // Also clean global state
    global.whatsappClients?.delete(merchantId);
    global.qrCodes?.delete(merchantId);
  } catch (error) {
    console.error(`❌ [${merchantId}] Error cleaning session:`, error);
  }
}

async function createWhatsAppConnection(merchantId) {
  console.log(`=== CREATE WHATSAPP-WEB.JS CONNECTION for ${merchantId} ===`);
  
  try {
    // Validate environment first
    if (!validateEnvironment()) {
      throw new Error('Environment validation failed');
    }
    
    console.log(`🚀 [${merchantId}] Creating WhatsApp-Web.js connection`);
    
    // Force clean any existing problematic sessions
    forceCleanSession(merchantId);
    
    // Update database to connecting status immediately
    await updateDatabaseStatus(merchantId, 'connecting', { 
      session_cleaned: true,
      timestamp: new Date().toISOString()
    });
    
    const sessionPath = path.join(sessionsDir, merchantId);
    console.log(`📁 [${merchantId}] Session path: ${sessionPath}`);
    
    // Simplified Puppeteer configuration for Railway deployment
    const puppeteerConfig = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions'
      ],
      defaultViewport: null,
      ignoreDefaultArgs: ['--disable-extensions'],
      slowMo: 100
    };

    // Try to use system Chrome/Chromium if available
    const chromiumPaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    
    for (const chromiumPath of chromiumPaths) {
      if (chromiumPath && fs.existsSync(chromiumPath)) {
        puppeteerConfig.executablePath = chromiumPath;
        console.log(`✅ [${merchantId}] Using Chromium at: ${chromiumPath}`);
        break;
      }
    }
    
    if (!puppeteerConfig.executablePath) {
      console.warn(`⚠️ [${merchantId}] No Chromium executable found, using Puppeteer default`);
    }

    // Create WhatsApp client with simplified configuration
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: merchantId,
        dataPath: sessionPath
      }),
      puppeteer: puppeteerConfig,
      restartOnAuthFail: false,
      takeoverOnConflict: false
    });

    // QR Code event handler
    client.on('qr', async (qr) => {
      console.log(`📱 [${merchantId}] 🎯 QR CODE RECEIVED!`);
      
      try {
        // Generate QR code image
        const qrCodeUrl = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'M',
          type: 'image/png',
          quality: 0.92,
          margin: 1,
          width: 512,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });
        
        // Store in global state immediately
        global.qrCodes.set(merchantId, qrCodeUrl);
        console.log(`✅ [${merchantId}] QR code generated and stored globally`);
        
        // Update database with QR code
        const dbUpdateResult = await updateDatabaseStatus(merchantId, 'waiting_for_qr_scan', { 
          qr_code: qrCodeUrl,
          qr_generated_at: new Date().toISOString(),
          qr_length: qr.length
        });
        
        console.log(`📊 [${merchantId}] Database update result:`, dbUpdateResult);
        
      } catch (error) {
        console.error(`❌ [${merchantId}] QR generation error:`, error);
        
        // Emergency fallback - store raw QR
        try {
          global.qrCodes.set(merchantId, `data:text/plain;base64,${Buffer.from(qr).toString('base64')}`);
          await updateDatabaseStatus(merchantId, 'qr_generation_failed', { 
            qr_raw: qr,
            error: error.message 
          });
          console.log(`🚨 [${merchantId}] Emergency QR fallback activated`);
        } catch (emergencyError) {
          console.error(`💀 [${merchantId}] Emergency QR fallback failed:`, emergencyError);
        }
      }
    });

    // Ready event handler
    client.on('ready', async () => {
      console.log(`🎉 [${merchantId}] WhatsApp client is ready!`);
      
      // Get client info
      const clientInfo = client.info;
      const phoneNumber = clientInfo.wid.user;
      const pushName = clientInfo.pushname;
      
      console.log(`👤 [${merchantId}] Client info:`, {
        phone: phoneNumber,
        pushName: pushName,
        platform: clientInfo.platform
      });
      
      // Store connection with enhanced metadata
      global.whatsappClients.set(merchantId, {
        client,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        phone: phoneNumber,
        pushName: pushName,
        lastActivity: new Date().toISOString()
      });
      
      // Clean QR code as we're now connected
      global.qrCodes.delete(merchantId);
      
      // Update database with connection success
      await updateDatabaseStatus(merchantId, 'connected', { 
        phone: phoneNumber,
        push_name: pushName,
        connected_at: new Date().toISOString(),
        qr_code: null // Clear QR as we're connected
      });
    });

    // Authentication success event
    client.on('authenticated', async () => {
      console.log(`✅ [${merchantId}] WhatsApp authenticated successfully!`);
      await updateDatabaseStatus(merchantId, 'authenticated', {
        authenticated_at: new Date().toISOString()
      });
    });

    // Authentication failure event
    client.on('auth_failure', async (message) => {
      console.error(`❌ [${merchantId}] Authentication failed:`, message);
      
      // Clean up global state
      global.whatsappClients.delete(merchantId);
      global.qrCodes.delete(merchantId);
      
      await updateDatabaseStatus(merchantId, 'auth_failed', {
        auth_error: message,
        failed_at: new Date().toISOString()
      });
      
      // Clean session on auth failure
      forceCleanSession(merchantId);
    });

    // Disconnected event handler
    client.on('disconnected', async (reason) => {
      console.log(`❌ [${merchantId}] WhatsApp disconnected:`, reason);
      
      // Clean up global state
      global.whatsappClients.delete(merchantId);
      global.qrCodes.delete(merchantId);
      
      await updateDatabaseStatus(merchantId, 'disconnected', {
        disconnect_reason: reason,
        disconnected_at: new Date().toISOString()
      });
    });

    // Message event handler for incoming messages
    client.on('message', async (message) => {
      try {
        if (!message.fromMe && message.body) {
          console.log(`📨 [${merchantId}] Incoming message from ${message.from}: ${message.body}`);
          
          // Extract clean phone number
          const phoneNumber = message.from.replace('@c.us', '');
          
          // Notify Supabase asynchronously
          notifySupabase(merchantId, 'message_received', {
            messageId: message.id._serialized,
            from: phoneNumber,
            text: message.body,
            timestamp: message.timestamp,
            type: message.type
          }).catch(error => {
            console.error(`❌ [${merchantId}] Error notifying Supabase:`, error);
          });
        }
      } catch (error) {
        console.error(`❌ [${merchantId}] Error processing message:`, error);
      }
    });

    // Initialize the client with retry mechanism
    console.log(`🚀 [${merchantId}] Initializing WhatsApp client...`);
    
    let initRetries = 0;
    const maxRetries = 3;
    
    while (initRetries < maxRetries) {
      try {
        await client.initialize();
        console.log(`✅ [${merchantId}] WhatsApp client initialized successfully`);
        break;
      } catch (initError) {
        initRetries++;
        console.error(`❌ [${merchantId}] Initialization attempt ${initRetries}/${maxRetries} failed:`, initError.message);
        
        if (initRetries >= maxRetries) {
          throw initError;
        }
        
        // Wait before retry
        console.log(`⏳ [${merchantId}] Waiting 3 seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Clean session before retry
        forceCleanSession(merchantId);
      }
    }
    
    // Add connection timeout protection
    const connectionTimeout = setTimeout(() => {
      console.log(`⏰ [${merchantId}] Connection timeout after 60 seconds`);
      
      // Check if we still don't have QR or connection
      const hasQr = global.qrCodes.has(merchantId);
      const hasConnection = global.whatsappClients.has(merchantId);
      
      if (!hasQr && !hasConnection) {
        console.log(`🚨 [${merchantId}] Force restarting connection due to timeout`);
        
        // Clean up and retry
        forceCleanSession(merchantId);
        updateDatabaseStatus(merchantId, 'connection_timeout', {
          timeout_at: new Date().toISOString(),
          will_retry: true
        });
        
        // Destroy client if exists
        if (client.pupBrowser) {
          client.destroy().catch(console.error);
        }
        
        // Retry after cleanup
        setTimeout(() => {
          createWhatsAppConnection(merchantId).catch(console.error);
        }, 2000);
      }
    }, 60000);
    
    // Clear timeout on successful connection
    client.on('ready', () => {
      clearTimeout(connectionTimeout);
    });
    
    client.on('qr', () => {
      clearTimeout(connectionTimeout);
    });
    
    console.log(`🚀 [${merchantId}] WhatsApp client setup completed, waiting for QR or connection...`);
    return client;
    
  } catch (error) {
    console.error(`💥 [${merchantId}] Critical connection error:`, error);
    
    // Enhanced error reporting
    await updateDatabaseStatus(merchantId, 'connection_failed', {
      error: error.message,
      stack: error.stack,
      failed_at: new Date().toISOString()
    });
    
    // Clean session on critical errors
    forceCleanSession(merchantId);
    
    throw error;
  }
}

async function updateDatabaseStatus(merchantId, status, data = {}) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn(`⚠️ [${merchantId}] Supabase credentials not configured - skipping database update`);
      return { success: true, skipped: true };
    }

    console.log(`📊 [${merchantId}] Updating database status to: ${status}`, {
      hasQrCode: !!data.qr_code,
      dataKeys: Object.keys(data)
    });

    const updatePayload = {
      merchant_id: merchantId,
      status,
      qr_code: data.qr_code || null,
      phone: data.phone || null,
      push_name: data.push_name || null,
      session_data: data.session_data || null,
      updated_at: new Date().toISOString(),
      ...data // Include any additional data
    };

    const response = await axios.post(`${supabaseUrl}/rest/v1/wa_auth_sessions`, updatePayload, {
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      }
    });
    
    console.log(`✅ [${merchantId}] Database status updated successfully to: ${status}`, {
      responseStatus: response.status,
      hasQrInPayload: !!updatePayload.qr_code
    });
    
    return { success: true, status: response.status };
  } catch (error) {
    console.warn(`⚠️ [${merchantId}] Database update failed (continuing without DB):`, {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText
    });
    
    // Don't fail the whole process because of DB issues
    return { success: true, skipped: true, error: error.message };
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
        'apikey': supabaseKey,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Notified Supabase: ${event} for ${merchantId}`);
  } catch (error) {
    console.error('Error notifying Supabase:', error.message);
  }
}

async function sendMessage(merchantId, to, message, options = {}) {
  console.log(`📤 [${merchantId}] Sending message to ${to}`);
  
  try {
    const connection = global.whatsappClients.get(merchantId);
    
    if (!connection || !connection.client) {
      throw new Error('WhatsApp not connected for this merchant');
    }
    
    // Format phone number for WhatsApp Web
    let formattedNumber = to.replace(/\D/g, ''); // Remove non-digits
    if (!formattedNumber.startsWith('521') && formattedNumber.length === 10) {
      formattedNumber = '521' + formattedNumber; // Add Mexico prefix if needed
    }
    formattedNumber += '@c.us';
    
    const result = await connection.client.sendMessage(formattedNumber, message);
    
    console.log(`✅ [${merchantId}] Message sent successfully to ${formattedNumber}`);
    
    return {
      success: true,
      messageId: result.id._serialized,
      timestamp: result.timestamp
    };
    
  } catch (error) {
    console.error(`❌ [${merchantId}] Error sending message:`, error);
    throw error;
  }
}

async function disconnectClient(merchantId) {
  console.log(`🔌 [${merchantId}] Disconnecting WhatsApp client`);
  
  try {
    const connection = global.whatsappClients.get(merchantId);
    
    if (connection && connection.client) {
      await connection.client.logout();
      await connection.client.destroy();
      console.log(`✅ [${merchantId}] WhatsApp client disconnected and destroyed`);
    }
    
    // Clean up global state
    global.whatsappClients.delete(merchantId);
    global.qrCodes.delete(merchantId);
    
    // Clean session files
    forceCleanSession(merchantId);
    
    // Update database
    await updateDatabaseStatus(merchantId, 'disconnected', {
      disconnected_at: new Date().toISOString(),
      manual_disconnect: true
    });
    
    return { success: true };
    
  } catch (error) {
    console.error(`❌ [${merchantId}] Error disconnecting:`, error);
    
    // Force cleanup even if disconnect failed
    global.whatsappClients.delete(merchantId);
    global.qrCodes.delete(merchantId);
    forceCleanSession(merchantId);
    
    throw error;
  }
}

module.exports = {
  createWhatsAppConnection,
  sendMessage,
  disconnectClient,
  updateDatabaseStatus,
  forceCleanSession,
  validateEnvironment
};
