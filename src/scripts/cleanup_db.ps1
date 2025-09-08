param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$SqlPath = ".\cleanup_all.sql",
  [string]$Psql = "psql"
)

Write-Host "== cleanup_db.ps1 ==" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $SqlPath)) {
  Write-Error "SQL file not found: $SqlPath"
  exit 1
}
if (-not $DatabaseUrl) {
  Write-Error "DATABASE_URL not provided. Pass -DatabaseUrl or set the env var."
  exit 1
}

$psqlCmd = Get-Command $Psql -ErrorAction SilentlyContinue
if (-not $psqlCmd) {
  Write-Error "psql not found. Install PostgreSQL client or add psql to PATH."
  Write-Host "Download: https://www.postgresql.org/download/"
  exit 1
}

# Mask creds in console
$masked = ($DatabaseUrl -replace '://.*@', '://****@')
Write-Host "Using psql: $($psqlCmd.Source)"
Write-Host "SQL file: $SqlPath"
Write-Host "DATABASE_URL: $masked"

# Extract password from URI and set PGPASSWORD so psql won't prompt
# Matches postgres://user:pass@host...
$pwd = $null
if ($DatabaseUrl -match '^postgres(?:ql)?://[^:]+:([^@]+)@') { $pwd = $Matches[1] }
if ($pwd) { $env:PGPASSWORD = $pwd }

# Run psql with the URI and file (use call operator & so args pass correctly)
$resolvedSql = (Resolve-Path $SqlPath)
$arguments = @(
  $DatabaseUrl,
  '-v', 'ON_ERROR_STOP=1',
  '-f', $resolvedSql
)
& $psqlCmd.Source @arguments
if ($LASTEXITCODE -ne 0) {
  Write-Error "psql exited with code $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host "Cleanup completed successfully." -ForegroundColor Green
