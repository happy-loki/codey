param(
  [Parameter(Mandatory=$true)][string]$Name,  # 主进程名，不含 .exe（如 arthas）
  [int]$Interval = 1,                         # 采样间隔秒
  [switch]$Watch                              # 持续刷新
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Descendants([uint32]$ppid) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ppid" -ErrorAction SilentlyContinue
  foreach ($c in $children) {
    $c
    Get-Descendants $c.ProcessId
  }
}

function Measure-Tree([int[]]$RootPids, [int]$IntervalSec) {
  $lp = [Environment]::ProcessorCount
  # 聚合根 PID 及其所有子进程，使用数组去重以兼容 WinPS5/PS7
  $pidList = @()
  foreach ($rp in $RootPids) {
    $pidList += ,$rp
    $children = Get-Descendants $rp | Select-Object -Expand ProcessId
    if ($children) { $pidList += $children }
  }
  # 将可能的 UInt32 全部强制转为 Int32，避免被丢弃
  $pidList = $pidList | ForEach-Object { try { [int]$_ } catch { $null } } | Where-Object { $_ -ne $null } | Sort-Object -Unique

  # 第一次采样（累计 CPU 秒）
  $before = @{}
  @(Get-Process -Id $pidList -ErrorAction SilentlyContinue) | ForEach-Object { $before[$_.Id] = $_.CPU }

  Start-Sleep -Seconds $IntervalSec

  # 第二次采样 + 汇总
  $sumDeltaCpu = 0; $sumWS = 0; $sumPM = 0
  $rows = @()

  $procs = @(Get-Process -Id $pidList -ErrorAction SilentlyContinue)
  foreach ($p in $procs) {
    $delta = 0
    if ($before.ContainsKey($p.Id)) { $delta = ($p.CPU - $before[$p.Id]) }
    $cpuPct = if ($IntervalSec -gt 0 -and $lp -gt 0) { ($delta / $IntervalSec) / $lp * 100 } else { 0 }
    $sumDeltaCpu += $delta; $sumWS += $p.WorkingSet64; $sumPM += $p.PrivateMemorySize64
    $rows += [pscustomobject]@{
      Name   = $p.ProcessName
      Id     = $p.Id
      CPUpct = [math]::Round($cpuPct, 1)
      WS_MB  = [math]::Round($p.WorkingSet64 / 1MB, 1)
      PM_MB  = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
    }
  }

  $totalCpuPct = if ($IntervalSec -gt 0 -and $lp -gt 0) { (($sumDeltaCpu / $IntervalSec) / $lp) * 100 } else { 0 }
  [pscustomobject]@{
    Rows   = $rows | Sort-Object CPUpct -Descending
    Total  = [pscustomobject]@{
      CPU_pct = [math]::Round($totalCpuPct, 1)
      WS_MB   = [math]::Round($sumWS / 1MB, 1)
      PM_MB   = [math]::Round($sumPM / 1MB, 1)
      PIDs    = ($pidList -join ',')
    }
  }
}

function Resolve-RootPids([string]$n) {
  try {
    $ids = Get-Process -Name $n -ErrorAction Stop | Select-Object -Expand Id
    if ($null -eq $ids) { return @() }
    if ($ids -is [array]) { return $ids }
    return @($ids)
  } catch {
    @()
  }
}

if ($Watch) {
  while ($true) {
    $rootPids = @(Resolve-RootPids $Name)
    Clear-Host
    if ($rootPids.Count -eq 0) {
      Write-Host "No process named '$Name' found." -ForegroundColor Yellow
      Start-Sleep -Seconds $Interval
      continue
    }
    $result = Measure-Tree -RootPids $rootPids -IntervalSec $Interval
    $result.Rows | Format-Table -AutoSize
    "`nTOTAL CPU%: {0:N1} | TOTAL WS: {1:N1} MB | TOTAL PM: {2:N1} MB | PIDs: {3}" -f `
      ($result.Total.CPU_pct), ($result.Total.WS_MB), ($result.Total.PM_MB), ($result.Total.PIDs)
    Start-Sleep -Milliseconds 200
  }
} else {
  $rootPids = @(Resolve-RootPids $Name)
  if ($rootPids.Count -eq 0) {
    Write-Error "No process named '$Name' found."
    exit 1
  }
  $result = Measure-Tree -RootPids $rootPids -IntervalSec $Interval
  $result.Rows | Format-Table -AutoSize
  "`nTOTAL CPU%: {0:N1} | TOTAL WS: {1:N1} MB | TOTAL PM: {2:N1} MB | PIDs: {3}" -f `
    ($result.Total.CPU_pct), ($result.Total.WS_MB), ($result.Total.PM_MB), ($result.Total.PIDs)
}
