@echo off
setlocal enabledelayedexpansion

REM ===== Janitor Analytics build script =====
REM
REM   build.bat              -> rebuild with the current version
REM   build.bat 1.1.0        -> bump version (both app.py + installer.iss) then rebuild
REM
REM Output: companion\installer-output\JanitorAnalytics-Setup.exe

cd /d "%~dp0"

set "NEWVER=%~1"

if not "%NEWVER%"=="" (
    echo %NEWVER%| findstr /R /C:"^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$" >nul
    if errorlevel 1 (
        echo.
        echo ERROR: Version must be in the form X.Y.Z, e.g. 1.1.0
        echo.
        exit /b 1
    )
    echo.
    echo === Bumping version to %NEWVER% ===
    powershell -NoProfile -Command "(Get-Content -Raw -Encoding UTF8 'app.py') -replace '__version__ = \".*\"','__version__ = \"%NEWVER%\"' | Set-Content -NoNewline -Encoding UTF8 'app.py'"
    if errorlevel 1 goto :fail_bump
    powershell -NoProfile -Command "(Get-Content -Raw -Encoding UTF8 'installer.iss') -replace '#define MyAppVersion \".*\"','#define MyAppVersion \"%NEWVER%\"' | Set-Content -NoNewline -Encoding UTF8 'installer.iss'"
    if errorlevel 1 goto :fail_bump
    echo Bumped app.py and installer.iss.
)

echo.
echo === Installing/updating Python build deps ===
python -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed. Check that Python is installed and on PATH.
    exit /b 1
)

set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if "%ISCC%"=="" (
    echo.
    echo ERROR: Inno Setup 6 not found.
    echo Download and install from: https://jrsoftware.org/isinfo.php
    exit /b 1
)

echo.
echo === Bundling Python app (PyInstaller) ===
python -m PyInstaller --noconfirm --windowed --name JanitorAnalytics --icon app.ico --add-data "web;web" app.py
if errorlevel 1 (
    echo ERROR: PyInstaller failed.
    exit /b 1
)

echo.
echo === Building installer (Inno Setup) ===
"%ISCC%" installer.iss
if errorlevel 1 (
    echo ERROR: Inno Setup compile failed.
    exit /b 1
)

echo.
echo ============================================================
echo Done.
echo Installer: %CD%\installer-output\JanitorAnalytics-Setup.exe
echo ============================================================
exit /b 0

:fail_bump
echo ERROR: Failed to update version strings.
exit /b 1
