const fs = require('fs');
const src = fs.readFileSync('electron/core/vgoRemoteAdapter.js', 'utf8');
const si = src.indexOf('function promptAllowsAutonomousContinuation');
const ei = src.indexOf('\nfunction shouldContinueAutonomously', si);
console.log('si=' + si + ' ei=' + ei + ' len=' + (ei - si));
