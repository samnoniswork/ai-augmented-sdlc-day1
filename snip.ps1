$cli = Join-Path $PSScriptRoot 'cli.js'
& node $cli @args
exit $LASTEXITCODE
