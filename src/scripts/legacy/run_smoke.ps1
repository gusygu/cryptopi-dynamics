# run_smoke.ps1
param(
  [string]$Api = "http://localhost:3000",
  [string]$Coins = "BTC,ETH,SOL,ADA",
  [string]$Window = "30m",
  [int]$Bins = 128,
  [string]$Session = "smoke-ui",
  [string]$MatricesSchema = "matrices_dynamics"
)

$cmd = "pnpm tsx -r dotenv/config -r tsconfig-paths/register src/scripts/smoke-str-aux-snapshot.mts --api $Api --coins $Coins --window $Window --bins $Bins --session $Session --matrices-schema $MatricesSchema"
Write-Host "Running: $cmd"
Invoke-Expression $cmd

Write-Host ""
Write-Host "Artifacts are under: .\artifacts"
