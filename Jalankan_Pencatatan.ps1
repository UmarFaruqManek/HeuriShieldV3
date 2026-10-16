# Jalankan server lokal seperti V4; tidak memasang registry atau native host.
$ErrorActionPreference = 'Stop'
$command = Get-Command node -ErrorAction SilentlyContinue
$node = if ($command) { $command.Source } else { $null }
if (-not $node) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
    )
    $node = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $node) { throw 'Node.js diperlukan hanya untuk pencatatan. Pasang Node.js 18+ lalu jalankan ulang.' }
& $node (Join-Path $PSScriptRoot 'tools\extension-capture-server.mjs')
exit $LASTEXITCODE
