const fs = require('fs');
const path = require('path');

const cssFile = path.join(__dirname, '../src/styles/global.css');
let css = fs.readFileSync(cssFile, 'utf8');

// Marker: start of old progress block
const START = '.progress-message .message-avatar {';
// Marker: end of old progress block (stop just before .loading-dots)
const END = '.loading-dots {';

const si = css.indexOf(START);
const ei = css.indexOf(END);

if (si === -1 || ei === -1) {
  console.error('Markers not found', { si, ei });
  process.exit(1);
}

const newBlock = `/* Reasoning toggle bar — always collapsed, fixed height, never pushes layout */

.progress-message .message-body {
  width: 100%;
}

.reasoning-toggle-bar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  padding: 0.42rem 0.72rem;
  cursor: pointer;
  color: inherit;
  text-align: left;
  transition: background 0.15s;
}

.reasoning-toggle-bar:hover {
  background: color-mix(in srgb, var(--bg-elevated) 100%, transparent);
}

.reasoning-toggle-left {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--text-muted);
  font-weight: 500;
  flex-shrink: 0;
}

.reasoning-toggle-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.reasoning-dot-pulse {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  animation: reasoning-pulse 1.2s ease-in-out infinite;
}

@keyframes reasoning-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}

.reasoning-toggle-preview {
  font-size: 0.78rem;
  color: color-mix(in srgb, var(--text) 55%, transparent);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 60%;
}

.reasoning-expanded-panel {
  margin-top: 0.35rem;
  max-height: 220px;
  overflow-y: auto;
  overflow-anchor: none;
  scroll-behavior: auto;
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  background: color-mix(in srgb, var(--bg-elevated) 60%, transparent);
  font-size: 0.8rem;
  line-height: 1.6;
  color: color-mix(in srgb, var(--text) 80%, transparent);
  mask-image: linear-gradient(to bottom, #000 0%, #000 88%, transparent 100%);
}

.reasoning-expanded-panel .message-content {
  padding: 0;
}

`;

css = css.slice(0, si) + newBlock + css.slice(ei);
fs.writeFileSync(cssFile, css, 'utf8');
console.log('CSS updated successfully');
