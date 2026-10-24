#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const { parseArgs } = require('./launcher-args');

function getSearchRoots() {
  const home = os.homedir();
  const roots = [
    home,
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
    path.join(home, 'src'),
    path.join(home, 'code'),
    '/opt',
    '/usr/local/src',
  ];
  return roots.filter((item, index) => item && fs.existsSync(item) && fs.statSync(item).isDirectory() && roots.indexOf(item) === index);
}

function findDirMatches(needle, limit = 5) {
  const lowerNeedle = needle.toLowerCase();
  const matches = [];
  for (const root of getSearchRoots()) {
    try {
      const queue = [{ p: root, d: 0 }];
      while (queue.length > 0) {
        const { p, d } = queue.shift();
        if (d > 6) {
          continue;
        }
        let entries;
        try {
          entries = fs.readdirSync(p, { withFileTypes: true });
        } catch (_error) {
          continue;
        }
        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }
          const full = path.join(p, entry.name);
          const lowerName = entry.name.toLowerCase();
          if (lowerName.includes(lowerNeedle)) {
            let score = 0;
            if (lowerName === lowerNeedle) {
              score += 120;
            }
            if (lowerName.startsWith(lowerNeedle)) {
              score += 80;
            }
            score += 40;
            score += Math.max(0, 25 - Math.abs(entry.name.length - needle.length));
            matches.push({ path: full, score, depth: d + 1 });
          }
          queue.push({ p: full, d: d + 1 });
        }
      }
    } catch (_error) {
      // ignore unreadable roots
    }
  }

  const deduped = new Map();
  for (const match of matches) {
    const existing = deduped.get(match.path);
    if (!existing || match.score > existing.score) {
      deduped.set(match.path, match);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => b.score - a.score || a.depth - b.depth || a.path.localeCompare(b.path))
    .slice(0, limit);
}

function quoteArg(arg) {
  if (/[^A-Za-z0-9_\-./]/.test(arg)) {
    return `'${arg.replace(/'/g, `'"'"'`)}'`;
  }
  return arg;
}

function buildCommand(provider, model, permissionMode) {
  const parts = [provider];
  if (provider === 'claude') {
    if (model !== 'configured') parts.push('--model', model);
    if (permissionMode === 'allow_all') {
      parts.push('--dangerously-skip-permissions');
    }
    return parts;
  }

  if (model !== 'configured') parts.push('-m', model);
  if (provider === 'codex') {
    parts.push('-c', 'model_reasoning_effort=high');
    if (permissionMode === 'allow_all') {
      parts.push('--dangerously-bypass-approvals-and-sandbox');
    }
  }
  if (provider === 'gemini' && permissionMode === 'allow_all') {
    parts.push('--sandbox=false', '--approval-mode', 'yolo');
  }
  return parts;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const provider = options.provider;
  if (!provider || !['codex', 'gemini', 'claude'].includes(provider)) {
    console.error('Missing or invalid --provider.');
    process.exit(1);
  }

  const models = {
    codex: ['configured', 'custom'],
    gemini: ['configured', 'auto', 'pro', 'flash', 'flash-lite', 'custom'],
    claude: ['configured', 'default', 'sonnet', 'opus', 'haiku', 'sonnet[1m]', 'opusplan', 'custom'],
  };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt) => {
    process.stdout.write(prompt);
    const { value, done } = await lines.next();
    if (done) throw new Error('Input closed before configuration was complete.');
    return value.trim();
  };
  const select = async (count) => {
    while (true) {
      const value = Number(await ask(`Select 1-${count}: `));
      if (Number.isInteger(value) && value >= 1 && value <= count) return value;
      console.log('Invalid selection. Try again.');
    }
  };

  let workingDir = await ask('Enter full folder path or folder name (Enter for current directory): ');
  if (!workingDir.trim()) {
    workingDir = process.cwd();
  } else if (!fs.existsSync(workingDir)) {
    const matches = findDirMatches(workingDir.trim());
    if (matches.length > 0) {
      console.log('\nTop matches:');
      matches.forEach((match, idx) => console.log(` ${idx + 1}. ${match.path}`));
      console.log(` ${matches.length + 1}. Enter full path manually`);
      const selected = await select(matches.length + 1);
      if (selected >= 1 && selected <= matches.length) {
        workingDir = matches[selected - 1].path;
      } else {
        workingDir = await ask('Enter full folder path: ');
      }
    }
  }

  if (!fs.existsSync(workingDir) || !fs.statSync(workingDir).isDirectory()) {
    console.error('Invalid directory selected.');
    rl.close();
    process.exit(1);
  }

  workingDir = path.resolve(workingDir);

  let selectedModel = options.model;
  if (!selectedModel) {
    console.log('\nSelect model:');
    models[provider].forEach((model, idx) => console.log(` ${idx + 1}. ${model === 'configured' ? 'Use CLI configured/default model' : model === 'custom' ? 'Enter model ID or alias' : model}`));
    const idx = await select(models[provider].length);
    selectedModel = models[provider][idx - 1];
    if (selectedModel === 'custom') {
      do {
        selectedModel = await ask('Enter model ID or alias: ');
      } while (!selectedModel || selectedModel.startsWith('-'));
    }
  }

  console.log('\nSandbox option:');
  console.log(' 1. Allow all permissions');
  console.log(' 2. No modifications besides model and directory');
  const sandboxChoice = await select(2);
  const permissionMode = sandboxChoice === 1 ? 'allow_all' : 'none';

  const commandParts = buildCommand(provider, selectedModel, permissionMode);
  const preview = commandParts.map(quoteArg).join(' ');

  console.log('\nSummary');
  console.log(`Provider : ${provider}`);
  console.log(`Folder   : ${workingDir}`);
  console.log(`Model    : ${selectedModel}`);
  console.log(`Mode     : ${permissionMode === 'allow_all' ? 'Allow all permissions' : 'No modifications besides model and directory'}`);
  if (options.noLaunch) {
    console.log(`Command  : ${preview}`);
    rl.close();
    process.exit(0);
  }

  rl.close();
  const child = spawn(commandParts[0], commandParts.slice(1), { stdio: 'inherit', cwd: workingDir });
  child.on('error', (error) => {
    console.error(`Failed to launch ${provider}: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
