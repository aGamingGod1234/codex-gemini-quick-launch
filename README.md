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

Use Node.js **22+** (Node 24 LTS recommended). Install the upstream CLIs you want to use and authenticate with them first. Follow the [Codex installation guide](https://developers.openai.com/codex/cli/), [Gemini installation guide](https://geminicli.com/docs/get-started/installation/), and [Claude Code setup guide](https://code.claude.com/docs/en/setup). Native executables and npm shims on `PATH` are supported, including on Windows.

Then install this launcher:

```bash
npm install -g https://codeload.github.com/aGamingGod1234/codex-gemini-quick-launch/tar.gz/refs/heads/main
```

The install script configures prompt refinement in your home directory as described below. For development, use `npm ci --ignore-scripts` to leave your personal CLI settings untouched.

## Basic usage

```bash
codexq
geminiq
claudeq
```

Optional dry-run (show command without launching, checking for updates, or installing anything):

```bash
codexq --no-launch
geminiq --no-launch
claudeq --no-launch
```

Pass an explicit model without opening the model menu:

```bash
codexq --model configured
geminiq --model flash
claudeq --model sonnet
```

`--model` (also `-m`, or legacy `-Model`) accepts a model ID or alias supported by your installed CLI. `configured` leaves its model setting unchanged. The menus offer that option first, plus provider aliases and an option to enter a model ID. No fixed release allowlist prevents you from using a newly released model. Model availability still depends on your provider and account.

## Overall launch flow

When you run any launcher (`codexq`, `geminiq`, `claudeq`), it follows this high-level flow:

1. **Check for updates** for this quick-launch package (except dry runs or when `CGL_SKIP_UPDATE=1`).
2. If an update is available, it attempts to **auto-update** by running the configured global npm install command.
3. Continue to launcher UI (even if update fails).
4. Ask for target directory (Enter keeps the current directory on macOS/Linux; Windows retains its system-drive-root default).
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
- Model flag: `-m <model>` (omitted for `configured`)
- Adds reasoning config: `-c model_reasoning_effort=<level>` (Windows offers interactive reasoning selection; macOS/Linux uses `high`). See the [official OpenAI configuration documentation](https://learn.chatgpt.com/docs/config-file/config-basic).
- “Allow all permissions” mode adds:
  - `--dangerously-bypass-approvals-and-sandbox`

### Gemini
- Model flag: `-m <model>` (omitted for `configured`)
- “Allow all permissions” mode adds:
  - `--sandbox=false --approval-mode yolo`

### Claude
- Model flag: `--model <alias-or-model>` (omitted for `configured`)
- Supported aliases in launcher:
  - `default`, `sonnet`, `opus`, `haiku`, `sonnet[1m]`, `opusplan`
- “Allow all permissions” mode adds:
  - `--dangerously-skip-permissions`


## Auto Prompt Refinement (global install behavior)

On postinstall, this package configures native prompt hooks for the upstream CLIs so refinement happens even when users run plain `codex`, `claude`, or `gemini` directly (not only `codexq`/`claudeq`/`geminiq`).

Installed artifacts:
- `~/.claude/hooks/codex-gemini-quick-launch/cgl-refine.js` (+ a namespaced `common.js`)
- `~/.gemini/hooks/codex-gemini-quick-launch/cgl-refine.js` (+ a namespaced `common.js`)
- `~/.claude/settings.json` merge: adds/updates `hooks.UserPromptSubmit[].hooks[]` entry named `cgl-auto-refine`
- `~/.gemini/settings.json` merge: adds/updates `hooks.BeforeAgent[].hooks[]` entry named `cgl-auto-refine`
- `~/AGENTS.md` merge: adds/updates a marked Codex instructions block (`CGL_AUTO_REFINE_START`/`CGL_AUTO_REFINE_END`)

Behavior:
- The hook/snippet instructs agents to always output a short **Refined Prompt**/**Refined Spec** section first, then continue implementation in the same response.
- Event entries use the current native hook array schemas, including migration of this package's older object format. Existing settings and other hooks are preserved; malformed settings are left untouched with a warning.
- Claude receives `hookSpecificOutput.hookEventName` and `additionalContext`; Gemini receives `hookSpecificOutput.additionalContext`. Both use the hook input's working directory to find repository context.
- Claude uses an explicit Node executable and argument list; Gemini uses platform-appropriate shell quoting. Hook helpers live in the package's own subdirectory, so another hook's `common.js` is left alone.
- Reinstall after changing the Node installation path to refresh hook commands. See the [Claude hook reference](https://code.claude.com/docs/en/hooks) and [Gemini hook reference](https://geminicli.com/docs/hooks/reference/).

Opt-out:
- Set `CGL_DISABLE_REFINE=1` before installing to skip install/update of refinement config. Installed Claude/Gemini hooks also honor it at runtime; it does not remove the Codex instructions block.
- If you previously installed refinement hooks/snippets, remove the `cgl-auto-refine` hook entries from `~/.claude/settings.json` and `~/.gemini/settings.json`, and remove the marked block from `~/AGENTS.md`.

Manual verification:
1. Launch `claude`, submit any prompt, confirm the first section is **Refined Prompt** (or **Refined Spec**) before coding output.
2. Launch `gemini`, submit any prompt, confirm the first section is **Refined Prompt** (or **Refined Spec**) before coding output.
3. Launch `codex` in a directory under your home folder, submit any prompt, confirm the first section is **Refined Prompt** (or **Refined Spec**) before coding output.

## Automatic updates

The launcher performs periodic update checks (at most once every six hours). If a newer version is detected, it attempts to run:

```bash
npm install -g @openai/codex @google/gemini-cli @anthropic-ai/claude-code https://codeload.github.com/aGamingGod1234/codex-gemini-quick-launch/tar.gz/refs/heads/main
```

Automatic updates retain the original global npm workflow: the launcher and all three upstream CLIs are installed together. Set `CGL_SKIP_UPDATE=1` to skip update checks and installation for offline environments or when you manage CLI versions with their native updaters. `--no-launch` always skips updates.

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

- Requires Node.js **22+**. The launcher has no runtime or development package dependencies.
- Quick launchers do not replace upstream CLIs; they orchestrate launch configuration and then call those CLIs.

## Development and checks

```bash
npm ci --ignore-scripts
npm test
npm pack --dry-run --ignore-scripts
```

Tests use temporary home directories and fake provider executables to exercise the real launcher wrappers, command arguments, exit codes, hook installation, and hook payloads without provider authentication or billable requests. They do not validate live model responses. CI runs Node 22, 24, and 26 on Linux, plus Node 24 on Windows and macOS; Windows tests also cover PowerShell parsing and native executable discovery.

Compatibility references checked on 2026-10-25: npm stable releases [Codex 0.164.0](https://registry.npmjs.org/@openai/codex/latest), [Gemini CLI 0.65.0](https://registry.npmjs.org/@google/gemini-cli/latest), and [Claude Code 2.1.310](https://registry.npmjs.org/@anthropic-ai/claude-code/latest). These are reference versions, not bundled dependencies or model availability guarantees. See the [Node release schedule](https://nodejs.org/en/about/previous-releases) and [Gemini CLI option reference](https://geminicli.com/docs/cli/cli-reference/).
