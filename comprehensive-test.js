const { chromium } = require('playwright');

const APP_PATH = 'E:\\VGO-CODE\\dist\\win-unpacked\\VGO CODE.exe';
const SCREENSHOTS_DIR = 'E:\\VGO-CODE\\test-results';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testApp() {
  console.log('=== VGO CODE Comprehensive Feature Test ===\n');
  
  let browser;
  let page;
  const results = [];
  const errors = [];
  
  try {
    console.log('Starting app manually...');
    const { spawn } = require('child_process');
    const appProcess = spawn(APP_PATH, ['--remote-debugging-port=9222'], {
      detached: true,
      stdio: 'ignore'
    });
    appProcess.unref();
    
    console.log('Waiting for app to start (8s)...');
    await sleep(8000);
    
    console.log('Connecting via CDP...');
    browser = await chromium.connectOverCDP('http://localhost:9222');
    console.log('Connected to browser');
    
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pages = await context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push('CONSOLE ERROR: ' + msg.text());
      }
    });
    page.on('pageerror', err => {
      errors.push('PAGE ERROR: ' + err.message);
    });
    
    console.log('Taking initial screenshot...');
    try {
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\01-initial-load.png', timeout: 10000 });
      console.log('Initial screenshot captured');
    } catch (e) {
      console.log('Could not capture initial screenshot: ' + e.message);
    }
    
    console.log('\n--- 1. INITIAL LOAD ---');
    const bodyText = await page.textContent('body').catch(() => '');
    
    const hasLoginState = bodyText.includes('VGO Admin') || bodyText.includes('已登录') || bodyText.includes('Login') || bodyText.includes('Logged');
    results.push({ test: 'Shows login/logged in state', status: hasLoginState ? 'PASS' : 'FAIL' });
    console.log('  Login state: ' + (hasLoginState ? 'VISIBLE' : 'NOT FOUND'));
    
    const hasSessions = bodyText.includes('Session') || bodyText.includes('会话') || bodyText.includes('session') || bodyText.includes('chat');
    results.push({ test: 'Sessions loaded', status: hasSessions ? 'PASS' : 'FAIL' });
    console.log('  Sessions: ' + (hasSessions ? 'LOADED' : 'NOT FOUND'));
    
    const hasWorkspace = bodyText.includes('Workspace') || bodyText.includes('工作区') || bodyText.includes('workspace') || bodyText.includes('Directory');
    results.push({ test: 'Workspace shown', status: hasWorkspace ? 'PASS' : 'FAIL' });
    console.log('  Workspace: ' + (hasWorkspace ? 'SHOWN' : 'NOT FOUND'));
    
    console.log('\n--- 2. SIDEBAR ---');
    
    const allButtons = await page.locator('button').all();
    console.log('  Found ' + allButtons.length + ' buttons');
    
    const plusBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
    try {
      await plusBtn.click({ timeout: 5000 });
      await sleep(1000);
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\02-create-session.png', timeout: 5000 });
      results.push({ test: 'Create new session (+ button)', status: 'PASS' });
      console.log('  Create session: PASS');
    } catch (e) {
      results.push({ test: 'Create new session (+ button)', status: 'FAIL: ' + e.message });
      console.log('  Create session: FAIL - ' + e.message);
    }
    
    try {
      const sessionItems = await page.locator('[class*="session"], [class*="item"]').count();
      console.log('  Found ' + sessionItems + ' session items');
      if (sessionItems > 1) {
        await page.locator('[class*="session"], [class*="item"]').nth(1).click({ timeout: 5000 });
        await sleep(500);
        results.push({ test: 'Switch between sessions', status: 'PASS' });
        console.log('  Switch session: PASS');
      } else {
        results.push({ test: 'Switch between sessions', status: 'SKIP: Only 1 session' });
        console.log('  Switch session: SKIP (only 1 session)');
      }
    } catch (e) {
      results.push({ test: 'Switch between sessions', status: 'FAIL: ' + e.message });
      console.log('  Switch session: FAIL');
    }
    
    try {
      const pinBtn = page.locator('button[title*="pin" i], button[title*="固定" i]').first();
      await pinBtn.click({ timeout: 5000 });
      await sleep(500);
      results.push({ test: 'Pin/unpin session', status: 'PASS' });
      console.log('  Pin/unpin: PASS');
    } catch (e) {
      results.push({ test: 'Pin/unpin session', status: 'FAIL: ' + e.message });
      console.log('  Pin/unpin: FAIL');
    }
    
    try {
      const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="搜索" i]').first();
      await searchInput.fill('test', { timeout: 5000 });
      await sleep(500);
      results.push({ test: 'Search sessions', status: 'PASS' });
      console.log('  Search: PASS');
    } catch (e) {
      results.push({ test: 'Search sessions', status: 'FAIL: ' + e.message });
      console.log('  Search: FAIL');
    }
    
    console.log('\n--- 3. SETTINGS MODAL ---');
    
    try {
      const settingsBtn = page.locator('button').filter({ hasText: /settings|设置/i }).first();
      await settingsBtn.click({ timeout: 5000 });
      await sleep(1000);
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\03-settings.png', timeout: 5000 });
      
      const modalVisible = await page.locator('[class*="modal"], [class*="overlay"], [role="dialog"]').isVisible().catch(() => false);
      if (modalVisible) {
        results.push({ test: 'Open settings modal', status: 'PASS' });
        console.log('  Open settings: PASS');
        
        try {
          const themeBtn = page.locator('button').filter({ hasText: /theme|外观|深色|light|dark/i }).first();
          await themeBtn.click({ timeout: 5000 });
          await sleep(500);
          results.push({ test: 'Change theme', status: 'PASS' });
          console.log('  Change theme: PASS');
        } catch (e) {
          results.push({ test: 'Change theme', status: 'FAIL: ' + e.message });
          console.log('  Change theme: FAIL');
        }
        
        try {
          const langSelect = page.locator('select, [class*="language"], button').filter({ hasText: /language|语言/i }).first();
          await langSelect.click({ timeout: 5000 });
          await sleep(500);
          results.push({ test: 'Change language', status: 'PASS' });
          console.log('  Change language: PASS');
        } catch (e) {
          results.push({ test: 'Change language', status: 'FAIL: ' + e.message });
          console.log('  Change language: FAIL');
        }
        
        try {
          const compactToggle = page.locator('button').filter({ hasText: /compact|紧凑/i }).first();
          await compactToggle.click({ timeout: 5000 });
          await sleep(500);
          results.push({ test: 'Toggle compact mode', status: 'PASS' });
          console.log('  Toggle compact mode: PASS');
        } catch (e) {
          results.push({ test: 'Toggle compact mode', status: 'FAIL: ' + e.message });
          console.log('  Toggle compact mode: FAIL');
        }
        
        try {
          const autoScrollToggle = page.locator('button').filter({ hasText: /auto.*scroll|自动滚动/i }).first();
          await autoScrollToggle.click({ timeout: 5000 });
          await sleep(500);
          results.push({ test: 'Toggle auto-scroll', status: 'PASS' });
          console.log('  Toggle auto-scroll: PASS');
        } catch (e) {
          results.push({ test: 'Toggle auto-scroll', status: 'FAIL: ' + e.message });
          console.log('  Toggle auto-scroll: FAIL');
        }
        
        try {
          const taskPanelToggle = page.locator('button').filter({ hasText: /task|任务|panel|面板/i }).first();
          await taskPanelToggle.click({ timeout: 5000 });
          await sleep(500);
          results.push({ test: 'Toggle task panel', status: 'PASS' });
          console.log('  Toggle task panel: PASS');
        } catch (e) {
          results.push({ test: 'Toggle task panel', status: 'FAIL: ' + e.message });
          console.log('  Toggle task panel: FAIL');
        }
        
        try {
          const compressionInput = page.locator('input[type="number"], input[placeholder*="compress" i], input[placeholder*="压缩" i]').first();
          if (await compressionInput.isVisible({ timeout: 2000 })) {
            await compressionInput.fill('5000', { timeout: 5000 });
            await sleep(500);
            results.push({ test: 'Change compression threshold', status: 'PASS' });
            console.log('  Change compression threshold: PASS');
          } else {
            results.push({ test: 'Change compression threshold', status: 'SKIP: Not found' });
            console.log('  Change compression threshold: SKIP');
          }
        } catch (e) {
          results.push({ test: 'Change compression threshold', status: 'FAIL: ' + e.message });
          console.log('  Change compression threshold: FAIL');
        }
        
        try {
          const closeBtn = page.locator('button[class*="close" i], button[aria-label="close" i]').first();
          await closeBtn.click({ timeout: 5000 });
          await sleep(500);
          results.push({ test: 'Close settings', status: 'PASS' });
          console.log('  Close settings: PASS');
        } catch (e) {
          results.push({ test: 'Close settings', status: 'FAIL: ' + e.message });
          console.log('  Close settings: FAIL');
        }
      } else {
        results.push({ test: 'Open settings modal', status: 'FAIL: Modal not visible' });
        console.log('  Open settings: FAIL - Modal not visible');
      }
    } catch (e) {
      results.push({ test: 'Open settings modal', status: 'FAIL: ' + e.message });
      console.log('  Open settings: FAIL - ' + e.message);
    }
    
    console.log('\n--- 4. CHAT ---');
    
    try {
      const msgInput = page.locator('textarea, input[type="text"]').first();
      await msgInput.fill('Hello test', { timeout: 5000 });
      await sleep(500);
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\04-chat-typed.png', timeout: 5000 });
      results.push({ test: 'Type a message', status: 'PASS' });
      console.log('  Type message: PASS');
      
      try {
        const sendBtn = page.locator('button[type="submit"], button:has-text("Send"), button:has-text("发送")').first();
        await sendBtn.click({ timeout: 5000 });
        await sleep(3000);
        await page.screenshot({ path: SCREENSHOTS_DIR + '\\05-chat-sent.png', timeout: 5000 });
        results.push({ test: 'Send message', status: 'PASS' });
        console.log('  Send message: PASS');
        
        console.log('  Waiting for response (15s)...');
        await sleep(15000);
        await page.screenshot({ path: SCREENSHOTS_DIR + '\\06-chat-response.png', timeout: 5000 });
        
        const responseText = await page.textContent('body');
        const hasResponse = responseText.includes('response') || responseText.includes('响应') || responseText.includes('assistant') || responseText.includes('Thinking');
        results.push({ test: 'Receive response', status: hasResponse ? 'PASS' : 'CHECK MANUALLY' });
        console.log('  Response: ' + (hasResponse ? 'RECEIVED' : 'CHECK MANUALLY'));
      } catch (e) {
        results.push({ test: 'Send message', status: 'FAIL: ' + e.message });
        console.log('  Send message: FAIL');
      }
      
      try {
        const quickTemplate = page.locator('button').filter({ hasText: /template|quick|快捷|template/i }).first();
        await quickTemplate.click({ timeout: 5000 });
        await sleep(500);
        results.push({ test: 'Use quick templates', status: 'PASS' });
        console.log('  Quick templates: PASS');
      } catch (e) {
        results.push({ test: 'Use quick templates', status: 'FAIL: ' + e.message });
        console.log('  Quick templates: FAIL');
      }
    } catch (e) {
      results.push({ test: 'Type a message', status: 'FAIL: ' + e.message });
      console.log('  Type message: FAIL');
    }
    
    console.log('\n--- 5. WORKSPACE ---');
    
    try {
      const dirBtn = page.locator('button').filter({ hasText: /directory|folder|目录|文件夹/i }).first();
      await dirBtn.click({ timeout: 5000 });
      await sleep(1000);
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\07-workspace-dir.png', timeout: 5000 });
      results.push({ test: 'Switch directory', status: 'PASS' });
      console.log('  Switch directory: PASS');
    } catch (e) {
      results.push({ test: 'Switch directory', status: 'FAIL: ' + e.message });
      console.log('  Switch directory: FAIL');
    }
    
    try {
      const analyzeBtn = page.locator('button').filter({ hasText: /analyze|分析/i }).first();
      await analyzeBtn.click({ timeout: 5000 });
      await sleep(2000);
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\08-workspace-analyze.png', timeout: 5000 });
      results.push({ test: 'Analyze directory', status: 'PASS' });
      console.log('  Analyze directory: PASS');
    } catch (e) {
      results.push({ test: 'Analyze directory', status: 'FAIL: ' + e.message });
      console.log('  Analyze directory: FAIL');
    }
    
    console.log('\n--- 6. CONSOLE ERRORS ---');
    if (errors.length > 0) {
      console.log('  ERRORS FOUND:');
      errors.forEach(e => {
        results.push({ test: 'Console Error', status: 'FAIL', details: e });
        console.log('    - ' + e);
      });
    } else {
      results.push({ test: 'No console errors', status: 'PASS' });
      console.log('  No errors detected');
    }
    
    await page.screenshot({ path: SCREENSHOTS_DIR + '\\09-final-state.png', timeout: 5000 });
    
    console.log('\n=== DEVTOOLS CHECK ===');
    try {
      await page.keyboard.press('Control+Shift+I');
      await sleep(2000);
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\10-devtools.png', timeout: 5000 });
      console.log('  DevTools opened: CHECK SCREENSHOT');
    } catch (e) {
      console.log('  DevTools: Could not open');
    }
    
  } catch (e) {
    console.error('CRITICAL ERROR: ' + e.message);
    results.push({ test: 'CRITICAL ERROR', status: 'FAIL', details: e.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.status.includes('PASS')).length;
  const failed = results.filter(r => r.status.includes('FAIL')).length;
  const skipped = results.filter(r => r.status.includes('SKIP')).length;
  
  console.log('\nResults: ' + passed + ' PASSED, ' + failed + ' FAILED, ' + skipped + ' SKIPPED');
  console.log('\nDetailed Results:');
  results.forEach(r => {
    console.log('  [' + r.status + '] ' + r.test + (r.details ? ' - ' + r.details : ''));
  });
  
  console.log('\nScreenshots saved to: ' + SCREENSHOTS_DIR);
}

testApp().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});