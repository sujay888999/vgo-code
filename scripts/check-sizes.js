const fs = require('fs')
const r = fs.readFileSync('electron/core/vgoRemoteAdapter.js','utf8').split('\n').length
const o = fs.readFileSync('electron/core/ollamaAdapter.js','utf8').split('\n').length
console.log('remote:', r, 'ollama:', o)
