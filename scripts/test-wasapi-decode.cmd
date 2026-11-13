@echo off
setlocal
cd /d "%~dp0.."
set "LUMEN_TEST_ROOT=%CD%"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
if errorlevel 1 exit /b %errorlevel%
cd /d "%LUMEN_TEST_ROOT%"
cl /nologo /std:c++17 /EHsc tests\wasapi-decode.cpp /Foartifacts\wasapi-decode.obj /Feartifacts\wasapi-decode.exe
if errorlevel 1 exit /b %errorlevel%
artifacts\wasapi-decode.exe
exit /b %errorlevel%
