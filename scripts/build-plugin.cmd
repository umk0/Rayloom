@echo off
setlocal
cd /d "%~dp0.."
set "LUMEN_ROOT=%CD%"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
if errorlevel 1 exit /b %errorlevel%
set "PATH=%LUMEN_ROOT%\tooling\qt\msvc2022_64\bin;%LUMEN_ROOT%\tooling\jom;%PATH%"
set "LIB=%LUMEN_ROOT%\tooling\netfx;%LIB%"
cd /d "%LUMEN_ROOT%\plugins\%~1"
if errorlevel 1 exit /b 1
if /I "%~2"=="--incremental" goto compile
qmake CONFIG-=debug_and_release CONFIG+=release
if errorlevel 1 exit /b %errorlevel%
:compile
jom prebuild_json_target
if errorlevel 1 exit /b %errorlevel%
rem Generate Qt metadata after JSON, before parallel compilation.
jom compiler_moc_header_make_all
if errorlevel 1 exit /b %errorlevel%
jom -j 6
exit /b %errorlevel%
