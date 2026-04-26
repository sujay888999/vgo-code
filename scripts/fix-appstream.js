const fs = require('fs')
const src_file = 'src/App.tsx'
let src = fs.readFileSync(src_file, 'utf8')

// 1. Replace upsertLiveMessage — writes to logText, not text
const OLD_LIVE = `      const upsertLiveMessage = (text: string, nextStatus: 'loading' | 'done' | 'error' = 'loading') => {
        if (!text.trim()) return
        const existing = getStream()
        // Only append execution logs while the final reply hasn't started yet
        // (i.e. the message is still in "log" mode, not receiving model tokens)
        if (existing?.kind === 'final' && existing.status === 'done') return
        const merged = appendUniqueBlock(existing?.text || '', text)
        if (existing) {
          updateMessage(finalMessageId, { text: merged, status: nextStatus, timestamp, kind: 'stream' })
        } else {
          addMessage({ id: finalMessageId, role: 'assistant', text: merged, status: nextStatus, timestamp, kind: 'stream' })
        }
      }`

const NEW_LIVE = `      const upsertLiveMessage = (logLine: string, nextStatus: 'loading' | 'done' | 'error' = 'loading') => {
        if (!logLine.trim()) return
        const existing = getStream()
        const newLog = appendUniqueBlock(existing?.logText || '', logLine)
        if (existing) {
          updateMessage(finalMessageId, { logText: newLog, status: nextStatus, timestamp })
        } else {
          addMessage({ id: finalMessageId, role: 'assistant', text: '', logText: newLog, status: nextStatus, timestamp, kind: 'stream' })
        }
      }`

// 2. Replace upsertFinalMessage — appends model reply to text, never touches logText
const OLD_FINAL = `      const upsertFinalMessage = (text: string, nextStatus: 'loading' | 'done' | 'error' = 'done') => {
        if (!text.trim()) return
        const existing = getStream()
        if (existing) {
          updateMessage(finalMessageId, { text, status: nextStatus, timestamp, kind: 'final' })
        } else {
          addMessage({ id: finalMessageId, role: 'assistant', text, status: nextStatus, timestamp, kind: 'final' })
        }
      }`

const NEW_FINAL = `      const upsertFinalMessage = (text: string, nextStatus: 'loading' | 'done' | 'error' = 'done') => {
        if (!text.trim()) return
        const existing = getStream()
        if (existing) {
          // Preserve logText — only update the model reply text
          updateMessage(finalMessageId, { text, status: nextStatus, timestamp, kind: 'final' })
        } else {
          addMessage({ id: finalMessageId, role: 'assistant', text, logText: '', status: nextStatus, timestamp, kind: 'final' })
        }
      }`

// 3. Fix currentLiveText to read from logText
const OLD_LIVE_TEXT = `      const currentLiveText =
        useAppStore.getState().messages.find((message) => message.id === liveMessageId)?.text || ''`

const NEW_LIVE_TEXT = `      const currentLiveText =
        useAppStore.getState().messages.find((message) => message.id === finalMessageId)?.logText || ''`

if (!src.includes(OLD_LIVE)) { console.error('OLD_LIVE not found'); process.exit(1) }
if (!src.includes(OLD_FINAL)) { console.error('OLD_FINAL not found'); process.exit(1) }
if (!src.includes(OLD_LIVE_TEXT)) { console.error('OLD_LIVE_TEXT not found'); process.exit(1) }

src = src.replace(OLD_LIVE, NEW_LIVE)
src = src.replace(OLD_FINAL, NEW_FINAL)
src = src.replace(OLD_LIVE_TEXT, NEW_LIVE_TEXT)

fs.writeFileSync(src_file, src, 'utf8')
console.log('done')
