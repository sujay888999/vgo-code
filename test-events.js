const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = (await browser.contexts()[0].pages())[0];
  
  const allEvents = [];
  
  page.on('console', msg => {
    if (msg.text().includes('Agent event') || msg.text().includes('IPC agent')) {
      allEvents.push(msg.text());
    }
  });
  
  console.log('Sending message...');
  const chatInput = page.locator('textarea').first();
  await chatInput.fill('test');
  await chatInput.press('Enter');
  
  console.log('Waiting for events...');
  await page.waitForTimeout(10000);
  
  console.log('\n=== Captured Events ===');
  allEvents.forEach(e => console.log(e));
  
  await browser.close();
}

test().catch(console.error);
