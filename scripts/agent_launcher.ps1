param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('codex', 'gemini')]
    [string]$Provider,
    [Alias('m')]
    [string]$Model,
    [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:LastEscPressAt = [datetime]::MinValue

function Ensure-WindowMaximized {
    try {
        $signature = @'
[DllImport("user32.dll")]
public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
'@
        Add-Type -MemberDefinition $signature -Name Win32ShowWindow -Namespace Launcher -ErrorAction SilentlyContinue | Out-Null
        $proc = Get-Process -Id $PID -ErrorAction SilentlyContinue
        if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
            # SW_MAXIMIZE = 3
            [Launcher.Win32ShowWindow]::ShowWindowAsync($proc.MainWindowHandle, 3) | Out-Null
        }
    }
    catch {
        # Non-fatal if maximize is unavailable in current host.
    }
}

function Ensure-WindowForeground {
    try {
        $proc = Get-Process -Id $PID -ErrorAction SilentlyContinue
        if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
            [Launcher.Win32ShowWindow]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
        }
    }
    catch {
        # Non-fatal if foreground activation is blocked by Windows focus rules.
    }
}

function Prepare-InputPrompt {
    try { [Console]::CursorVisible = $true } catch {}
    try {
        $proc = Get-Process -Id $PID -ErrorAction SilentlyContinue
        if ($proc -and $proc.MainWindowTitle) {
            $wshell = New-Object -ComObject WScript.Shell
            $null = $wshell.AppActivate($proc.MainWindowTitle)
        }
    }
    catch {
        # Non-fatal if activation fails.
    }
}

function Read-InputLine {
    param([Parameter(Mandatory = $true)][string]$Prompt)

    Prepare-InputPrompt
    Write-Host -NoNewline ($Prompt + ': ')
    $buffer = New-Object System.Text.StringBuilder

    while ($true) {
        $keyInfo = $host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        $vk = $keyInfo.VirtualKeyCode

        if ($vk -eq 13) {
            Write-Host ''
            $script:LastEscPressAt = [datetime]::MinValue
            return $buffer.ToString()
        }

        if ($vk -eq 8) {
            if ($buffer.Length -gt 0) {
                $buffer.Length = $buffer.Length - 1
                Write-Host -NoNewline "`b `b"
            }
            continue
        }

        if ($vk -eq 27) {
            $now = Get-Date
            if (($now - $script:LastEscPressAt).TotalSeconds -le 1.5) {
                Write-Host ''
                Write-Host 'Closing configuration...' -ForegroundColor Yellow
                exit 0
            }

            $script:LastEscPressAt = $now
            Write-Host ''
            Write-Host 'Press Esc again to close configuration.' -ForegroundColor Yellow
            Write-Host -NoNewline ($Prompt + ': ' + $buffer.ToString())
            continue
        }

        $ch = $keyInfo.Character
        if (-not [char]::IsControl($ch)) {
            [void]$buffer.Append($ch)
            Write-Host -NoNewline $ch
        }
    }
}

function Write-Section {
    param([string]$Title)
    Write-Host ''
    Write-Host ('=' * 60) -ForegroundColor DarkGray
    Write-Host $Title -ForegroundColor Cyan
    Write-Host ('=' * 60) -ForegroundColor DarkGray
}

function Show-NumberedMenu {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [string[]]$Options,
        [string]$Prompt = $null
    )

    if ([string]::IsNullOrWhiteSpace($Prompt)) {
        $Prompt = 'Select 1-{0}' -f $Options.Count
    }

    Write-Section -Title $Title
    for ($i = 0; $i -lt $Options.Count; $i++) {
        Write-Host (' {0}. {1}' -f ($i + 1), $Options[$i])
    }

    while ($true) {
        $raw = Read-InputLine -Prompt $Prompt
        [int]$choice = 0
        if ([int]::TryParse($raw, [ref]$choice) -and $choice -ge 1 -and $choice -le $Options.Count) {
            return ($choice - 1)
        }
        Write-Host 'Invalid selection. Try again.' -ForegroundColor Yellow
    }
}

function Get-SearchRoots {
    $userHome = [Environment]::GetFolderPath('UserProfile')
    $roaming = [Environment]::GetFolderPath('ApplicationData')
    $local = [Environment]::GetFolderPath('LocalApplicationData')
    $roots = @(
        $userHome,
        $roaming,
        $local,
        [Environment]::GetFolderPath('Desktop'),
        [Environment]::GetFolderPath('MyDocuments'),
        (Join-Path $userHome 'Downloads'),
        (Join-Path $userHome 'source'),
        (Join-Path $userHome 'source\\repos')
    )

    return $roots |
        Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } |
        Select-Object -Unique
}

