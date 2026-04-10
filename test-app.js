const { chromium } = require('playwright')

const APP_PATH = process.env.VGO_TEST_APP_PATH || 'E:\\VGO-CODE\\dist\\win-unpacked\\VGO CODE.exe'
const APP_ARGS = process.env.VGO_TEST_APP_ARGS ? JSON.parse(process.env.VGO_TEST_APP_ARGS) : []
const DEFAULT_PROMPT = process.env.VGO_TEST_PROMPT || '你好'
const DEBUG_PORT = process.env.VGO_TEST_DEBUG_PORT || '9222'
const FINAL_WAIT_MS = Number(process.env.VGO_TEST_FINAL_WAIT_MS || 120000)

async function clickIfVisible(page, selector, label) {
  const button = page.locator(selector).first()
  if (await button.isVisible().catch(() => false)) {
    console.log(`Clicking ${label}: ${selector}`)
    await button.click()
    return true
  }
  return false
}

async function getPageScore(page) {
  try {
    const url = page.url()
    if (!url || url.startsWith('chrome-error://')) {
      return -1
    }
    return await page.evaluate(() => {
      const body = document.body
      if (!body) return 0
      const text = (body.innerText || '').trim()
      const elementCount = body.querySelectorAll('*').length
      return text.length + elementCount * 2
    })
  } catch {
    return 0
  }
}

async function pickBestPage(context, attempts = 10) {
  let bestPage = null
  let bestScore = -1

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const pages = context.pages()
    for (const candidate of pages) {
      const score = await getPageScore(candidate)
      if (score > bestScore) {
        bestScore = score
        bestPage = candidate
      }
    }

    if (bestScore > 20) {
      return bestPage
    }

    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  return bestPage || context.pages()[0]
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

async function getAssistantState(page) {
  const assistantMessages = page.locator('.message-item.assistant')
  const count = await assistantMessages.count().catch(() => 0)

  if (count === 0) {
    return { count: 0, lastText: '' }
  }

  const lastMessage = assistantMessages.nth(count - 1)
  const text = (
    (await lastMessage.locator('.message-content').innerText().catch(() => '')) ||
    (await lastMessage.innerText().catch(() => '')) ||
    ''
  ).trim()

  return { count, lastText: text }
}

async function getErrorCount(page) {
  const selectors = ['.message-error', '.agent-process-item.error', '.agent-process-item.permission_denied']
  let total = 0
  for (const selector of selectors) {
    total += await page.locator(selector).count().catch(() => 0)
  }
  return total
}

async function waitForTaskCompletion(page) {
  const startedAt = Date.now()
  const baseline = await getAssistantState(page)
  const baselineErrors = await getErrorCount(page)

  while (Date.now() - startedAt < FINAL_WAIT_MS) {
    await approvePermissionIfNeeded(page)

    const current = await getAssistantState(page)
    const stopVisible = await page.locator('.stop-button').isVisible().catch(() => false)
    const currentErrors = await getErrorCount(page)

    if (currentErrors > baselineErrors) {
      return 'error'
    }

    if (current.count > baseline.count && current.lastText && !stopVisible) {
      return 'assistant_reply'
    }

    if (!stopVisible && current.count > baseline.count) {
      return 'assistant_shell_complete'
    }

    await page.waitForTimeout(1200)
  }

  return 'timeout'
}

async function testApp() {
  console.log('Starting VGO CODE chat test...')
  console.log(`Prompt: ${DEFAULT_PROMPT}`)

  console.log('Launching app manually first...')
  const { spawn } = require('child_process')
  const appProcess = spawn(APP_PATH, [...APP_ARGS, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: process.cwd(),
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

  const page = await pickBestPage(context)
  console.log('Connected to page')
  console.log(`Selected page URL: ${page.url()}`)

  const timeoutId = setTimeout(() => {
    console.log('Timeout - taking screenshot and exiting')
    void page.screenshot({ path: 'E:\\VGO-CODE\\test-results\\debug-timeout.png' })
    void browser.close()
    process.exit(0)
  }, FINAL_WAIT_MS + 30000)

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

  console.log('Creating a fresh session for this run...')
  await page.evaluate(async () => {
    if (window.vgoDesktop?.createSession) {
      await window.vgoDesktop.createSession()
    }
  })
  await page.waitForTimeout(1200)

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
  const completionState = await waitForTaskCompletion(page)
  console.log(`Completion state: ${completionState}`)

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
