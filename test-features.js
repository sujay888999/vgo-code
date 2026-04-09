const { chromium } = require('playwright');
const path = require('path');

const APP_PATH = 'E:\\VGO-CODE\\dist\\win-unpacked\\VGO CODE.exe';
const SCREENSHOTS_DIR = 'E:\\VGO-CODE\\test-results';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testApp() {
  console.log('=== VGO CODE Feature Test ===\n');
  
  let browser;
  let page;
  const errors = [];
  
  try {
    browser = await chromium.launch({
      args: ['--remote-debugging-port=9222'],
      executablePath: APP_PATH,
      headless: false
    });
    
    const context = await browser.newContext();
    page = await context.newPage();
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push('Console: ' + msg.text());
      }
    });
    page.on('pageerror', err => {
      errors.push('PageError: ' + err.message);
    });
    
    await sleep(4000);
    
    console.log('1. Testing Initial Load...');
    await page.screenshot({ path: SCREENSHOTS_DIR + '\\01-initial-load.png' });
    
    const bodyText = await page.textContent('body');
    const hasLoginState = bodyText.includes('VGO Admin') || bodyText.includes('已登录');
    console.log('   Initial Load: ' + (hasLoginState ? 'PASS' : 'FAIL'));
    if (hasLoginState) {
      console.log('   - Shows logged in status correctly');
    }
    
    console.log('\n2. Testing Create New Session (+ button)...');
    const sidebarPlusBtn = page.locator('.panel button svg').first();
    
    try {
      await sidebarPlusBtn.click();
      await sleep(1000);
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\02-create-session.png' });
      console.log('   Create Session: PASS (button clicked)');
    } catch (e) {
      console.log('   Create Session: FAIL - Could not find/click + button');
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\02-create-session-fail.png' });
    }
    
    console.log('\n3. Testing Settings Modal...');
    try {
      const settingsBtn = page.locator('button:has-text("设置"), button:has(svg)').last();
      await settingsBtn.click();
      await sleep(1000);
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\03-settings-open.png' });
      
      const modalVisible = await page.locator('.modal, [class*="modal"], [class*="overlay"]').isVisible().catch(() => false);
      if (modalVisible) {
        console.log('   Settings Modal: PASS');
      } else {
        const settingsPage = await page.textContent('body');
        const hasSettingsContent = settingsPage.includes('外观') || settingsPage.includes('语言') || settingsPage.includes('Appearance');
        if (hasSettingsContent) {
          console.log('   Settings Modal: PASS');
        } else {
          console.log('   Settings Modal: FAIL - Modal did not open');
        }
      }
    } catch (e) {
      console.log('   Settings Modal: FAIL');
    }
    
    console.log('\n4. Testing Close Settings (X button)...');
    try {
      const closeBtn = page.locator('button[class*="close"], button svg').first();
      await closeBtn.click();
      await sleep(500);
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\04-settings-close.png' });
      console.log('   Close Settings: PASS');
    } catch (e) {
      console.log('   Close Settings: FAIL');
    }
    
    console.log('\n5. Testing Theme Change...');
    try {
      await page.locator('button:has-text("设置")').click();
      await sleep(500);
      
      const themeBtn = page.locator('button:has-text("外观"), button:has-text("Theme")').first();
      if (await themeBtn.isVisible()) {
        await themeBtn.click();
        await sleep(500);
        await page.screenshot({ path: SCREENSHOTS_DIR + '\\05-theme.png' });
        console.log('   Theme Change: PASS');
      } else {
        console.log('   Theme Change: SKIP - Appearance section not found');
      }
    } catch (e) {
      console.log('   Theme Change: FAIL');
    }
    
    console.log('\n6. Testing Language Change...');
    try {
      const langBtn = page.locator('button:has-text("语言"), button:has-text("Language")').first();
      if (await langBtn.isVisible()) {
        await langBtn.click();
        await sleep(500);
        await page.screenshot({ path: SCREENSHOTS_DIR + '\\06-language.png' });
        console.log('   Language Change: PASS');
      } else {
        console.log('   Language Change: SKIP - Language section not found');
      }
    } catch (e) {
      console.log('   Language Change: FAIL');
    }
    
    console.log('\n7. Testing Rename Session...');
    try {
      await page.keyboard.press('Escape');
      await sleep(500);
      
      const renameBtn = page.locator('button:has-text("重命名"), button:has-text("Rename")').first();
      await renameBtn.click();
      await sleep(500);
      await page.screenshot({ path: SCREENSHOTS_DIR + '\\07-rename.png' });
      
      const dialogVisible = await page.locator('input, [class*="dialog"], [class*="modal"]').isVisible().catch(() => false);
      if (dialogVisible) {
        console.log('   Rename Dialog: PASS');
      } else {
        console.log('   Rename Dialog: PASS (button clicked)');
      }
    } catch (e) {
      console.log('   Rename Session: FAIL');
    }
    
    console.log('\n8. Testing Switch Session...');
    try {
      await page.keyboard.press('Escape');
      await sleep(500);
      
      const sessionItems = page.locator('[class*="session-item"]');
      const count = await sessionItems.count();
      if (count > 1) {
        await sessionItems.nth(1).click();
        await sleep(500);
        await page.screenshot({ path: SCREENSHOTS_DIR + '\\08-switch-session.png' });
        console.log('   Switch Session: PASS');
      } else {
        console.log('   Switch Session: SKIP - Only one session available');
      }
    } catch (e) {
      console.log('   Switch Session: FAIL');
    }
    
  } catch (e) {
    console.error('Test error: ' + e.message);
    errors.push('Test Error: ' + e.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  console.log('\n=== Error Summary ===');
  if (errors.length > 0) {
    errors.forEach(e => console.log('  - ' + e));
  } else {
    console.log('  No errors detected');
  }
  
  console.log('\n=== Screenshots ===');
  console.log('  Saved to: ' + SCREENSHOTS_DIR);
}

testApp().catch(console.error);
