const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sourceRoot = path.resolve(__dirname, '..');
const clients = [['claude', 'UserPromptSubmit'], ['gemini', 'BeforeAgent']];

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cgl-hooks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "User's space $literal & `literal`");
  const packageRoot = path.join(root, 'package');
  const binDir = path.join(root, 'npm bin');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of [
    'package.json', 'scripts/postinstall.js', 'scripts/update-check.js',
    'scripts/refine/common.js', 'scripts/refine/claude-hook.js',
    'scripts/refine/gemini-hook.js', 'scripts/refine/agents-snippet.md',
  ]) {
    const target = path.join(packageRoot, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, name), target);
  }

  // Only metadata/network is stubbed. Run the real copied postinstall entry point.
  const preload = path.join(packageRoot, 'preload.cjs');
  write(preload, `
    const metadataPath = require.resolve('./scripts/update-check');
    require.cache[metadataPath] = { exports: { recordInstallMeta: async () => {} } };
    require('https').get = () => { throw new Error('Network forbidden in hook tests'); };
    if (process.env.CGL_TEST_PLATFORM) {
      Object.defineProperty(process, 'platform', { value: process.env.CGL_TEST_PLATFORM });
    }
    if (process.env.CGL_TEST_NODE_PATH) {
      Object.defineProperty(process, 'execPath', { value: process.env.CGL_TEST_NODE_PATH });
    }
  `);
  const env = {
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || '',
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: path.parse(home).root,
    HOMEPATH: home.slice(path.parse(home).root.length),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    GEMINI_CLI_HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    npm_config_prefix: binDir,
    npm_config_cache: path.join(root, 'npm cache'),
    TMPDIR: root,
    TMP: root,
    TEMP: root,
  };
  return {
    root, home, packageRoot, binDir, env,
    settingsPath: (client) => path.join(home, `.${client}`, 'settings.json'),
    readSettings(client) { return JSON.parse(fs.readFileSync(this.settingsPath(client), 'utf8')); },
    install(extraEnv = {}) {
      const result = spawnSync(process.execPath, ['--require', preload, 'scripts/postinstall.js'], {
        cwd: packageRoot, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return result;
    },
  };
}

function ownedHooks(settings, event) {
  return settings.hooks[event].flatMap((group) => group.hooks).filter((hook) => hook.name === 'cgl-auto-refine');
}

function executeHook(f, client, hook, input, extraEnv = {}) {
  const options = {
    cwd: f.root, env: { ...f.env, ...extraEnv }, input,
    encoding: 'utf8', timeout: 10000,
  };
  const result = client === 'claude'
    ? spawnSync(hook.command, hook.args, options)
    : process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', hook.command], options)
      : spawnSync('bash', ['-c', hook.command], options);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('fresh install creates native hooks that execute using input.cwd and preserves the Codex snippet', (t) => {
  const f = fixture(t);
  const project = path.join(f.root, 'actual project');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  const nested = path.join(project, 'src');
  fs.mkdirSync(nested);
  write(path.join(project, 'package.json'), { scripts: { test: 'custom-test', lint: 'custom-lint' } });
  write(path.join(f.home, 'AGENTS.md'), 'Existing user instructions.\n');

  const extraEnv = {};
  if (process.platform !== 'win32') {
    // Exercise a Node executable path containing whitespace and shell metacharacters too.
    const nodePath = path.join(f.home, 'node runtime');
    fs.symlinkSync(process.execPath, nodePath);
    extraEnv.CGL_TEST_NODE_PATH = nodePath;
  }
  assert.equal(f.install(extraEnv).stderr, '');

  for (const [client, event] of clients) {
    const settings = f.readSettings(client);
    assert.ok(Array.isArray(settings.hooks[event]));
    const [hook] = ownedHooks(settings, event);
    assert.equal(ownedHooks(settings, event).length, 1);
    assert.equal(hook.type, 'command');
    if (client === 'claude') {
      assert.equal(hook.command, extraEnv.CGL_TEST_NODE_PATH || process.execPath);
      assert.equal(hook.args.length, 1);
    }
    const output = executeHook(f, client, hook, JSON.stringify({ cwd: nested, prompt: 'Fix this project' }));
    assert.equal(output.additionalContext, undefined);
    const specific = output.hookSpecificOutput;
    if (client === 'claude') assert.equal(specific.hookEventName, event);
    assert.ok(specific.additionalContext.includes(`Repo root: ${project} (current working dir: src)`));
    assert.ok(specific.additionalContext.includes('npm run lint; npm run test'));
    assert.ok(specific.additionalContext.includes('Refined Prompt'));
    assert.ok(!specific.additionalContext.includes(`Repo root: ${sourceRoot}`));
    assert.ok(fs.existsSync(path.join(f.home, `.${client}`, 'hooks', 'codex-gemini-quick-launch', 'common.js')));
  }
  const agents = fs.readFileSync(path.join(f.home, 'AGENTS.md'), 'utf8');
  const snippet = fs.readFileSync(path.join(sourceRoot, 'scripts/refine/agents-snippet.md'), 'utf8').trim();
  assert.ok(agents.startsWith('Existing user instructions.\n'));
  assert.ok(agents.includes(snippet));
  const before = clients.map(([client]) => fs.readFileSync(f.settingsPath(client), 'utf8'));
  f.install(extraEnv);
  assert.deepEqual(clients.map(([client]) => fs.readFileSync(f.settingsPath(client), 'utf8')), before);
  assert.equal(fs.readFileSync(path.join(f.home, 'AGENTS.md'), 'utf8'), agents);
});

for (const legacy of [false, true]) {
  test(`${legacy ? 'legacy object' : 'native array'} migration retains custom settings, groups, unrelated hooks and common.js`, (t) => {
    const f = fixture(t);
    for (const [client, event] of clients) {
      const oldPath = path.join(f.home, `.${client}`, 'hooks', 'cgl-refine.js');
      const group = {
        matcher: '*', sequential: true, customGroup: 'keep',
        hooks: [
          { type: 'command', command: 'echo before', name: 'other-hook', timeout: 1234 },
          { name: 'cgl-auto-refine', command: oldPath, timeout: 2345, custom: 'keep' },
          { type: 'command', command: 'echo after' },
        ],
      };
      const settings = {
        model: 'custom-model', permissions: { allow: ['Read'] }, custom: { value: 42 },
        hooks: {
          [event]: legacy ? group : [group, { matcher: 'special', hooks: [{ type: 'command', command: 'echo second-group' }] }],
          SessionStart: [{ hooks: [{ type: 'command', command: 'echo startup' }] }],
        },
      };
      write(f.settingsPath(client), settings);
      write(path.join(f.home, `.${client}`, 'hooks', 'common.js'), 'unrelated shared helper');
      write(oldPath, 'old cgl script');
    }
    const before = clients.map(([client]) => f.readSettings(client));
    assert.equal(f.install().stderr, '');
    for (let index = 0; index < clients.length; index += 1) {
      const [client, event] = clients[index];
      const settings = f.readSettings(client);
      const original = before[index];
      assert.deepEqual({ ...settings, hooks: undefined }, { ...original, hooks: undefined });
      assert.deepEqual(settings.hooks.SessionStart, original.hooks.SessionStart);
      const originalGroups = legacy ? [original.hooks[event]] : original.hooks[event];
      assert.equal(settings.hooks[event].length, originalGroups.length);
      assert.deepEqual(settings.hooks[event].slice(1), originalGroups.slice(1));
      const updated = settings.hooks[event][0];
      assert.deepEqual({ ...updated, hooks: undefined }, { ...originalGroups[0], hooks: undefined });
      assert.deepEqual(updated.hooks[0], originalGroups[0].hooks[0]);
      assert.deepEqual(updated.hooks[2], originalGroups[0].hooks[2]);
      assert.equal(updated.hooks[1].timeout, 2345);
      assert.equal(updated.hooks[1].custom, 'keep');
      assert.equal(updated.hooks[1].type, 'command');
      assert.equal(fs.readFileSync(path.join(f.home, `.${client}`, 'hooks', 'common.js'), 'utf8'), 'unrelated shared helper');
      assert.equal(fs.readFileSync(path.join(f.home, `.${client}`, 'hooks', 'cgl-refine.js'), 'utf8'), 'old cgl script');
    }
    const once = clients.map(([client]) => f.readSettings(client));
    f.install();
    assert.deepEqual(clients.map(([client]) => f.readSettings(client)), once);
  });
}

test('unrelated existing hooks remain in place when adding CGL, including legacy object groups', (t) => {
  const f = fixture(t);
  for (const [client, event] of clients) {
    const group = { matcher: 'custom', hooks: [{ name: 'unrelated', type: 'command', command: 'echo preserve' }] };
    write(f.settingsPath(client), { hooks: { [event]: client === 'claude' ? [group] : group } });
  }
  const before = clients.map(([client, event]) => f.readSettings(client).hooks[event]);
  f.install();
  clients.forEach(([client, event], index) => {
    const settings = f.readSettings(client);
    assert.deepEqual(settings.hooks[event][0], Array.isArray(before[index]) ? before[index][0] : before[index]);
    assert.equal(settings.hooks[event].length, 2);
    assert.equal(ownedHooks(settings, event).length, 1);
  });
});

test('legacy raw command is recognized without relying on the hook name', (t) => {
  const f = fixture(t);
  for (const [client, event] of clients) {
    write(f.settingsPath(client), { hooks: { [event]: { hooks: [{ command: path.join(f.home, `.${client}`, 'hooks', 'cgl-refine.js') }] } } });
  }
  f.install();
  for (const [client, event] of clients) {
    const settings = f.readSettings(client);
    assert.equal(settings.hooks[event].length, 1);
    assert.equal(settings.hooks[event][0].hooks.length, 1);
    assert.equal(ownedHooks(settings, event).length, 1);
  }
});

for (const invalid of ['', '{"unfinished":', 'null', '[]', 'true', '{"hooks":null}', '{"hooks":[]}',
  '{"hooks":{"EVENT":null}}', '{"hooks":{"EVENT":{}}}', '{"hooks":{"EVENT":[{"hooks":"wrong"}]}}',
  '{"hooks":{"EVENT":[{"hooks":[null]}]}}']) {
  test(`malformed settings are preserved byte for byte: ${invalid || 'empty file'}`, (t) => {
    const f = fixture(t);
    for (const [client, event] of clients) {
      write(f.settingsPath(client), invalid.replace('EVENT', event));
    }
    const result = f.install();
    for (const [client, event] of clients) {
      assert.equal(fs.readFileSync(f.settingsPath(client), 'utf8'), invalid.replace('EVENT', event));
      assert.ok(result.stderr.includes(`skipped ${client} hook installation`));
      assert.equal(fs.existsSync(path.join(f.home, `.${client}`, 'hooks', 'codex-gemini-quick-launch')), false);
    }
  });
}

test('a malformed Claude file does not prevent installation for Gemini', (t) => {
  const f = fixture(t);
  write(f.settingsPath('claude'), '{broken');
  f.install();
  assert.equal(ownedHooks(f.readSettings('gemini'), 'BeforeAgent').length, 1);
  assert.equal(fs.readFileSync(f.settingsPath('claude'), 'utf8'), '{broken');
});

test('disabled refinement skips all hook and Codex snippet changes', (t) => {
  const f = fixture(t);
  write(f.settingsPath('claude'), '{leave this alone');
  write(path.join(f.home, 'AGENTS.md'), 'User instructions only.');
  f.install({ CGL_DISABLE_REFINE: '1' });
  assert.equal(fs.readFileSync(f.settingsPath('claude'), 'utf8'), '{leave this alone');
  assert.equal(fs.existsSync(f.settingsPath('gemini')), false);
  assert.equal(fs.existsSync(path.join(f.home, '.claude', 'hooks')), false);
  assert.equal(fs.readFileSync(path.join(f.home, 'AGENTS.md'), 'utf8'), 'User instructions only.');
});

test('installed hooks tolerate empty, malformed and non-object input and honor disable at runtime', (t) => {
  const f = fixture(t);
  f.install();
  for (const [client, event] of clients) {
    const [hook] = ownedHooks(f.readSettings(client), event);
    for (const input of ['', 'not json', 'null', '[]', 'true', '{"cwd":42,"prompt":null}', '{"cwd":"  "}']) {
      const output = executeHook(f, client, hook, input);
      assert.ok(output.hookSpecificOutput.additionalContext.includes(`Working directory: ${f.root}`));
      if (client === 'claude') assert.equal(output.hookSpecificOutput.hookEventName, event);
    }
    const output = executeHook(f, client, hook, '{}', { CGL_DISABLE_REFINE: '1' });
    assert.equal(output.hookSpecificOutput.additionalContext, '');
    if (client === 'claude') assert.equal(output.hookSpecificOutput.hookEventName, event);
  }
});

test('Windows cleanup removes only owned text launchers and preserves unrelated shortcuts and shims (platform simulation)', (t) => {
  const f = fixture(t);
  const programs = path.join(f.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const owned = '@node "C:\\npm\\node_modules\\codex-gemini-quick-launch\\bin\\codex-quick-launch.js"';
  write(path.join(programs, 'codex.bat'), owned);
  const retained = ['gemini.bat', 'claude.bat', 'codex.lnk', 'gemini.lnk', 'claude.lnk'];
  for (const name of retained) write(path.join(programs, name), `Unrelated ${name}`);
  write(path.join(f.binDir, 'codex.cmd'), owned);
  write(path.join(f.binDir, 'codex-cli.cmd'), 'original codex shim');
  write(path.join(f.binDir, 'gemini.cmd'), 'unrelated gemini shim');
  write(path.join(f.binDir, 'gemini-cli.cmd'), 'backup that must not be used');
  f.install({ CGL_TEST_PLATFORM: 'win32' });
  assert.equal(fs.existsSync(path.join(programs, 'codex.bat')), false);
  for (const name of retained) assert.equal(fs.readFileSync(path.join(programs, name), 'utf8'), `Unrelated ${name}`);
  assert.equal(fs.readFileSync(path.join(f.binDir, 'codex.cmd'), 'utf8'), 'original codex shim');
  assert.equal(fs.readFileSync(path.join(f.binDir, 'gemini.cmd'), 'utf8'), 'unrelated gemini shim');
  const [geminiHook] = ownedHooks(f.readSettings('gemini'), 'BeforeAgent');
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  const scriptPath = path.join(f.home, '.gemini', 'hooks', 'codex-gemini-quick-launch', 'cgl-refine.js');
  assert.equal(geminiHook.command, `& ${quote(process.execPath)} ${quote(scriptPath)}`);
  const [claudeHook] = ownedHooks(f.readSettings('claude'), 'UserPromptSubmit');
  assert.equal(claudeHook.command, process.execPath);
  assert.deepEqual(claudeHook.args, [path.join(f.home, '.claude', 'hooks', 'codex-gemini-quick-launch', 'cgl-refine.js')]);
});
