const { chromium } = require('playwright')

const APP_PATH = 'E:\\VGO-CODE\\dist\\win-unpacked\\VGO CODE.exe'
const DEFAULT_PROMPT = process.env.VGO_TEST_PROMPT || '你好'
const DEBUG_PORT = process.env.VGO_TEST_DEBUG_PORT || '9222'

async function clickIfVisible(page, selector, label) {
  const button = page.locator(selector).first()
  if (await button.isVisible().catch(() => false)) {
    console.log(`Clicking ${label}: ${selector}`)
    await button.click()
    return true
  }
  return false
}

async function approvePermissionIfNeeded(page) {
  const selectors = [
    'button:has-text("允许本次")',
    'button:has-text("允许")',
    'button:has-text("Approve")',
  ]

  for (const selector of selectors) {
    if (await clickIfVisible(page, selector, 'permission action')) {
      await page.waitForTimeout(600)
      return true
    }
  }

  return false
}

async function testApp() {
  console.log('Starting VGO CODE chat test...')
  console.log(`Prompt: ${DEFAULT_PROMPT}`)

  console.log('Launching app manually first...')
  const { spawn } = require('child_process')
  const appProcess = spawn(APP_PATH, [`--remote-debugging-port=${DEBUG_PORT}`], {
    detached: true,
    stdio: 'ignore',
  })
  appProcess.unref()

  console.log('Waiting for app to start...')
  await new Promise((resolve) => setTimeout(resolve, 8000))

  console.log('Connecting to app via CDP...')
  const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`)

  const contexts = browser.contexts()
  if (contexts.length === 0) {
    console.log('No contexts found')
    await browser.close()
    return
  }

  const context = contexts[0]
  const pages = context.pages()
  if (pages.length === 0) {
    console.log('No pages found')
    await browser.close()
    return
  }

  const page = pages[0]
  console.log('Connected to page')

  const timeoutId = setTimeout(() => {
    console.log('Timeout - taking screenshot and exiting')
    void page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\debug-timeout.png' })
    void browser.close()
    process.exit(0)
  }, 90000)

  const consoleLogs = []
  const errors = []

  page.on('console', (msg) => {
    const text = msg.text()
    consoleLogs.push(`[${msg.type()}] ${text}`)
    console.log(`CONSOLE [${msg.type()}]: ${text}`)
    if (msg.type() === 'error') {
      errors.push(text)
    }
  })

  page.on('pageerror', (err) => {
    console.log(`PAGE ERROR: ${err.message}`)
    errors.push(err.message)
  })

  console.log('Waiting for app to load...')
  await page.waitForTimeout(8000)

  console.log('Taking initial screenshot...')
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\01-initial.png' })

  const inputSelectors = [
    'textarea',
    'input[placeholder*="message" i]',
    'input[placeholder*="chat" i]',
    'div[contenteditable="true"]',
    'input[type="text"]',
  ]

  let chatInput = null
  for (const selector of inputSelectors) {
    const el = page.locator(selector).first()
    if (await el.isVisible().catch(() => false)) {
      chatInput = el
      console.log(`Found chat input: ${selector}`)
      break
    }
  }

  if (!chatInput) {
    console.log('Could not find chat input')
    await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\debug-no-input.png' })
    clearTimeout(timeoutId)
    await browser.close()
    return
  }

  console.log(`Typing prompt: ${DEFAULT_PROMPT}`)
  await chatInput.fill(DEFAULT_PROMPT)
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\02-message-typed.png' })

  console.log('Sending message...')
  await chatInput.press('Enter')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\03-after-send.png' })

  console.log('Watching for permission card or response...')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await approvePermissionIfNeeded(page)
    await page.waitForTimeout(1000)
  }

  await page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\04-after-wait.png' })

  console.log('\n--- Console Logs (last 40) ---')
  consoleLogs.slice(-40).forEach((log) => console.log(log))

  console.log('\n--- Errors ---')
  if (errors.length > 0) {
    errors.forEach((error) => console.log(error))
  } else {
    console.log('No errors detected')
  }

  clearTimeout(timeoutId)
  console.log('\nTest complete!')
  await browser.close()
  process.exit(0)
}

testApp().catch((error) => {
  console.error(error)
  process.exit(1)
})
