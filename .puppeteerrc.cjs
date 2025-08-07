const {join} = require('path');
const fs = require('fs');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Advanced Chromium detection with comprehensive path search and testing
  executablePath: (() => {
    console.log('🚀 Starting Advanced Chromium executable detection...');
    
    // Comprehensive list of potential Chromium paths with priorities
    const chromiumPaths = [
      // Environment variable (highest priority)
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_BIN,
      process.env.CHROMIUM_BIN,
      
      // Standard Ubuntu/Debian locations (Railway/Docker compatible)
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      
      // Alternative system locations
      '/usr/local/bin/chromium',
      '/usr/local/bin/chromium-browser',
      '/usr/local/bin/google-chrome',
      '/usr/local/bin/google-chrome-stable',
      
      // Snap package locations
      '/snap/bin/chromium',
      '/snap/chromium/current/usr/lib/chromium-browser/chrome',
      
      // Google Chrome standard locations
      '/opt/google/chrome/chrome',
      '/opt/google/chrome/google-chrome',
      '/opt/chromium.org/chromium/chromium',
      
      // Flatpak locations
      '/var/lib/flatpak/app/org.chromium.Chromium/current/active/export/bin/org.chromium.Chromium',
      '/home/user/.local/share/flatpak/app/org.chromium.Chromium/current/active/export/bin/org.chromium.Chromium'
    ];
    
    console.log('🔍 Testing Chromium paths in priority order...');
    console.log(`📝 Total paths to test: ${chromiumPaths.filter(Boolean).length}`);
    
    const { execSync } = require('child_process');
    
    // First pass: Find all existing executables
    const existingPaths = [];
    for (const path of chromiumPaths) {
      if (path && fs.existsSync(path)) {
        try {
          fs.accessSync(path, fs.constants.X_OK);
          existingPaths.push(path);
          console.log(`📍 Found executable: ${path}`);
        } catch (error) {
          console.log(`⚠️  Found but not executable: ${path}`);
        }
      }
    }
    
    console.log(`🎯 Found ${existingPaths.length} potential executable(s)`);
    
    // Second pass: Test functionality for each existing executable
    for (const path of existingPaths) {
      try {
        console.log(`🧪 Testing functionality: ${path}`);
        
        // Test version command (quick test)
        let version;
        try {
          version = execSync(`"${path}" --version 2>&1`, { 
            encoding: 'utf8', 
            timeout: 8000,
            stdio: 'pipe'
          });
          console.log(`📋 Version: ${version.trim()}`);
        } catch (versionError) {
          console.log(`❌ Version test failed for ${path}: ${versionError.message.slice(0, 100)}`);
          continue;
        }
        
        // Test basic browser startup (comprehensive test)
        try {
          console.log(`⚡ Testing browser startup: ${path}`);
          const startupArgs = [
            '--no-sandbox',
            '--disable-dev-shm-usage', 
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--headless',
            '--virtual-time-budget=2000',
            '--run-all-compositor-stages-before-draw',
            '--no-first-run',
            '--no-default-browser-check',
            'about:blank'
          ];
          
          execSync(`timeout 15s "${path}" ${startupArgs.join(' ')} 2>&1`, { 
            encoding: 'utf8',
            timeout: 20000,
            stdio: 'pipe'
          });
          
          console.log(`✅ SUCCESS: Chromium fully functional at ${path}`);
          console.log(`🎉 Selected executable: ${path}`);
          return path;
          
        } catch (startupError) {
          console.log(`❌ Startup test failed for ${path}: ${startupError.message.slice(0, 100)}`);
          // Continue to next path instead of failing completely
        }
        
      } catch (error) {
        console.log(`❌ General test failed for ${path}: ${error.message.slice(0, 100)}`);
      }
    }
    
    // Third pass: System-wide search if no working executable found
    console.error('💥 CRITICAL: No working Chromium executable found in standard locations!');
    console.error('🔍 Performing system-wide search...');
    
    let searchResults = [];
    try {
      const searchCommands = [
        'find /usr -name "*chromium*" -type f -executable 2>/dev/null | head -10',
        'find /opt -name "*chrome*" -type f -executable 2>/dev/null | head -10',
        'find /snap -name "*chromium*" -type f -executable 2>/dev/null | head -10',
        'which chromium 2>/dev/null',
        'which chromium-browser 2>/dev/null',
        'which google-chrome 2>/dev/null',
        'which google-chrome-stable 2>/dev/null'
      ];
      
      for (const cmd of searchCommands) {
        try {
          const result = execSync(cmd, { encoding: 'utf8', timeout: 10000 });
          if (result.trim()) {
            searchResults.push(...result.trim().split('\n').filter(Boolean));
          }
        } catch (e) {
          // Continue with next search command
        }
      }
      
      if (searchResults.length > 0) {
        console.error('🔍 System search found these candidates:');
        searchResults.forEach(path => console.error(`  - ${path}`));
        
        // Test the first search result
        const firstCandidate = searchResults[0];
        if (fs.existsSync(firstCandidate)) {
          console.warn(`🔄 Attempting to use search result: ${firstCandidate}`);
          return firstCandidate;
        }
      } else {
        console.error('❌ System-wide search found no Chromium executables');
      }
      
    } catch (e) {
      console.error('❌ System search failed:', e.message);
    }
    
    // Final fallback strategy
    console.error('🆘 FALLBACK: Using priority fallback list...');
    const fallbackPaths = [
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome'
    ];
    
    for (const fallback of fallbackPaths) {
      console.warn(`🎲 Trying fallback: ${fallback}`);
      if (fs.existsSync(fallback)) {
        console.warn(`✅ Fallback exists: ${fallback}`);
        return fallback;
      }
    }
    
    // Ultimate fallback
    const ultimateFallback = '/usr/bin/chromium-browser';
    console.error(`🚨 ULTIMATE FALLBACK: ${ultimateFallback}`);
    console.error('⚠️  This may not work, but Puppeteer will attempt to proceed');
    return ultimateFallback;
  })(),
  
  // Skip Chromium download if using system version
  skipDownload: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true',
  
  // Cache directory for Puppeteer
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
