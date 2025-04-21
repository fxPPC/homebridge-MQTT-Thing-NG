// Launch a local Homebridge instance for development
const path = require('path');
const { spawn } = require('child_process');

const hb = spawn('homebridge', [
  '-P', path.resolve(__dirname, '../'),
  '--config', path.resolve(__dirname, 'hbConfig/config.json')
], { stdio: 'inherit' });

hb.on('close', code => process.exit(code));
