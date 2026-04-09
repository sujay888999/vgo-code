const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const pages = await browser.contexts()[0].pages();
  const page = pages[0];
  
  console.log('Page URL:', page.url());
  console.log('Page Title:', await page.title());
  
  const allLogs = [];
  
  page.on('console', msg => {
    allLogs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    allLogs.push('[PAGE ERROR] ' + err.message);
  });
  
  console.log('\nSending message...');
  const chatInput = page.locator('textarea').first();
  await chatInput.fill('hi');
  await chatInput.press('Enter');
  
  console.log('Waiting 10s...');
  await page.waitForTimeout(10000);
  
  console.log('\n=== All Console Logs ===');
  allLogs.forEach(e => console.log(e));
  
  await browser.close();
}

test().catch(console.error);
