# Compiles door_alarm.ino with a mock Arduino.h and runs it. Needs a C++ compiler: g++ / clang++ on PATH, or the
# Visual Studio Build Tools (cl.exe via vcvars64.bat). The output goes to the gitignored _test/ folder.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
$out = Join-Path $root '_test'
New-Item -ItemType Directory -Force $out | Out-Null
$src = Join-Path $PSScriptRoot 'harness.cpp'
if (Get-Command g++ -ErrorAction SilentlyContinue) {
  g++ -std=c++17 -Wall -o "$out/door_alarm_mock.exe" $src
} elseif (Get-Command clang++ -ErrorAction SilentlyContinue) {
  clang++ -std=c++17 -Wall -o "$out/door_alarm_mock.exe" $src
} else {
  $vc = Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft Visual Studio\*\*\VC\Auxiliary\Build\vcvars64.bat" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $vc) { throw 'No C++ compiler found (g++, clang++ or Visual Studio Build Tools).' }
  cmd /c "`"$($vc.FullName)`" >nul && cl /nologo /EHsc /std:c++17 /W3 /Fe:`"$out\door_alarm_mock.exe`" /Fo:`"$out\\`" `"$src`""
  if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
}
& "$out/door_alarm_mock.exe"
exit $LASTEXITCODE
