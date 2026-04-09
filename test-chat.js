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
  
  console.log('Taking initial screenshot...');
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\10-chat-initial.png' });
  
  // Find the chat input
  console.log('Looking for chat input...');
  const inputSelectors = [
    'textarea',
    'input[type="text"]',
    'input:not([type])',
    '[contenteditable="true"]'
  ];
  
  let chatInput = null;
  for (const sel of inputSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      chatInput = el;
      console.log('Found input: ' + sel);
      break;
    }
  }
  
  if (!chatInput) {
    console.log('Could not find chat input!');
    const btns = await page.locator('button').count();
    console.log('Found ' + btns + ' buttons');
    await browser.close();
    return;
  }
  
  // Type a test message
  console.log('Typing test message...');
  await chatInput.fill('Test message');
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\11-message-typed.png' });
  
  // Press Enter
  console.log('Pressing Enter to send...');
  await chatInput.press('Enter');
  
  // Wait and observe
  console.log('Waiting 8 seconds to observe behavior...');
  await page.waitForTimeout(8000);
  
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\12-after-send.png' });
  
  // Check for thinking/loading indicators
  const bodyText = await page.textContent('body');
  const isThinking = bodyText.toLowerCase().includes('thinking') || 
                     bodyText.toLowerCase().includes('loading') ||
                     bodyText.toLowerCase().includes('处理中');
  
  console.log('Thinking/Loading state: ' + (isThinking ? 'YES' : 'NO'));
  
  // Open DevTools
  console.log('Opening DevTools with Ctrl+Shift+I...');
  await page.keyboard.press('Control+Shift+I');
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\13-devtools.png' });
  
  console.log('\n=== Console Logs ===');
  logs.forEach(l => console.log(l));
  
  console.log('\n=== Errors ===');
  if (errors.length) errors.forEach(e => console.log(e));
  else console.log('None');
  
  await browser.close();
  console.log('\nDone.');
}

test().catch(console.error);
