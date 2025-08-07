const {join} = require('path');
const fs = require('fs');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Use system Chromium when available (Railway) - try multiple paths with enhanced detection
  executablePath: (() => {
    console.log('🔍 Starting Chromium executable detection...');
    
    const chromiumPaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/snap/bin/chromium',
      '/opt/google/chrome/chrome'
    ];
    
    console.log('🔍 Checking paths:', chromiumPaths.filter(Boolean));
    
    for (const path of chromiumPaths) {
      if (path && fs.existsSync(path)) {
        try {
          // Verify the executable is actually executable
          fs.accessSync(path, fs.constants.X_OK);
          console.log(`✅ Found working Chromium at: ${path}`);
          return path;
        } catch (error) {
          console.log(`❌ Found but not executable: ${path}`);
        }
      } else if (path) {
        console.log(`❌ Not found: ${path}`);
      }
    }
    
    console.error('💥 CRITICAL: No working Chromium executable found!');
    console.error('Available paths:');
    try {
      const { execSync } = require('child_process');
      const result = execSync('find /usr /opt /snap -name "*chromium*" -o -name "*chrome*" 2>/dev/null | head -20', { encoding: 'utf8' });
      console.error(result);
    } catch (e) {
      console.error('Could not search for Chromium installations');
    }
    
    // Fallback to most likely path
    const fallback = '/usr/bin/chromium-browser';
    console.warn(`⚠️ Using fallback path: ${fallback}`);
    return fallback;
  })(),
  
  // Skip Chromium download if using system version
  skipDownload: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true',
  
  // Cache directory for Puppeteer
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
