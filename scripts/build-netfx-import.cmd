@echo off
setlocal
cd /d "%~dp0.."
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
if errorlevel 1 exit /b %errorlevel%
if not exist tooling\netfx mkdir tooling\netfx
dumpbin /exports C:\Windows\System32\mscoree.dll > tooling\netfx\exports.txt
node scripts\netfx-import.mjs
if errorlevel 1 exit /b %errorlevel%
lib /def:tooling\netfx\mscoree.def /machine:x64 /out:tooling\netfx\MSCOREE.lib
