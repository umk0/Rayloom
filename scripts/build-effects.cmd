@echo off
setlocal
cd /d "%~dp0.."
set "LUMEN_ROOT=%CD%"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
if errorlevel 1 exit /b %errorlevel%
cd /d "%LUMEN_ROOT%"
set "PATH=%LUMEN_ROOT%\tooling\qt\msvc2022_64\bin;%LUMEN_ROOT%\tooling\jom;%PATH%"
node scripts\generate-effect-bindings.mjs
if errorlevel 1 exit /b %errorlevel%
cd /d "%LUMEN_ROOT%\plugins\effects"
if /I "%~1"=="--side-by-side" goto side_by_side
if /I "%~1"=="--incremental" goto compile
qmake OpenRGBEffectsPlugin.pro CONFIG-=debug_and_release CONFIG+=release
if errorlevel 1 exit /b %errorlevel%
goto compile
:side_by_side
qmake OpenRGBEffectsPlugin.pro CONFIG-=debug_and_release CONFIG+=release TARGET=RayloomEffectsPlugin
if errorlevel 1 exit /b %errorlevel%
jom prebuild_json_target
if errorlevel 1 exit /b %errorlevel%
jom compiler_moc_header_make_all
if errorlevel 1 exit /b %errorlevel%
jom -j 6 release\RayloomEffectsPlugin.dll
exit /b %errorlevel%
:compile
jom prebuild_json_target
if errorlevel 1 exit /b %errorlevel%
jom compiler_moc_header_make_all
if errorlevel 1 exit /b %errorlevel%
jom -j 6
exit /b %errorlevel%
