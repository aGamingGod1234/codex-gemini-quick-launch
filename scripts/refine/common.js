#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function findGitRoot(startDir) {
  let current = path.resolve(startDir || process.cwd());
  const { root } = path.parse(current);

  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    if (current === root) {
      return null;
    }
    current = path.dirname(current);
  }
}

function firstTruthy(values) {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return '';
}

function detectStackSignals(rootDir) {
  const signals = [];

  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJson = readJson(packageJsonPath);
  if (packageJson) {
    const packageManager = firstTruthy([
      packageJson.packageManager,
      packageJson.engines && packageJson.engines.node ? 'node (engines configured)' : 'node',
    ]);
    signals.push(`Node project (${packageManager || 'node'})`);
  }

  if (fs.existsSync(path.join(rootDir, 'pyproject.toml'))) {
    signals.push('Python project (pyproject.toml)');
  }
  if (fs.existsSync(path.join(rootDir, 'requirements.txt'))) {
    signals.push('Python project (requirements.txt)');
  }
  if (fs.existsSync(path.join(rootDir, 'go.mod'))) {
    signals.push('Go project (go.mod)');
  }
  if (fs.existsSync(path.join(rootDir, 'Cargo.toml'))) {
    signals.push('Rust project (Cargo.toml)');
  }

  if (signals.length === 0) {
    signals.push('No standard stack marker files detected at repository root');
  }

  return { packageJson, signals };
}

function collectSuggestedCommands(rootDir, packageJson) {
  const commands = [];

  if (packageJson && packageJson.scripts && typeof packageJson.scripts === 'object') {
    const preferredOrder = ['lint', 'test', 'build', 'typecheck', 'check'];
    const seen = new Set();

    for (const scriptName of preferredOrder) {
      if (packageJson.scripts[scriptName]) {
        commands.push(`npm run ${scriptName}`);
        seen.add(scriptName);
      }
    }

    for (const scriptName of Object.keys(packageJson.scripts)) {
      if (!seen.has(scriptName) && commands.length < 8) {
        commands.push(`npm run ${scriptName}`);
      }
    }
  }

  if (commands.length === 0) {
    if (fs.existsSync(path.join(rootDir, 'Makefile'))) {
      commands.push('make test', 'make lint');
    }
    if (fs.existsSync(path.join(rootDir, 'pyproject.toml'))) {
      commands.push('pytest', 'ruff check .');
    }
  }

  if (commands.length === 0) {
    commands.push('Run the project\'s existing lint/test command(s) if available');
  }

  return commands.slice(0, 8);
}

function toRelativeSafe(baseDir, targetDir) {
  const rel = path.relative(baseDir, targetDir || baseDir);
  return rel && rel !== '' ? rel : '.';
}

function buildRepoContextPack(input) {
  const cwd = path.resolve((input && input.cwd) || process.cwd());
  const gitRoot = findGitRoot(cwd);
  const rootDir = gitRoot || cwd;
  const { packageJson, signals } = detectStackSignals(rootDir);
  const suggestedCommands = collectSuggestedCommands(rootDir, packageJson);

  return {
    cwd,
    gitRoot,
    rootDir,
    relFromRoot: toRelativeSafe(rootDir, cwd),
    stackSignals: signals,
    suggestedCommands,
  };
}

function buildBestPracticesBlock() {
  return [
    '- Keep edits minimal and scoped to the request.',
    '- State assumptions explicitly and call out risks before major changes.',
    '- Prefer existing project patterns and avoid introducing new dependencies unless required.',
    '- Include concise validation steps and expected outcomes.',
  ].join('\n');
}

function buildRefinementInstruction(contextPack) {
  const locationLine = contextPack.gitRoot
    ? `- Repo root: ${contextPack.rootDir} (current working dir: ${contextPack.relFromRoot})`
    : `- Working directory: ${contextPack.cwd} (git root not detected)`;

  const stackLine = `- Stack signals: ${contextPack.stackSignals.join('; ')}`;
  const commandLine = `- Suggested verify commands: ${contextPack.suggestedCommands.join('; ')}`;

  return [
    'Always begin your next response with a short section titled "Refined Prompt" (or "Refined Spec") before any implementation details or code.',
    'In that section, rewrite the user request into a concrete execution plan covering: objectives, constraints, acceptance criteria, risks, tests, and minimal diffs.',
    'Then proceed immediately to implementation in the same response with no extra confirmation step.',
    '',
    'Repository context:',
    locationLine,
    stackLine,
    commandLine,
    '',
    'Best practices:',
    buildBestPracticesBlock(),
  ].join('\n');
}

module.exports = {
  buildBestPracticesBlock,
  buildRefinementInstruction,
  buildRepoContextPack,
};
