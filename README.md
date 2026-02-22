# Codex + Gemini + Claude Quick Launch (Windows, macOS, Linux)

This package installs global quick-launch wrappers that provide the same interactive flow across platforms:

- `codexq`
- `geminiq`
- `claudeq`

Legacy command aliases also work:

- `codex-quick-launch`
- `gemini-quick-launch`
- `claude-quick-launch`

## One-command install

```bash
npm install -g @openai/codex @google/gemini-cli @anthropic-ai/claude-code https://codeload.github.com/aGamingGod1234/codex-gemini-quick-launch/tar.gz/refs/heads/main
```

## Usage

```bash
codexq
geminiq
claudeq
```

Optional dry-run mode:

```bash
codexq --no-launch
geminiq --no-launch
claudeq --no-launch
```

## Claude support

The Claude launcher now supports model aliases documented by Claude Code:

- `default`
- `sonnet`
- `opus`
- `haiku`
- `sonnet[1m]`
- `opusplan`

When you pick “Allow all permissions”, the launcher adds:

- `--dangerously-skip-permissions`


## Automatic updates on launch

The quick-launch wrappers now perform an update check when you run them.

- If no update is available, launch continues normally.
- If an update is available, the wrapper automatically runs:

```bash
npm install -g @openai/codex @google/gemini-cli @anthropic-ai/claude-code https://codeload.github.com/aGamingGod1234/codex-gemini-quick-launch/tar.gz/refs/heads/main
```

- If auto-update succeeds, the launcher continues with the new install.
- If auto-update fails (network/permissions), launch still continues with the current install and prints a warning.

## Filesystem differences: Windows vs macOS/Linux

The launchers account for platform filesystem differences:

- **Path separators:** Windows commonly uses `\`; macOS/Linux use `/`.
- **Case sensitivity:** Windows is usually case-insensitive by default; Linux is case-sensitive; macOS is often case-insensitive by default but can be configured case-sensitive.
- **Home and app-data locations:**
  - Windows: `%USERPROFILE%`, `%APPDATA%`, `%LOCALAPPDATA%`
  - macOS: `$HOME`, plus app data in `~/Library/Application Support`
  - Linux: `$HOME`, with state/config often under XDG paths such as `~/.local/state`
- **Drive roots:** Windows has drive letters (`C:\`), while macOS/Linux use a single root (`/`).

## Notes

- Windows launch flow remains PowerShell-based (`scripts/agent_launcher.ps1`) to preserve existing behavior.
- macOS/Linux use a Node-based interactive launcher (`scripts/agent_launcher_unix.js`) with matching prompts and options.
- Original upstream CLIs stay available directly:
  - `codex`
  - `gemini`
  - `claude`
