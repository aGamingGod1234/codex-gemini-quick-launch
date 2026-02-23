#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const { autoUpdateIfNeeded } = require('../scripts/update-check');
const packageJson = require('../package.json');

const provider = 'gemini';
const mappedArgs = process.argv.slice(2).flatMap((arg) => (arg === '--no-launch' ? ['-NoLaunch'] : [arg]));

(async () => {
  await autoUpdateIfNeeded({
    packageName: packageJson.name,
    displayName: 'codex-gemini-quick-launch',
    currentVersion: packageJson.version,
    repoSlug: 'aGamingGod1234/codex-gemini-quick-launch',
    packageRoot: path.resolve(__dirname, '..'),
    updateCommand:
      'npm install -g @openai/codex @google/gemini-cli @anthropic-ai/claude-code https://codeload.github.com/aGamingGod1234/codex-gemini-quick-launch/tar.gz/refs/heads/main',
  });

  if (process.platform === 'win32') {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'agent_launcher.ps1');
    const psArgs = [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Provider',
      provider,
      ...mappedArgs,
    ];
    const child = spawn('powershell.exe', psArgs, { stdio: 'inherit' });
    child.on('error', (err) => {
      console.error(`Failed to start launcher: ${err.message}`);
      process.exit(1);
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  const scriptPath = path.join(__dirname, '..', 'scripts', 'agent_launcher_unix.js');
  const child = spawn(process.execPath, [scriptPath, '--provider', provider, ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('error', (err) => {
    console.error(`Failed to start launcher: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
})();
