const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const windows = process.platform === 'win32';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgl-launcher-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function launch(provider, args, input, dir, extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(root, 'bin', `${provider}-quick-launch.js`), ...args], {
    cwd: dir,
    env: { ...process.env, HOME: dir, USERPROFILE: dir, LOCALAPPDATA: dir,
      XDG_STATE_HOME: dir, CGL_SKIP_UPDATE: '1', ...extraEnv },
    input,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function answers(provider, { model = true, permissions = '2' } = {}) {
  return ['.', ...(model ? ['1'] : []), ...(windows && provider === 'codex' ? ['3'] : []), permissions, ''].join('\n');
}

for (const provider of ['codex', 'gemini', 'claude']) {
  test(`${provider}: actual wrapper dry run uses the selected directory and configured model`, (t) => {
    const dir = fixture(t);
    const result = launch(provider, ['--no-launch'], answers(provider), dir);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, new RegExp(`Provider : ${provider}`));
    assert.ok(result.stdout.includes(dir));
    const command = result.stdout.split('Command  : ')[1].trim();
    assert.ok(command.startsWith(provider));
    assert.doesNotMatch(command, /(?:^|\s)(?:-m|--model)\s/);
    if (provider === 'codex') assert.match(command, /model_reasoning_effort=high/);
  });

  test(`${provider}: explicit model and allow-all arguments reach the launched process`, (t) => {
    const dir = fixture(t);
    const workspace = path.join(dir, 'workspace with spaces');
    fs.mkdirSync(workspace);
    const capture = path.join(dir, 'capture.json');
    const fake = path.join(dir, 'fake-cli.js');
    fs.writeFileSync(fake, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.CGL_TEST_CAPTURE, JSON.stringify({args: process.argv.slice(2), cwd: process.cwd()}));\nprocess.exit(17);\n`);
    if (windows) {
      fs.writeFileSync(path.join(dir, `${provider}.cmd`), `@echo off\r\n"${process.execPath}" "${fake}" %*\r\nexit /b %errorlevel%\r\n`);
    } else {
      fs.copyFileSync(fake, path.join(dir, provider));
      fs.chmodSync(path.join(dir, provider), 0o755);
    }
    const result = launch(provider, ['--model', 'custom-model-v9'],
      [workspace, ...(windows && provider === 'codex' ? ['3'] : []), '1', ''].join('\n'), dir,
      { PATH: `${dir}${path.delimiter}${process.env.PATH}`, CGL_TEST_CAPTURE: capture });
    assert.equal(result.status, 17, result.stderr + result.stdout);
    const actual = JSON.parse(fs.readFileSync(capture, 'utf8'));
    assert.equal(actual.cwd, workspace);
    const expected = provider === 'claude'
      ? ['--model', 'custom-model-v9', '--dangerously-skip-permissions']
      : provider === 'gemini'
        ? ['-m', 'custom-model-v9', '--sandbox=false', '--approval-mode', 'yolo']
        : ['-m', 'custom-model-v9', '-c', 'model_reasoning_effort=high', '--dangerously-bypass-approvals-and-sandbox'];
    assert.deepEqual(actual.args, expected);
  });
}

test('dry run never checks the network or attempts an update', (t) => {
  const dir = fixture(t);
  const preload = path.join(dir, 'deny-network.js');
  const marker = path.join(dir, 'network-called');
  fs.writeFileSync(preload, `require('node:https').get = () => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called'); throw new Error('network forbidden'); };`);
  const result = launch('claude', ['--no-launch', '--model', 'sonnet'], answers('claude', { model: false }), dir,
    { CGL_SKIP_UPDATE: '', NODE_OPTIONS: `--require="${preload}"` });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(fs.existsSync(marker), false);
});

test('legacy PowerShell option spellings remain case-insensitive', (t) => {
  const result = launch('claude', ['-nolaunch', '-model', 'sonnet'], answers('claude', { model: false }), fixture(t));
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /--model sonnet/);
});

test('closed input reports an error instead of silently succeeding', (t) => {
  const result = launch('gemini', ['--no-launch'], '', fixture(t));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Input closed before configuration was complete/);
});

test('unknown flags and missing model values fail before opening the launcher', (t) => {
  const dir = fixture(t);
  for (const args of [['--unknown'], ['--model'], ['--model', '--no-launch']]) {
    const result = launch('claude', args, '', dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown launcher option|Missing value/);
    assert.doesNotMatch(result.stdout, /Enter full folder/);
  }
});

test('invalid menu selections are retried and a custom model can be entered', (t) => {
  const dir = fixture(t);
  const customIndex = '8';
  const result = launch('claude', ['--no-launch'], ['.', '999', customIndex, 'new-model', '9', '2', ''].join('\n'), dir);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /Invalid selection/);
  assert.match(result.stdout, /--model new-model/);
});

test('Windows resolves native executables as well as npm shims', { skip: !windows }, (t) => {
  const dir = fixture(t);
  const executable = path.join(dir, 'claude.exe');
  fs.copyFileSync(process.env.ComSpec, executable);
  const command = `
    $ErrorActionPreference = 'Stop'
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:CGL_TEST_SCRIPT, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw ($errors | Out-String) }
    $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-CliPath' }, $true)
    . ([scriptblock]::Create($fn.Extent.Text))
    Resolve-CliPath -Cli claude
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      CGL_TEST_SCRIPT: path.join(root, 'scripts', 'agent_launcher.ps1') }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), executable);
});
