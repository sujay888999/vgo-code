// patch
const fs=require('fs');
const {runAgentLoop}=require('./agentLoop');
let src=fs.readFileSync('electron/core/vgoRemoteAdapter.js','utf8');
