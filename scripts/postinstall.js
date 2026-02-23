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

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeCommand(commandPath) {
  return path.resolve(commandPath).replace(/\\/g, '/').toLowerCase();
}

function ensureHookEntry(settings, hookKey, commandPath) {
  if (!settings[hookKey] || typeof settings[hookKey] !== 'object' || Array.isArray(settings[hookKey])) {
    settings[hookKey] = {};
  }
  if (!Array.isArray(settings[hookKey].hooks)) {
    settings[hookKey].hooks = [];
  }

  const normalizedCommandPath = normalizeCommand(commandPath);
  const hookName = 'cgl-auto-refine';
  const existingIndex = settings[hookKey].hooks.findIndex((hook) => {
    if (!hook || typeof hook !== 'object') {
      return false;
    }
    if (hook.name === hookName) {
      return true;
    }
    if (typeof hook.command === 'string' && normalizeCommand(hook.command) === normalizedCommandPath) {
      return true;
    }
    return false;
  });

  const nextEntry = {
    name: hookName,
    command: commandPath,
  };

  if (existingIndex >= 0) {
    settings[hookKey].hooks[existingIndex] = {
      ...settings[hookKey].hooks[existingIndex],
      ...nextEntry,
    };
  } else {
    settings[hookKey].hooks.push(nextEntry);
  }
}

function ensureHookSettings(settingsPath, hookKey, commandPath) {
  const settings = readJson(settingsPath) || {};
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }

  ensureHookEntry(settings.hooks, hookKey, commandPath);
  writeJson(settingsPath, settings);
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
    { aliasName: 'claude', backupName: 'claude-cli', quickScriptName: 'claude-quick-launch.js' },
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
  const legacyFiles = ['codex.bat', 'gemini.bat', 'claude.bat', 'codex.lnk', 'gemini.lnk', 'claude.lnk'];
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

function installClaudeRefineHook(packageRoot) {
  if (process.env.CGL_DISABLE_REFINE === '1') {
    return;
  }

  const homeDir = os.homedir();
  const scriptSource = path.join(packageRoot, 'scripts', 'refine', 'claude-hook.js');
  const commonSource = path.join(packageRoot, 'scripts', 'refine', 'common.js');
  const hookDir = path.join(homeDir, '.claude', 'hooks');
  const hookScriptPath = path.join(hookDir, 'cgl-refine.js');
  const hookCommonPath = path.join(hookDir, 'common.js');

  fs.mkdirSync(hookDir, { recursive: true });
  fs.copyFileSync(scriptSource, hookScriptPath);
  fs.copyFileSync(commonSource, hookCommonPath);
  try {
    fs.chmodSync(hookScriptPath, 0o755);
    fs.chmodSync(hookCommonPath, 0o644);
  } catch (_error) {
    // Ignore chmod failures on unsupported filesystems.
  }

  const settingsPath = path.join(homeDir, '.claude', 'settings.json');
  ensureHookSettings(settingsPath, 'UserPromptSubmit', hookScriptPath);
}

function installGeminiRefineHook(packageRoot) {
  if (process.env.CGL_DISABLE_REFINE === '1') {
    return;
  }

  const homeDir = os.homedir();
  const scriptSource = path.join(packageRoot, 'scripts', 'refine', 'gemini-hook.js');
  const commonSource = path.join(packageRoot, 'scripts', 'refine', 'common.js');
  const hookDir = path.join(homeDir, '.gemini', 'hooks');
  const hookScriptPath = path.join(hookDir, 'cgl-refine.js');
  const hookCommonPath = path.join(hookDir, 'common.js');

  fs.mkdirSync(hookDir, { recursive: true });
  fs.copyFileSync(scriptSource, hookScriptPath);
  fs.copyFileSync(commonSource, hookCommonPath);
  try {
    fs.chmodSync(hookScriptPath, 0o755);
    fs.chmodSync(hookCommonPath, 0o644);
  } catch (_error) {
    // Ignore chmod failures on unsupported filesystems.
  }

  const settingsPath = path.join(homeDir, '.gemini', 'settings.json');
  ensureHookSettings(settingsPath, 'BeforeAgent', hookScriptPath);
}

function installCodexAgentsHomeSnippet(packageRoot) {
  if (process.env.CGL_DISABLE_REFINE === '1') {
    return;
  }

  const snippetPath = path.join(packageRoot, 'scripts', 'refine', 'agents-snippet.md');
  const snippet = fs.readFileSync(snippetPath, 'utf8').trim();
  const homeAgentsPath = path.join(os.homedir(), 'AGENTS.md');
  const existing = readFileText(homeAgentsPath);

  const startMarker = '<!-- CGL_AUTO_REFINE_START -->';
  const endMarker = '<!-- CGL_AUTO_REFINE_END -->';
  const blockPattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, 'm');

  let nextContent;
  if (!existing.trim()) {
    nextContent = `${snippet}\n`;
  } else if (blockPattern.test(existing)) {
    nextContent = existing.replace(blockPattern, snippet);
    if (!nextContent.endsWith('\n')) {
      nextContent += '\n';
    }
  } else {
    const spacer = existing.endsWith('\n') ? '\n' : '\n\n';
    nextContent = `${existing}${spacer}${snippet}\n`;
  }

  fs.writeFileSync(homeAgentsPath, nextContent, 'utf8');
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

    installClaudeRefineHook(packageRoot);
    installGeminiRefineHook(packageRoot);
    installCodexAgentsHomeSnippet(packageRoot);

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
