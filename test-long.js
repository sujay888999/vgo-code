const { chromium } = require('playwright');

async function test() {
  console.log('Connecting to VGO CODE via CDP...');
  
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = (await browser.contexts()[0].pages())[0];
  
  const errors = [];
  const logs = [];
  
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  
  console.log('Finding chat input...');
  const chatInput = page.locator('textarea').first();
  
  console.log('Sending message...');
  await chatInput.fill('你好');
  await chatInput.press('Enter');
  
  // Wait longer to see if response completes
  console.log('Waiting 15 seconds to see if response completes...');
  await page.waitForTimeout(15000);
  
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\20-after-15s.png' });
  
  const bodyText = await page.textContent('body');
  const hasThinking = bodyText.includes('Thinking') || bodyText.includes('处理中');
  const hasResponse = bodyText.includes('VGO') && bodyText.length > 500;
  
  console.log('Status after 15s:');
  console.log('  Thinking indicator: ' + (hasThinking ? 'STILL SHOWING (stuck?)' : 'GONE'));
  console.log('  Has response: ' + (hasResponse ? 'YES' : 'NO'));
  
  console.log('\n=== Console Errors ===');
  errors.forEach(e => console.log(e));
  
  await browser.close();
  console.log('Done.');
}

test().catch(console.error);
