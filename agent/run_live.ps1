# Live submission uses the pipeline only. -DeepResearch adds separate experimental outputs.
param(
    [Parameter(Mandatory = $true)][string]$Urls,
    [string]$OutDir = "live_out",
    [int]$Workers = 5,
    [switch]$DeepResearch
)
$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"
New-Item -ItemType Directory -Force $OutDir | Out-Null
$py = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

& $py agent.py --blind --input $Urls --out "$OutDir\verdicts.csv" --audit-out "$OutDir\verdicts.json" --workers $Workers --no-screenshot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Submission: $OutDir\verdicts.csv  (audit: $OutDir\verdicts.json)"
if ($DeepResearch) {
    & $py deep_agent.py --input $Urls --out "$OutDir\deep_experiment.csv" --audit-out "$OutDir\deep_experiment.json" --fallback "$OutDir\verdicts.json" --workers $Workers
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
