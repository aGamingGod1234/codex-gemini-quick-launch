#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recordInstallMeta } = require('./update-check');
const packageJson = require('../package.json');

function resolveGlobalBinDir(packageRoot) {
  const fromNpm = process.env.npm_config_prefix;
  if (fromNpm && fs.existsSync(fromNpm)) {
    return fromNpm;
  }

  const guessed = path.resolve(packageRoot, '..', '..');
  if (fs.existsSync(guessed)) {
    return guessed;
  }

  return path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
}

function readFileText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_error) {
    return '';
  }
}

function pointsToQuickLaunch(filePath, quickScriptName) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const normalized = readFileText(filePath).replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
  const expected = `node_modules/codex-gemini-quick-launch/bin/${quickScriptName}`.toLowerCase();
  return normalized.includes(expected);
}

function restoreOriginalCliAliases(packageRoot) {
  if (process.platform !== 'win32') {
    return { restored: [], warnings: [] };
  }

  const binDir = resolveGlobalBinDir(packageRoot);
  const mappings = [
    { aliasName: 'codex', backupName: 'codex-cli', quickScriptName: 'codex-quick-launch.js' },
    { aliasName: 'gemini', backupName: 'gemini-cli', quickScriptName: 'gemini-quick-launch.js' },
  ];
  const exts = ['', '.cmd', '.ps1'];
  const restored = [];
  const warnings = [];

  for (const mapping of mappings) {
    for (const ext of exts) {
      const aliasPath = path.join(binDir, `${mapping.aliasName}${ext}`);
      const backupPath = path.join(binDir, `${mapping.backupName}${ext}`);

      if (!pointsToQuickLaunch(aliasPath, mapping.quickScriptName)) {
        continue;
      }

      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, aliasPath);
        restored.push(path.basename(aliasPath));
      } else {
        warnings.push(
          `Legacy override detected for ${path.basename(aliasPath)} but ${path.basename(backupPath)} was not found.`,
        );
      }
    }
  }

  return { restored, warnings };
}

function removeLegacyStartMenuEntries() {
  if (process.platform !== 'win32') {
    return [];
  }

  const startMenuPrograms = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  const legacyFiles = ['codex.bat', 'gemini.bat', 'codex.lnk', 'gemini.lnk'];
  const removed = [];
  for (const fileName of legacyFiles) {
    const filePath = path.join(startMenuPrograms, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      removed.push(fileName);
    }
  }
  return removed;
}

(async () => {
  try {
    const packageRoot = path.resolve(__dirname, '..');
    await recordInstallMeta({
      packageName: packageJson.name,
      displayName: 'codex-gemini-quick-launch',
      currentVersion: packageJson.version,
      repoSlug: 'aGamingGod1234/codex-gemini-quick-launch',
      packageRoot,
    });
    const { restored, warnings } = restoreOriginalCliAliases(packageRoot);
    const removedStartMenuFiles = removeLegacyStartMenuEntries();

    if (restored.length > 0) {
      console.log(`Restored original CLI shims: ${restored.join(', ')}`);
    }
    if (removedStartMenuFiles.length > 0) {
      console.log(`Removed legacy Start Menu launchers: ${removedStartMenuFiles.join(', ')}`);
    }
    for (const warning of warnings) {
      console.warn(`codex-gemini-quick-launch postinstall warning: ${warning}`);
    }

    console.log('codex-gemini-quick-launch install metadata saved.');
  } catch (error) {
    console.warn(`codex-gemini-quick-launch postinstall warning: ${error.message}`);
  }
})();
