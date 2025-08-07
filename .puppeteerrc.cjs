const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Use system Chromium when available (Railway)
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
  
  // Skip Chromium download if using system version
  skipDownload: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true',
  
  // Cache directory for Puppeteer
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
