# Codex + Gemini + Claude Quick Launch

Cross-platform interactive launchers for **Codex**, **Gemini**, and **Claude Code**.

This package provides lightweight wrapper commands that help you:
- choose a working directory,
- pick a model,
- choose a permission/sandbox mode,
- and launch your selected CLI with consistent prompts.

It supports:
- **Windows** (PowerShell-based launcher flow)
- **macOS** and **Linux** (Node-based launcher flow)

## Commands installed

Primary short commands:
- `codexq`
- `geminiq`
- `claudeq`

Legacy aliases:
- `codex-quick-launch`
- `gemini-quick-launch`
- `claude-quick-launch`

Your original upstream CLIs remain available directly:
- `codex`
- `gemini`
- `claude`

## Install

```bash
npm install -g @openai/codex @google/gemini-cli @anthropic-ai/claude-code https://codeload.github.com/aGamingGod1234/codex-gemini-quick-launch/tar.gz/refs/heads/main
```

## Basic usage

```bash
codexq
geminiq
claudeq
```

Optional dry-run (show command without launching):

```bash
codexq --no-launch
geminiq --no-launch
claudeq --no-launch
```

## Overall launch flow

When you run any launcher (`codexq`, `geminiq`, `claudeq`), it follows this high-level flow:

1. **Check for updates** for this quick-launch package.
2. If an update is available, it attempts to **auto-update** by running the configured global npm install command.
3. Continue to launcher UI (even if update fails).
4. Ask for target directory.
5. Ask for model (unless passed by arg where supported).
6. Ask for permission/sandbox mode.
7. Show summary.
8. Launch selected CLI (or print command if `--no-launch`).

## Platform behavior

### Windows
- Uses `scripts/agent_launcher.ps1`.
- Keeps the existing PowerShell interactive behavior.
- Supports providers: `codex`, `gemini`, `claude`.

### macOS/Linux
- Uses `scripts/agent_launcher_unix.js`.
- Provides matching interactive flow in Node.js.
- Supports providers: `codex`, `gemini`, `claude`.

## Provider behavior

### Codex
- Model flag: `-m <model>`
- Adds reasoning config: `-c reasoning_effort=<level>` (Windows flow uses interactive reasoning selection)
- “Allow all permissions” mode adds:
  - `--dangerously-bypass-approvals-and-sandbox`

### Gemini
- Model flag: `-m <model>`
- “Allow all permissions” mode adds:
  - `-s false --approval-mode yolo`

### Claude
- Model flag: `--model <alias-or-model>`
- Supported aliases in launcher:
  - `default`, `sonnet`, `opus`, `haiku`, `sonnet[1m]`, `opusplan`
- “Allow all permissions” mode adds:
  - `--dangerously-skip-permissions`


## Auto Prompt Refinement (global install behavior)

On postinstall, this package configures native prompt hooks for the upstream CLIs so refinement happens even when users run plain `codex`, `claude`, or `gemini` directly (not only `codexq`/`claudeq`/`geminiq`).

Installed artifacts:
- `~/.claude/hooks/cgl-refine.js` (+ `~/.claude/hooks/common.js`)
- `~/.gemini/hooks/cgl-refine.js` (+ `~/.gemini/hooks/common.js`)
- `~/.claude/settings.json` merge: adds/updates `hooks.UserPromptSubmit.hooks[]` entry named `cgl-auto-refine`
- `~/.gemini/settings.json` merge: adds/updates `hooks.BeforeAgent.hooks[]` entry named `cgl-auto-refine`
- `~/AGENTS.md` merge: adds/updates a marked Codex instructions block (`CGL_AUTO_REFINE_START`/`CGL_AUTO_REFINE_END`)

Behavior:
- The hook/snippet instructs agents to always output a short **Refined Prompt**/**Refined Spec** section first, then continue implementation in the same response.
- Settings merges are non-destructive: existing keys and other hooks are preserved.

Opt-out:
- Set `CGL_DISABLE_REFINE=1` and rerun postinstall (`npm install -g ...`) to skip install/update of refinement config.
- If you previously installed refinement hooks/snippets, remove the `cgl-auto-refine` hook entries from `~/.claude/settings.json` and `~/.gemini/settings.json`, and remove the marked block from `~/AGENTS.md`.

Manual verification:
1. Launch `claude`, submit any prompt, confirm the first section is **Refined Prompt** (or **Refined Spec**) before coding output.
2. Launch `gemini`, submit any prompt, confirm the first section is **Refined Prompt** (or **Refined Spec**) before coding output.
3. Launch `codex` in a directory under your home folder, submit any prompt, confirm the first section is **Refined Prompt** (or **Refined Spec**) before coding output.

## Automatic updates

The launcher performs periodic update checks. If a newer version is detected, it attempts to run:

```bash
npm install -g @openai/codex @google/gemini-cli @anthropic-ai/claude-code https://codeload.github.com/aGamingGod1234/codex-gemini-quick-launch/tar.gz/refs/heads/main
```

Behavior:
- If update succeeds, launcher proceeds using updated installation.
- If update fails (network, permissions, npm issues), it prints a warning and continues with current installed version.

## Filesystem differences handled

The project accounts for core platform filesystem differences:
- **Separators**: Windows commonly `\`, macOS/Linux `/`
- **Case sensitivity**:
  - Windows: typically case-insensitive
  - Linux: case-sensitive
  - macOS: commonly case-insensitive by default (can vary)
- **User/app data locations**:
  - Windows: `%USERPROFILE%`, `%APPDATA%`, `%LOCALAPPDATA%`
  - macOS: `$HOME`, `~/Library/Application Support`
  - Linux: `$HOME`, often XDG dirs such as `~/.local/state`
- **Path roots**:
  - Windows: drive letters (`C:\`)
  - macOS/Linux: single root (`/`)

## Repository structure (important files)

- `bin/codex-quick-launch.js` – codex command wrapper
- `bin/gemini-quick-launch.js` – gemini command wrapper
- `bin/claude-quick-launch.js` – claude command wrapper
- `scripts/agent_launcher.ps1` – Windows interactive launcher
- `scripts/agent_launcher_unix.js` – macOS/Linux interactive launcher
- `scripts/update-check.js` – update detection + auto-update logic
- `scripts/postinstall.js` – install metadata + Windows legacy shim cleanup

## Notes

- Requires Node.js **18+**.
- Quick launchers do not replace upstream CLIs; they orchestrate launch configuration and then call those CLIs.
