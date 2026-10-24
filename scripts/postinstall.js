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
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeCommand(commandPath) {
  const normalized = path.resolve(commandPath).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function makeHookCommand(hookKey, commandPath) {
  if (hookKey === 'UserPromptSubmit') {
    // Claude's exec form passes paths literally, including spaces and shell metacharacters.
    return { command: process.execPath, args: [commandPath] };
  }

  // Gemini runs Bash on Unix and PowerShell on Windows.
  const quote = process.platform === 'win32'
    ? (value) => `'${value.replace(/'/g, "''")}'`
    : (value) => `'${value.replace(/'/g, "'\\''")}'`;
  return {
    command: `${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} ${quote(commandPath)}`,
  };
}

function ensureHookEntry(settings, hookKey, commandPath, legacyPath) {
  const event = settings[hookKey];
  const groups = event === undefined ? [] : (Array.isArray(event) ? event : [event]);
  if (groups.some((group) => !isObject(group) || !Array.isArray(group.hooks)
      || group.hooks.some((hook) => !isObject(hook)))) {
    throw new Error(`Invalid hooks.${hookKey}; existing settings left unchanged`);
  }

  const nextEntry = { name: 'cgl-auto-refine', type: 'command', ...makeHookCommand(hookKey, commandPath) };
  const ownedPaths = [commandPath, legacyPath].map(normalizeCommand);
  let found = false;
  settings[hookKey] = groups.map((group) => ({
    ...group,
    hooks: group.hooks.map((hook) => {
      const owned = hook.name === nextEntry.name
        || hook.command === nextEntry.command && JSON.stringify(hook.args) === JSON.stringify(nextEntry.args)
        || typeof hook.command === 'string' && ownedPaths.includes(normalizeCommand(hook.command));
      if (!owned) return hook;
      found = true;
      const updated = { ...hook, ...nextEntry };
      if (!nextEntry.args) delete updated.args;
      return updated;
    }),
  }));
  if (!found) settings[hookKey].push({ hooks: [nextEntry] });
}

function prepareHookSettings(settingsPath, hookKey, commandPath, legacyPath) {
  const settings = readJson(settingsPath);
  if (!isObject(settings) || (settings.hooks !== undefined && !isObject(settings.hooks))) {
    throw new Error('Invalid settings object; existing settings left unchanged');
  }

  if (settings.hooks === undefined) settings.hooks = {};
  ensureHookEntry(settings.hooks, hookKey, commandPath, legacyPath);
  return settings;
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
  // A generic shortcut name does not establish ownership; leave binary .lnk files alone.
  const legacyFiles = ['codex.bat', 'gemini.bat', 'claude.bat'];
  const removed = [];
  for (const fileName of legacyFiles) {
    const filePath = path.join(startMenuPrograms, fileName);
    if (pointsToQuickLaunch(filePath, `${path.basename(fileName, '.bat')}-quick-launch.js`)) {
      fs.unlinkSync(filePath);
      removed.push(fileName);
    }
  }
  return removed;
}

function installRefineHook(packageRoot, client, hookKey) {
  if (process.env.CGL_DISABLE_REFINE === '1') {
    return;
  }

  const homeDir = os.homedir();
  const scriptSource = path.join(packageRoot, 'scripts', 'refine', `${client}-hook.js`);
  const commonSource = path.join(packageRoot, 'scripts', 'refine', 'common.js');
  const clientDir = path.join(homeDir, `.${client}`);
  const hookDir = path.join(clientDir, 'hooks', 'codex-gemini-quick-launch');
  const hookScriptPath = path.join(hookDir, 'cgl-refine.js');
  const hookCommonPath = path.join(hookDir, 'common.js');
  const settingsPath = path.join(clientDir, 'settings.json');
  let settings;
  try {
    settings = prepareHookSettings(settingsPath, hookKey, hookScriptPath, path.join(clientDir, 'hooks', 'cgl-refine.js'));
  } catch (error) {
    console.warn(`codex-gemini-quick-launch: skipped ${client} hook installation (${settingsPath}): ${error.message}`);
    return;
  }

  fs.mkdirSync(hookDir, { recursive: true });
  fs.copyFileSync(scriptSource, hookScriptPath);
  fs.copyFileSync(commonSource, hookCommonPath);
  try {
    fs.chmodSync(hookScriptPath, 0o755);
    fs.chmodSync(hookCommonPath, 0o644);
  } catch (_error) {
    // Ignore chmod failures on unsupported filesystems.
  }

  writeJson(settingsPath, settings);
}

function installClaudeRefineHook(packageRoot) {
  installRefineHook(packageRoot, 'claude', 'UserPromptSubmit');
}

function installGeminiRefineHook(packageRoot) {
  installRefineHook(packageRoot, 'gemini', 'BeforeAgent');
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
