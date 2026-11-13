@echo off
setlocal
cd /d "%~dp0.."
set "LUMEN_ROOT=%CD%"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
if errorlevel 1 exit /b %errorlevel%
set "PATH=%LUMEN_ROOT%\tooling\qt\msvc2022_64\bin;%LUMEN_ROOT%\tooling\jom;%PATH%"
cd /d "%LUMEN_ROOT%\core"
if /I "%~1"=="--incremental" goto compile
qmake OpenRGB.pro CONFIG-=debug_and_release CONFIG+=release
if errorlevel 1 exit /b %errorlevel%
:compile
if /I "%~1"=="--exe-only" goto exe_only
jom -j 6
if errorlevel 1 exit /b %errorlevel%
windeployqt --no-translations --no-system-d3d-compiler --no-opengl-sw release\Rayloom-Core.exe
if errorlevel 1 exit /b %errorlevel%
copy /y "%LUMEN_ROOT%\tooling\qt\msvc2022_64\bin\Qt6Core5Compat.dll" release\
copy /y "%LUMEN_ROOT%\tooling\qt\msvc2022_64\bin\Qt6OpenGL.dll" release\
exit /b %errorlevel%
:exe_only
if not exist release\Qt6Core.dll exit /b 2
if not exist release\libusb-1.0.dll exit /b 2
jom -j 6 release\Rayloom-Core.exe
exit /b %errorlevel%
