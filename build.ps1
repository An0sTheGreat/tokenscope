# Builds dist\Tokenscope.exe as a single file. Stops at the first failing step.
#   ./build.ps1              small (about 6 MB); needs the .NET 10 desktop runtime on the machine
#   ./build.ps1 -Standalone  carries its own .NET runtime; this is the release download
# Both need the WebView2 runtime, which ships with Windows 11 and current Windows 10.
param([switch]$Standalone)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot   # restored in the finally block, so the caller's shell stays where it was
try {

function Step($name, [scriptblock]$run) {
    Write-Host "== $name"
    & $run
    if ($LASTEXITCODE -ne 0) { throw "$name failed (exit $LASTEXITCODE)" }
}

Step 'Fetch engine' { node scripts/fetch-engine.mjs }
Step 'UI tests' { node --test "tests/*.test.mjs" }
Step 'Publish' {
    dotnet publish src/Tokenscope -c Release -r win-x64 --self-contained $Standalone `
        -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=$Standalone -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none `
        -o dist --nologo -v quiet
}
Step 'Host self-check' {
    # A WinExe does not block the shell, so wait for it explicitly to read its exit code.
    $p = Start-Process -FilePath dist/Tokenscope.exe -ArgumentList '--selfcheck' -PassThru -Wait
    $global:LASTEXITCODE = $p.ExitCode
}
Remove-Item dist/*.xml -ErrorAction SilentlyContinue   # WebView2 doc files the publish step copies
Write-Host "Built $(Resolve-Path dist/Tokenscope.exe)"
} finally { Pop-Location }
