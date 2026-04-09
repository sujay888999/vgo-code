const { chromium } = require('playwright');

async function test() {
  console.log('Connecting to VGO CODE...');
  
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = (await browser.contexts()[0].pages())[0];
  
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('Console: ' + msg.text());
  });
  page.on('pageerror', err => errors.push('PageError: ' + err.message));
  
  await page.waitForTimeout(2000);
  
  console.log('\n1. Initial Load:');
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\01-initial.png' });
  const text = await page.textContent('body');
  console.log('   ' + (text.includes('已登录') || text.includes('VGO Admin') ? 'PASS - Shows logged in' : 'FAIL - No login state'));
  
  console.log('\n2. Create Session (+ button):');
  try {
    await page.locator('.panel button svg').first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\02-create-session.png' });
    console.log('   PASS');
  } catch(e) { console.log('   FAIL'); }
  
  console.log('\n3. Settings Button:');
  try {
    const btns = await page.locator('button').all();
    const settingsBtn = btns[btns.length - 1];
    await settingsBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\03-settings.png' });
    console.log('   PASS');
  } catch(e) { console.log('   FAIL'); }
  
  console.log('\n4. Close Settings:');
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\04-settings-closed.png' });
    console.log('   PASS');
  } catch(e) { console.log('   FAIL'); }
  
  console.log('\n5. Theme Change:');
  try {
    await page.locator('button:has-text("设置")').click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("外观")').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\05-theme.png' });
    console.log('   PASS');
  } catch(e) { console.log('   FAIL - ' + e.message); }
  
  console.log('\n6. Language Change:');
  try {
    await page.locator('button:has-text("语言")').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\06-language.png' });
    console.log('   PASS');
  } catch(e) { console.log('   FAIL - ' + e.message); }
  
  console.log('\n7. Rename Session:');
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.locator('button:has-text("重命名")').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\07-rename.png' });
    console.log('   PASS');
  } catch(e) { console.log('   FAIL'); }
  
  console.log('\n8. Switch Session:');
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const items = page.locator('[class*="session-item"]');
    const count = await items.count();
    if (count > 1) {
      await items.nth(1).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\08-switch.png' });
      console.log('   PASS');
    } else {
      console.log('   SKIP - Only 1 session');
    }
  } catch(e) { console.log('   FAIL'); }
  
  console.log('\n=== Console Errors ===');
  if (errors.length) errors.forEach(e => console.log('  - ' + e));
  else console.log('  None');
  
  await browser.close();
  console.log('\nDone.');
}

test().catch(console.error);
