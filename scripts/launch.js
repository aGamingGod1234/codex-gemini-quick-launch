const { spawn } = require('child_process');
const path = require('path');
const { autoUpdateIfNeeded } = require('./update-check');
const { parseArgs } = require('./launcher-args');
const packageJson = require('../package.json');

async function launch(provider) {
  const options = parseArgs(process.argv.slice(2), { allowProvider: false });
  if (!options.noLaunch) {
    await autoUpdateIfNeeded({
      packageName: packageJson.name,
      displayName: packageJson.name,
      currentVersion: packageJson.version,
      repoSlug: 'aGamingGod1234/codex-gemini-quick-launch',
      packageRoot: path.resolve(__dirname, '..'),
      updateCommand:
        'npm install -g @openai/codex @google/gemini-cli @anthropic-ai/claude-code https://codeload.github.com/aGamingGod1234/codex-gemini-quick-launch/tar.gz/refs/heads/main',
    });
  }

  const windows = process.platform === 'win32';
  const executable = windows ? 'powershell.exe' : process.execPath;
  const args = windows
    ? ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'agent_launcher.ps1'), '-Provider', provider]
    : [path.join(__dirname, 'agent_launcher_unix.js'), '--provider', provider];
  if (options.model) args.push(windows ? '-Model' : '--model', options.model);
  if (options.noLaunch) args.push(windows ? '-NoLaunch' : '--no-launch');

  const child = spawn(executable, args, { stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`Failed to start launcher: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

module.exports = (provider) => launch(provider).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
