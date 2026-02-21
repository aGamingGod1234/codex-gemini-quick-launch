# Codex + Gemini Quick Launch (Windows)

This package installs two global commands that reuse your interactive launcher script:

- `codex-quick-launch`
- `gemini-quick-launch`

## One-command install

```powershell
npm install -g @openai/codex @google/gemini-cli github:aGamingGod1234/codex-gemini-quick-launch
```

## Usage

```powershell
codex-quick-launch
gemini-quick-launch
```

Optional dry-run mode:

```powershell
codex-quick-launch --no-launch
gemini-quick-launch --no-launch
```

## Notes

- Windows only.
- Requires PowerShell.
- The launch flow and UI are provided by `scripts/agent_launcher.ps1`.
