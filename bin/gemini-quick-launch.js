#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

if (process.platform !== 'win32') {
  console.error('gemini-quick-launch currently supports Windows only.');
  process.exit(1);
}

const scriptPath = path.join(__dirname, '..', 'scripts', 'agent_launcher.ps1');
const mappedArgs = process.argv.slice(2).flatMap((arg) => (arg === '--no-launch' ? ['-NoLaunch'] : [arg]));

const psArgs = [
  '-NoLogo',
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  scriptPath,
  '-Provider',
  'gemini',
  ...mappedArgs,
];

const child = spawn('powershell.exe', psArgs, { stdio: 'inherit' });
child.on('error', (err) => {
  console.error(`Failed to start launcher: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