function Get-FolderMatches {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Needle,
        [int]$Limit = 5
    )

    $needleLower = $Needle.ToLowerInvariant()
    $depthSupported = (Get-Command Get-ChildItem).Parameters.ContainsKey('Depth')
    $roots = @(Get-SearchRoots)
    $byPath = @{}

    if ($roots.Count -eq 0) {
        return @()
    }

    # Pass 1: count total directories so percent complete is accurate.
    $totalDirs = 0
    for ($i = 0; $i -lt $roots.Count; $i++) {
        $root = $roots[$i]
        $prepPct = [int]([Math]::Round((($i + 1) * 100.0) / $roots.Count, 0))
        Write-Progress -Id 1 -Activity 'Preparing search' -Status ('Counting folders in root {0}/{1}' -f ($i + 1), $roots.Count) -PercentComplete $prepPct
        try {
            $countParams = @{
                Path        = $root
                Directory   = $true
                Recurse     = $true
                Force       = $true
                ErrorAction = 'SilentlyContinue'
            }
            if ($depthSupported) {
                $countParams['Depth'] = 14
            }
            $totalDirs += (Get-ChildItem @countParams | Measure-Object).Count
        }
        catch {
            # Skip roots that cannot be scanned completely.
        }
    }

    if ($totalDirs -eq 0) {
        Write-Progress -Id 1 -Activity 'Searching folders' -Completed
        return @()
    }

    # Pass 2: scan with accurate processed/total progress.
    $processed = 0
    foreach ($root in $roots) {
        try {
            $gciParams = @{
                Path        = $root
                Directory   = $true
                Recurse     = $true
                Force       = $true
                ErrorAction = 'SilentlyContinue'
            }
            if ($depthSupported) {
                # Deeper scan so hidden paths like AppData\Roaming\.minecraft are found.
                $gciParams['Depth'] = 14
            }

            Get-ChildItem @gciParams | ForEach-Object {
                $processed++
                if (($processed % 250) -eq 0 -or $processed -eq $totalDirs) {
                    $pct = [int]([Math]::Min(100, [Math]::Round(($processed * 100.0) / $totalDirs, 0)))
                    Write-Progress -Id 1 -Activity 'Searching folders' -Status ('Processed {0} of {1} folders' -f $processed, $totalDirs) -PercentComplete $pct
                }

                $name = $_.Name
                $nameLower = $name.ToLowerInvariant()

                if (-not $nameLower.Contains($needleLower)) {
                    return
                }

                $score = 0
                if ($nameLower -eq $needleLower) { $score += 120 }
                if ($nameLower.StartsWith($needleLower)) { $score += 80 }
                $score += 40
                $score += [Math]::Max(0, 25 - [Math]::Abs($name.Length - $Needle.Length))

                $path = $_.FullName
                $pathLower = $path.ToLowerInvariant()
                if ($pathLower.Contains('\desktop\')) { $score += 6 }
                if ($pathLower.Contains('\documents\')) { $score += 4 }
                if ($pathLower.Contains('\downloads\')) { $score += 3 }

                $depth = ($path -split '[\\/]').Count
                $candidate = [PSCustomObject]@{
                    Path  = $path
                    Score = $score
                    Depth = $depth
                }

                if (-not $byPath.ContainsKey($path) -or $candidate.Score -gt $byPath[$path].Score) {
                    $byPath[$path] = $candidate
                }
            }
        }
        catch {
            # Skip roots that cannot be scanned completely.
        }
    }

    Write-Progress -Id 1 -Activity 'Searching folders' -Completed

    return $byPath.Values |
        Sort-Object -Property @(
            @{ Expression = 'Score'; Descending = $true },
            @{ Expression = 'Depth'; Descending = $false },
            @{ Expression = 'Path'; Descending = $false }
        ) |
        Select-Object -First $Limit
}

function Select-DirectoryFromSearch {
    param([string]$Needle)

    Write-Host ('Searching for folders matching "{0}"...' -f $Needle) -ForegroundColor DarkCyan
    $matches = @(Get-FolderMatches -Needle $Needle -Limit 5)

    if ($matches.Count -eq 0) {
        Write-Host 'No matches found. Enter the full folder path manually.' -ForegroundColor Yellow
        while ($true) {
            $manual = Read-InputLine -Prompt 'Enter full folder path'
            if (Test-Path -LiteralPath $manual -PathType Container) {
                return (Resolve-Path -LiteralPath $manual).Path
            }
            Write-Host 'That path is not a valid folder.' -ForegroundColor Yellow
        }
    }

    Write-Section -Title 'Top matches'
    for ($i = 0; $i -lt $matches.Count; $i++) {
        Write-Host (' {0}. {1}' -f ($i + 1), $matches[$i].Path)
    }
    $manualIndex = $matches.Count + 1
    Write-Host (' {0}. Enter full path manually' -f $manualIndex)

    while ($true) {
        $pickRaw = Read-InputLine -Prompt ('Select 1-{0}' -f $manualIndex)
        [int]$pick = 0
        if (-not [int]::TryParse($pickRaw, [ref]$pick)) {
            Write-Host 'Invalid selection. Try again.' -ForegroundColor Yellow
            continue
        }

        if ($pick -ge 1 -and $pick -le $matches.Count) {
            return $matches[$pick - 1].Path
        }

        if ($pick -eq $manualIndex) {
            $manual = Read-InputLine -Prompt 'Enter full folder path'
            if (Test-Path -LiteralPath $manual -PathType Container) {
                return (Resolve-Path -LiteralPath $manual).Path
            }
            Write-Host 'That path is not a valid folder.' -ForegroundColor Yellow
            continue
        }

        Write-Host 'Invalid selection. Try again.' -ForegroundColor Yellow
    }
}

function Resolve-WorkingDirectory {
    while ($true) {
        Write-Section -Title 'Workspace'
        $inputValue = Read-InputLine -Prompt 'Enter full folder path or folder name (press Enter for no specific directory)'

        if ([string]::IsNullOrWhiteSpace($inputValue)) {
            $driveRoot = ([System.IO.Path]::GetPathRoot($env:SystemDrive + '\'))
            if (-not (Test-Path -LiteralPath $driveRoot -PathType Container)) {
                $driveRoot = 'C:\'
            }
            Write-Section -Title 'Selected directory'
            Write-Host ('No specific directory selected. Using drive root: {0}' -f $driveRoot)
            return $driveRoot
        }

        $trimmed = $inputValue.Trim()
        $selectedPath = $null

        if (Test-Path -LiteralPath $trimmed -PathType Container) {
            $selectedPath = (Resolve-Path -LiteralPath $trimmed).Path
        }
        else {
            $selectedPath = Select-DirectoryFromSearch -Needle $trimmed
        }

        Write-Section -Title 'Selected directory'
        Write-Host $selectedPath
        return $selectedPath
    }
}

function Resolve-CliPath {
    param([ValidateSet('codex', 'gemini')][string]$Cli)

    $cmdName = '{0}.cmd' -f $Cli
    $cmd = Get-Command $cmdName -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }

    $fallback = Join-Path $env:APPDATA ('npm\{0}' -f $cmdName)
    if (Test-Path -LiteralPath $fallback -PathType Leaf) {
        return $fallback
    }

    throw ('Could not find {0}. Install it first or ensure it is in PATH.' -f $cmdName)
}

function Quote-CmdArg {
    param([string]$Arg)

    if ($Arg -match '[\s"&|<>^()]') {
        return '"' + $Arg.Replace('"', '""') + '"'
    }
    return $Arg
}

function Join-CommandParts {
    param([string[]]$Parts)
    return ($Parts | ForEach-Object { Quote-CmdArg -Arg $_ }) -join ' '
}

function Resolve-ModelSelection {
    param(
        [ValidateSet('codex', 'gemini')][string]$Provider,
        [string]$InputModel,
        [hashtable[]]$Choices,
        [string]$MenuTitle
    )

    if ([string]::IsNullOrWhiteSpace($InputModel)) {
        $modelIndex = Show-NumberedMenu -Title $MenuTitle -Options ($Choices | ForEach-Object { $_.Label })
        return $Choices[$modelIndex].Value
    }

    $trimmed = $InputModel.Trim()
    $match = $Choices | Where-Object { $_.Value -ieq $trimmed } | Select-Object -First 1
    if ($match) {
        return $match.Value
    }

    $supported = ($Choices | ForEach-Object { $_.Value }) -join ', '
    throw ('Unsupported model "{0}" for provider "{1}". Supported values: {2}' -f $trimmed, $Provider, $supported)
}

function Build-LaunchParts {
    param(
        [ValidateSet('codex', 'gemini')][string]$Provider,
        [string]$Model,
        [string]$Reasoning,
        [ValidateSet('allow_all', 'none')][string]$PermissionMode
    )

    $parts = New-Object System.Collections.Generic.List[string]
    $cliPath = Resolve-CliPath -Cli $Provider
    $parts.Add($cliPath)

    $parts.Add('-m')
    $parts.Add($Model)

    if ($Provider -eq 'codex') {
        $parts.Add('-c')
        $parts.Add('reasoning_effort=' + $Reasoning)

        if ($PermissionMode -eq 'allow_all') {
            $parts.Add('--dangerously-bypass-approvals-and-sandbox')
        }
    }
    else {
        if ($PermissionMode -eq 'allow_all') {
            $parts.Add('-s')
            $parts.Add('false')
            $parts.Add('--approval-mode')
            $parts.Add('yolo')
        }
    }

    return ,$parts.ToArray()
}

$providerTitle = $Provider.ToUpperInvariant()
$host.UI.RawUI.WindowTitle = '{0} Quick Launcher' -f $providerTitle
Ensure-WindowMaximized
Ensure-WindowForeground
Write-Section -Title ('{0} Quick Launcher' -f $providerTitle)
Write-Host 'Tip: Press Esc twice quickly at any prompt to close configuration.' -ForegroundColor DarkYellow

$workingDir = Resolve-WorkingDirectory

$modelSelection = $null
$reasoningEffort = $null

if ($Provider -eq 'codex') {
    $codexModels = @(
        @{ Label = 'gpt 5.3 codex (gpt-5.3-codex)'; Value = 'gpt-5.3-codex' },
        @{ Label = 'gpt 5.2 codex (gpt-5.2-codex)'; Value = 'gpt-5.2-codex' },
        @{ Label = 'gpt 5.2 (gpt-5.2)'; Value = 'gpt-5.2' },
        @{ Label = 'gpt 5.1-max (gpt-5.1-max)'; Value = 'gpt-5.1-max' },
        @{ Label = 'gpt 5.1-mini (gpt-5.1-mini)'; Value = 'gpt-5.1-mini' }
    )
    $modelSelection = Resolve-ModelSelection -Provider $Provider -InputModel $Model -Choices $codexModels -MenuTitle 'Select Codex model'

    $reasoningOptions = @(
        @{ Label = 'low'; Value = 'low' },
        @{ Label = 'medium'; Value = 'medium' },
        @{ Label = 'high'; Value = 'high' },
        @{ Label = 'extra high'; Value = 'xhigh' }
    )
    $reasoningIndex = Show-NumberedMenu -Title 'Select reasoning level' -Options ($reasoningOptions | ForEach-Object { $_.Label })
    $reasoningEffort = $reasoningOptions[$reasoningIndex].Value
}
else {
    $geminiModels = @(
        @{ Label = 'gemini-3-pro-preview'; Value = 'gemini-3-pro-preview' },
        @{ Label = 'gemini-3-flash-preview'; Value = 'gemini-3-flash-preview' },
        @{ Label = 'gemini-2.5-pro'; Value = 'gemini-2.5-pro' },
        @{ Label = 'gemini-2.5-flash'; Value = 'gemini-2.5-flash' },
        @{ Label = 'gemini-2.5-flash-lite'; Value = 'gemini-2.5-flash-lite' }
    )
    $modelSelection = Resolve-ModelSelection -Provider $Provider -InputModel $Model -Choices $geminiModels -MenuTitle 'Select Gemini model'
}

$sandboxOptions = $null
if ($Provider -eq 'gemini') {
    $sandboxOptions = @(
        'Allow all permissions (no Docker sandbox)',
        'No modifications besides model and directory'
    )
}
else {
    $sandboxOptions = @(
        'Allow all permissions (bypass approvals and sandbox)',
        'No modifications besides model and directory'
    )
}

$sandboxIndex = Show-NumberedMenu -Title 'Sandbox option' -Options $sandboxOptions
$permissionMode = $(if ($sandboxIndex -eq 0) { 'allow_all' } else { 'none' })

$commandParts = Build-LaunchParts -Provider $Provider -Model $modelSelection -Reasoning $reasoningEffort -PermissionMode $permissionMode
$cmdLine = Join-CommandParts -Parts $commandParts

Write-Section -Title 'Summary'
Write-Host ('Provider : {0}' -f $Provider)
Write-Host ('Folder   : {0}' -f $workingDir)
Write-Host ('Model    : {0}' -f $modelSelection)
if ($Provider -eq 'codex') {
    Write-Host ('Reasoning: {0}' -f $reasoningEffort)
    Write-Host ('Mode     : {0}' -f ($(if ($permissionMode -eq 'allow_all') { 'Allow all permissions (bypass approvals and sandbox)' } else { 'No modifications besides model and directory' })))
}
else {
    Write-Host ('Mode     : {0}' -f ($(if ($permissionMode -eq 'allow_all') { 'Allow all permissions (no Docker sandbox)' } else { 'No modifications besides model and directory' })))
}

if ($NoLaunch) {
    Write-Host ('Command  : {0}' -f $cmdLine) -ForegroundColor DarkGray
    exit 0
}

Write-Host ''
Write-Host 'Clearing current window and launching here...' -ForegroundColor Green
try {
    Clear-Host
}
catch {
    try { [Console]::Clear() } catch {}
}

$cliPath = $commandParts[0]
$cliArgs = @()
if ($commandParts.Count -gt 1) {
    $cliArgs = $commandParts[1..($commandParts.Count - 1)]
}

$exitCode = 1
Push-Location -LiteralPath $workingDir
try {
    & $cliPath @cliArgs
    $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
}
finally {
    Pop-Location
}

exit $exitCode

