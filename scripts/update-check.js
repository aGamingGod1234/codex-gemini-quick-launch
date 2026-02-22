#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2500;
const INSTALL_META_FILE = '.install-meta.json';

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function safeWriteJson(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } catch (_error) {
    // Best-effort cache write.
  }
}

function requestJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'codex-gemini-quick-launch-update-check',
          Accept: 'application/vnd.github+json',
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Request timed out'));
    });

    req.on('error', reject);
  });
}

function parseSemver(version) {
  const text = String(version || '').trim().replace(/^v/, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(text);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av || !bv) {
    return 0;
  }
  for (let i = 0; i < 3; i += 1) {
    if (av[i] > bv[i]) {
      return 1;
    }
    if (av[i] < bv[i]) {
      return -1;
    }
  }
  return 0;
}

function getStateFile(packageName) {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, packageName, 'update-check.json');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', packageName, 'update-check.json');
  }

  const xdgStateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(xdgStateHome, packageName, 'update-check.json');
}

async function fetchRemoteRepoState(repoSlug, branch = 'main') {
  const commitUrl = `https://api.github.com/repos/${repoSlug}/commits/${branch}`;
  const packageUrl = `https://raw.githubusercontent.com/${repoSlug}/${branch}/package.json`;
  const [commit, pkg] = await Promise.all([
    requestJson(commitUrl),
    requestJson(packageUrl, { Accept: 'application/json' }),
  ]);
  return {
    latestCommit: commit && typeof commit.sha === 'string' ? commit.sha : null,
    latestVersion: pkg && typeof pkg.version === 'string' ? pkg.version : null,
  };
}

function formatNotice(config, remoteState, reason) {
  const latestVersionText = remoteState.latestVersion ? ` latest=${remoteState.latestVersion}` : '';
  return [
    `[update] New version available for ${config.displayName}.${latestVersionText}`,
    `[update] Reason: ${reason}`,
    `[update] Run: ${config.updateCommand}`,
  ].join('\n');
}

async function checkForUpdate(config) {
  const stateFile = getStateFile(config.packageName);
  const state = safeReadJson(stateFile) || {};
  const now = Date.now();
  const lastCheckedAtMs = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : 0;

  if (lastCheckedAtMs && now - lastCheckedAtMs < CHECK_INTERVAL_MS) {
    return state.notice || null;
  }

  let notice = null;

  try {
    const remoteState = await fetchRemoteRepoState(config.repoSlug);
    const installMetaPath = path.join(config.packageRoot, INSTALL_META_FILE);
    const installMeta = safeReadJson(installMetaPath) || {};

    const installedCommit = installMeta.installedCommit;
    const installedVersion = config.currentVersion || installMeta.installedVersion;

    if (installedCommit && remoteState.latestCommit && installedCommit !== remoteState.latestCommit) {
      notice = formatNotice(config, remoteState, 'GitHub commit changed');
    } else if (
      installedVersion &&
      remoteState.latestVersion &&
      compareSemver(remoteState.latestVersion, installedVersion) > 0
    ) {
      notice = formatNotice(config, remoteState, `version ${installedVersion} -> ${remoteState.latestVersion}`);
    }

    safeWriteJson(stateFile, {
      lastCheckedAt: new Date(now).toISOString(),
      lastKnownCommit: remoteState.latestCommit,
      lastKnownVersion: remoteState.latestVersion,
      notice: notice || '',
    });
  } catch (_error) {
    safeWriteJson(stateFile, {
      ...state,
      lastCheckedAt: new Date(now).toISOString(),
    });
  }

  return notice;
}

async function printUpdateNotice(config) {
  const notice = await checkForUpdate(config);
  if (notice) {
    console.log(notice);
  }
}

function runAutoUpdate(config) {
  const command = String(config.updateCommand || '').trim();
  if (!command) {
    return { ok: false, skipped: true, reason: 'missing update command' };
  }

  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });

  if (result.error) {
    return { ok: false, skipped: false, reason: result.error.message };
  }

  if ((result.status ?? 1) !== 0) {
    return { ok: false, skipped: false, reason: `exit code ${result.status}` };
  }

  return { ok: true, skipped: false, reason: '' };
}

async function autoUpdateIfNeeded(config) {
  const notice = await checkForUpdate(config);
  if (!notice) {
    return { updated: false, attempted: false };
  }

  console.log(notice);
  console.log('[update] Auto-update enabled. Installing latest version now...');

  const result = runAutoUpdate(config);
  if (!result.ok) {
    console.warn(`[update] Auto-update failed (${result.reason}). Continuing with the currently installed version.`);
    return { updated: false, attempted: true };
  }

  console.log('[update] Auto-update completed successfully.');
  await recordInstallMeta(config);

  const stateFile = getStateFile(config.packageName);
  const state = safeReadJson(stateFile) || {};
  safeWriteJson(stateFile, {
    ...state,
    notice: '',
    lastAutoUpdateAt: new Date().toISOString(),
  });

  return { updated: true, attempted: true };
}

async function recordInstallMeta(config) {
  const installMetaPath = path.join(config.packageRoot, INSTALL_META_FILE);
  const meta = {
    installedAt: new Date().toISOString(),
    installedVersion: config.currentVersion || null,
    installedCommit: null,
    repoSlug: config.repoSlug,
  };

  try {
    const remoteState = await fetchRemoteRepoState(config.repoSlug);
    if (remoteState.latestVersion && !meta.installedVersion) {
      meta.installedVersion = remoteState.latestVersion;
    }
    meta.installedCommit = remoteState.latestCommit;
  } catch (_error) {
    // Continue with partial metadata.
  }

  safeWriteJson(installMetaPath, meta);
}

module.exports = {
  autoUpdateIfNeeded,
  printUpdateNotice,
  recordInstallMeta,
};
