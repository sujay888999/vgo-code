const { chromium } = require('playwright');

async function test() {
  console.log('Connecting to VGO CODE via CDP...');
  
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = (await browser.contexts()[0].pages())[0];
  
  const errors = [];
  const allLogs = [];
  
  page.on('console', msg => {
    allLogs.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push('PAGE ERROR: ' + err.message));
  
  console.log('Page loaded. Looking for chat elements...');
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\30-start.png' });
  
  // Find the chat input
  const chatInput = page.locator('textarea').first();
  const isVisible = await chatInput.isVisible().catch(() => false);
  console.log('Chat input visible: ' + isVisible);
  
  if (!isVisible) {
    console.log('Chat input NOT FOUND!');
    await browser.close();
    return;
  }
  
  // Type a simple message
  console.log('Typing message...');
  await chatInput.fill('hello');
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\31-typed.png' });
  
  // Press Enter to send
  console.log('Sending message...');
  await chatInput.press('Enter');
  
  // Wait 3 seconds
  console.log('Waiting 3 seconds...');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\32-after-3s.png' });
  
  // Check for any thinking indicator
  const pageText = await page.textContent('body');
  const hasThinking = pageText.includes('Thinking') || 
                      pageText.includes('思考') || 
                      pageText.includes('正在');
  console.log('Has thinking indicator: ' + hasThinking);
  
  // Wait another 5 seconds  
  console.log('Waiting 5 more seconds...');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\33-after-8s.png' });
  
  // Final state
  const finalText = await page.textContent('body');
  const hasThinkingAfter = finalText.includes('Thinking') || 
                           finalText.includes('思考') || 
                           finalText.includes('正在');
  console.log('Has thinking after 8s: ' + hasThinkingAfter);
  
  console.log('\n=== Console Errors ===');
  if (errors.length) errors.forEach(e => console.log(e));
  else console.log('None');
  
  console.log('\n=== All Console Logs (last 20) ===');
  allLogs.slice(-20).forEach(l => console.log(l));
  
  await browser.close();
  console.log('\nDone.');
}

test().catch(console.error);
