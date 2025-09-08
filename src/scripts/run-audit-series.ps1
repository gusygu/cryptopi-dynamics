# src/scripts/run-audit-series.ps1
param(
  [string]$Api = "http://localhost:3000",
  [string]$Coins = "BTC,ETH,SOL,ADA",
  [string]$Window = "30m",
  [int]$Bins = 128,
  [string]$SessionBase = "audit",
  [string]$MatricesSchema = "matrices_dynamics",
  [string]$NodeRunner = "pnpm",      # change to "npx" if you prefer
  [string]$SeriesRoot = ".\artifacts"
)

function Stamp { (Get-Date).ToString("yyyyMMdd_HHmmss") }

$root = Join-Path $SeriesRoot ("series-" + (Stamp))
New-Item -ItemType Directory -Force $root | Out-Null

# Schedule: [0,0,40,40,320,320,320,320] repeated 2x = 16 runs
$phase = @(0,0,40,40,320,320,320,320)
$delays = @()
1..2 | ForEach-Object { $delays += $phase }

$run = 0
foreach ($delay in $delays) {
  $run++
  if ($delay -gt 0) {
    Write-Host ("Sleeping {0}s..." -f $delay) -ForegroundColor DarkGray
    Start-Sleep -Seconds $delay
  }

  $outDir = Join-Path $root ("run-{0:d2}" -f $run)
  New-Item -ItemType Directory -Force $outDir | Out-Null
  $session = "$SessionBase-$run"

  $cmd = "$NodeRunner tsx -r dotenv/config -r tsconfig-paths/register src/scripts/smoke-str-aux-snapshot.mts --api $Api --coins $Coins --window $Window --bins $Bins --session $session --matrices-schema $MatricesSchema --outDir $outDir"
  Write-Host ("[{0}] {1}" -f (Stamp), $cmd) -ForegroundColor Cyan

  # log file per run
  $log = Join-Path $outDir "stdout.log"
  Invoke-Expression $cmd 2>&1 | Tee-Object -FilePath $log
}

Write-Host "Done. All artifacts under: $root" -ForegroundColor Green
