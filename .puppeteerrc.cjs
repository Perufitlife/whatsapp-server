const {join} = require('path');
const fs = require('fs');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Enhanced Chromium detection with functionality testing
  executablePath: (() => {
    console.log('🔍 Starting Enhanced Chromium executable detection...');
    
    const chromiumPaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/snap/bin/chromium',
      '/opt/google/chrome/chrome'
    ];
    
    console.log('🔍 Testing paths:', chromiumPaths.filter(Boolean));
    
    const { execSync } = require('child_process');
    
    for (const path of chromiumPaths) {
      if (path && fs.existsSync(path)) {
        try {
          // Check if executable
          fs.accessSync(path, fs.constants.X_OK);
          console.log(`✅ Found executable: ${path}`);
          
          // Test version command
          const version = execSync(`${path} --version 2>&1`, { 
            encoding: 'utf8', 
            timeout: 5000 
          });
          console.log(`📋 Version: ${version.trim()}`);
          
          // Test basic functionality with timeout
          console.log(`🧪 Testing basic functionality: ${path}`);
          execSync(`timeout 10s ${path} --no-sandbox --disable-dev-shm-usage --disable-gpu --headless --virtual-time-budget=1000 about:blank 2>&1`, { 
            encoding: 'utf8',
            timeout: 15000
          });
          
          console.log(`✅ Chromium functionality verified: ${path}`);
          return path;
          
        } catch (error) {
          console.log(`❌ Failed functionality test for ${path}:`, error.message.slice(0, 100));
        }
      } else if (path) {
        console.log(`❌ Not found: ${path}`);
      }
    }
    
    console.error('💥 CRITICAL: No working Chromium executable found!');
    console.error('🔍 Searching for any Chromium installations...');
    try {
      const result = execSync('find /usr /opt /snap -name "*chromium*" -o -name "*chrome*" 2>/dev/null | head -20', { encoding: 'utf8' });
      console.error('Found these Chromium-related files:');
      console.error(result || 'No Chromium files found');
    } catch (e) {
      console.error('Could not search for Chromium installations');
    }
    
    // Enhanced fallback with system detection
    const fallback = '/usr/bin/chromium';
    console.warn(`⚠️ Using fallback path: ${fallback}`);
    return fallback;
  })(),
  
  // Skip Chromium download if using system version
  skipDownload: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true',
  
  // Cache directory for Puppeteer
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
