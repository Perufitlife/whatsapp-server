const {join} = require('path');
const fs = require('fs');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Use system Chromium when available (Railway) - try multiple paths
  executablePath: (() => {
    const chromiumPaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable'
    ];
    
    for (const path of chromiumPaths) {
      if (path && fs.existsSync(path)) {
        console.log(`✅ Found Chromium at: ${path}`);
        return path;
      }
    }
    
    console.warn('⚠️ No Chromium executable found, using default');
    return '/usr/bin/chromium';
  })(),
  
  // Skip Chromium download if using system version
  skipDownload: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true',
  
  // Cache directory for Puppeteer
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
