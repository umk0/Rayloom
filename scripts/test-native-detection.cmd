@echo off
setlocal
cd /d "%~dp0.."
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
if errorlevel 1 exit /b %errorlevel%
if not exist artifacts mkdir artifacts
cl /nologo /EHsc /std:c++17 /Fe:artifacts\keychron-detection.exe /Fo:artifacts\keychron-detection.obj tests\keychron-detection.cpp
if errorlevel 1 exit /b %errorlevel%
artifacts\keychron-detection.exe
exit /b %errorlevel%
