import { chromium } from 'playwright';

async function testApp() {
  console.log('Connecting to VGO CODE app via CDP...');
  
  let browser;
  
  try {
    browser = await chromium.connectOverCDP('http://localhost:9222');
    
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    
    let consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    page.on('pageerror', error => {
      console.log('PAGE ERROR:', error.message);
    });
    
    console.log('Connected to page:', page.url());
    
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'E:\\VGO-CODE\\test-screenshot.png' });
    
    // Check for any modal overlays
    const overlays = await page.locator('.modal-overlay, [class*="overlay"]').count();
    console.log(`Modal overlays present: ${overlays}`);
    
    if (overlays > 0) {
      console.log('Closing modal...');
      
      // Try multiple close methods
      const closeMethods = [
        () => page.keyboard.press('Escape'),
        () => page.locator('button:has-text("关闭")').click(),
        () => page.locator('button[class*="close"]').click(),
        () => page.locator('.modal-header button').click(),
      ];
      
      for (const method of closeMethods) {
        try {
          await method();
          await page.waitForTimeout(500);
          const stillOpen = await page.locator('.modal-overlay').count();
          if (stillOpen === 0) {
            console.log('Modal closed successfully');
            break;
          }
        } catch (e) {
          // Continue to next method
        }
      }
      
      await page.screenshot({ path: 'E:\\VGO-CODE\\test-after-modal-close.png' });
    }
    
    const buttons = await page.locator('button').all();
    console.log(`\nFound ${buttons.length} buttons:`);
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const text = await btn.textContent();
      if (text?.trim()) {
        console.log(`  ${i}: "${text?.trim()}"`);
      }
    }
    
    console.log('\n=== Button Tests ===\n');
    
    // Test 1: Create New Session
    console.log('1. Create New Session (创建新会话)...');
    const newSessionBtn = page.locator('button:has-text("创建新会话")');
    if (await newSessionBtn.count() > 0 && await newSessionBtn.isVisible()) {
      await newSessionBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'E:\\VGO-CODE\\test-new-session.png' });
      console.log('   SUCCESS');
    } else {
      console.log('   NOT VISIBLE - skipped');
    }
    
    // Test 2: Settings
    console.log('2. Settings (设置)...');
    const settingsBtn = page.locator('button:has-text("设置")');
    if (await settingsBtn.count() > 0 && await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'E:\\VGO-CODE\\test-settings.png' });
      console.log('   SUCCESS - Settings modal opens');
      
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    
    // Test 3: Switch Directory
    console.log('3. Switch Directory (切换目录)...');
    const switchBtn = page.locator('button:has-text("切换目录")');
    if (await switchBtn.count() > 0 && await switchBtn.isVisible()) {
      await switchBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'E:\\VGO-CODE\\test-switch-dir.png' });
      console.log('   SUCCESS');
    }
    
    // Test 4: Analyze Directory
    console.log('4. Analyze Directory (分析目录)...');
    const analyzeBtn = page.locator('button:has-text("分析目录")');
    if (await analyzeBtn.count() > 0 && await analyzeBtn.isVisible()) {
      await analyzeBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'E:\\VGO-CODE\\test-analyze.png' });
      console.log('   SUCCESS');
    }
    
    // Test 5: Rename
    console.log('5. Rename (重命名)...');
    const renameBtn = page.locator('button:has-text("重命名")');
    if (await renameBtn.count() > 0 && await renameBtn.isVisible()) {
      await renameBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'E:\\VGO-CODE\\test-rename.png' });
      console.log('   SUCCESS');
    }
    
    // Test 6: Reset
    console.log('6. Reset (重置)...');
    const resetBtn = page.locator('button:has-text("重置")');
    if (await resetBtn.count() > 0 && await resetBtn.isVisible()) {
      await resetBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'E:\\VGO-CODE\\test-reset.png' });
      console.log('   SUCCESS');
    }
    
    console.log('\n=== Summary ===');
    console.log('Console errors:', consoleErrors.length);
    if (consoleErrors.length > 0) {
      console.log('Errors:', consoleErrors);
    }
    console.log('\nTest completed!');
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testApp();
