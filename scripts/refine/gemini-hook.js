#!/usr/bin/env node
const { buildRefinementInstruction, buildRepoContextPack } = require('./common');

function readStdinJson() {
  try {
    const raw = require('fs').readFileSync(0, 'utf8').trim();
    const input = raw ? JSON.parse(raw) : {};
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  } catch (_error) {
    return {};
  }
}

if (process.env.CGL_DISABLE_REFINE === '1') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: '' } }));
  process.exit(0);
}

const input = readStdinJson();
const contextPack = buildRepoContextPack({
  cwd: typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd : process.cwd(),
  prompt: typeof input.prompt === 'string' ? input.prompt : '',
});
const additionalContext = buildRefinementInstruction(contextPack);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    additionalContext,
  },
}));
