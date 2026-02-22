# Codex + Gemini Quick Launch (Windows)

This package installs two global commands that reuse your interactive launcher script:

- `codexq`
- `geminiq`

## One-command install

```powershell
npm install -g @openai/codex @google/gemini-cli https://codeload.github.com/aGamingGod1234/codex-gemini-quick-launch/tar.gz/refs/heads/main
```

## Usage

```powershell
codexq
geminiq
```

Legacy commands still work:

```powershell
codex-quick-launch
gemini-quick-launch
```

Original upstream CLIs stay on:

```powershell
codex
gemini
```

## Update

```powershell
npm install -g @openai/codex @google/gemini-cli https://codeload.github.com/aGamingGod1234/codex-gemini-quick-launch/tar.gz/refs/heads/main
```

Both launcher commands now check GitHub and print:
- `New version available`
- the exact `npm install -g ...` command to upgrade

Optional dry-run mode:

```powershell
codexq --no-launch
geminiq --no-launch
```

## Notes

- Windows only.
- Requires PowerShell.
- No Start Menu shortcuts are installed, so nothing new appears in Windows Search.
- The launcher clears the current console and starts Codex/Gemini in that same window.
- The launch flow and UI are provided by `scripts/agent_launcher.ps1`.
