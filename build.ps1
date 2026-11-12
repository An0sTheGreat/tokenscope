# Builds dist\Tokenscope.exe (framework-dependent single file; needs the .NET 10 desktop runtime
# and the WebView2 runtime on the machine). Stops at the first failing step.
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
    dotnet publish src/Tokenscope -c Release -r win-x64 --self-contained false `
        -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none `
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
