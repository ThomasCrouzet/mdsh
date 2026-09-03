# Lecture seule du runner : aucun argument de processus ni environnement global.
param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][int]$ApplicationPid,
    [Parameter(Mandatory = $true)][int]$DriverPort
)

$ErrorActionPreference = 'Stop'
$diagnosticErrors = [System.Collections.Generic.List[object]]::new()
$report = [ordered]@{
    capturedAt = [DateTime]::UtcNow.ToString('o')
    applicationPid = $ApplicationPid
    driverPort = $DriverPort
    errors = $diagnosticErrors
}

function Save-Report {
    $json = $report | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText(
        (Join-Path $OutputDirectory 'windows-diagnostics.json'),
        $json,
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Read-Diagnostic([string]$Name, [scriptblock]$Action) {
    try {
        $report[$Name] = & $Action
    } catch {
        $diagnosticErrors.Add([ordered]@{
            section = $Name
            type = $_.Exception.GetType().FullName
            message = $_.Exception.Message
        })
    }
    # Sauvegarde progressive si le parent interrompt la collecte au délai maximal.
    Save-Report
}

Save-Report
Read-Diagnostic 'listener' {
    @(Get-NetTCPConnection -LocalPort $DriverPort -State Listen -ErrorAction Stop |
        ForEach-Object {
            [ordered]@{
                address = $_.LocalAddress
                port = $_.LocalPort
                ownerPid = $_.OwningProcess
                matchesApplication = $_.OwningProcess -eq $ApplicationPid
            }
        })
}

Read-Diagnostic 'processes' {
    $allProcesses = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, ExecutablePath, CreationDate)
    $owned = [System.Collections.Generic.HashSet[int]]::new()
    [void]$owned.Add($ApplicationPid)
    do {
        $changed = $false
        foreach ($item in $allProcesses) {
            if ($owned.Contains([int]$item.ParentProcessId) -and $owned.Add([int]$item.ProcessId)) {
                $changed = $true
            }
        }
    } while ($changed)
    @(foreach ($item in $allProcesses) {
        if (-not $owned.Contains([int]$item.ProcessId)) { continue }
        $entry = [ordered]@{
            pid = $item.ProcessId
            parentPid = $item.ParentProcessId
            name = $item.Name
            executable = $item.ExecutablePath
            createdAt = $item.CreationDate
        }
        try {
            $live = Get-Process -Id $item.ProcessId -ErrorAction Stop
            $entry.responding = $live.Responding
            $entry.mainWindowHandle = $live.MainWindowHandle.ToInt64()
            $entry.mainWindowTitle = $live.MainWindowTitle
            $entry.cpuSeconds = $live.CPU
            if ($item.ExecutablePath) {
                $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($item.ExecutablePath)
                $entry.fileVersion = $info.FileVersion
                $entry.productVersion = $info.ProductVersion
            }
        } catch {
            $entry.inspectionError = $_.Exception.Message
        }
        $entry
    })
}

Read-Diagnostic 'directories' {
    $defaultProfile = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'io.github.thomascrouzet.mdsh.smoke'
    $paths = [ordered]@{
        defaultProfile = $defaultProfile
        profileOverride = [Environment]::GetEnvironmentVariable('WEBVIEW2_USER_DATA_FOLDER')
        runtimeOverride = [Environment]::GetEnvironmentVariable('WEBVIEW2_BROWSER_EXECUTABLE_FOLDER')
        temporaryDirectory = [System.IO.Path]::GetTempPath()
    }
    foreach ($folder in @('ProgramFilesX86', 'ProgramFiles', 'LocalApplicationData')) {
        $root = [Environment]::GetFolderPath($folder)
        if ($root) {
            $paths["runtime$folder"] = Join-Path $root 'Microsoft\EdgeWebView\Application'
        }
    }
    @(foreach ($pair in $paths.GetEnumerator()) {
        $entry = [ordered]@{ kind = $pair.Key; path = $pair.Value }
        if ($pair.Value) {
            $entry.exists = Test-Path -LiteralPath $pair.Value -PathType Container
            if ($entry.exists) {
                $item = Get-Item -LiteralPath $pair.Value
                $entry.lastWriteTimeUtc = $item.LastWriteTimeUtc
                if ($pair.Key.StartsWith('runtime')) {
                    $entry.versionDirectories = @(Get-ChildItem -LiteralPath $pair.Value -Directory |
                        Where-Object { $_.Name -match '^\d+(\.\d+){3}$' } |
                        Select-Object -ExpandProperty Name)
                }
            }
        }
        $entry
    })
}

Read-Diagnostic 'browserOverrides' {
    # Les arguments pourraient contenir des informations sensibles : présence seule.
    [ordered]@{
        additionalArgumentsPresent = -not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'))
        releaseChannels = [Environment]::GetEnvironmentVariable('WEBVIEW2_RELEASE_CHANNELS')
        channelSearchKind = [Environment]::GetEnvironmentVariable('WEBVIEW2_CHANNEL_SEARCH_KIND')
    }
}

Read-Diagnostic 'screenshot' {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    if ($bounds.Width -le 0 -or $bounds.Height -le 0 -or $bounds.Width -gt 16384 -or $bounds.Height -gt 16384 -or ([long]$bounds.Width * $bounds.Height) -gt 32000000) {
        throw 'Dimensions du bureau indisponibles ou excessives.'
    }
    $bitmap = $null
    $graphics = $null
    try {
        $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
        $bitmap.Save((Join-Path $OutputDirectory 'windows-desktop.png'), [System.Drawing.Imaging.ImageFormat]::Png)
        [ordered]@{ file = 'windows-desktop.png'; width = $bounds.Width; height = $bounds.Height }
    } finally {
        if ($null -ne $graphics) { $graphics.Dispose() }
        if ($null -ne $bitmap) { $bitmap.Dispose() }
    }
}
