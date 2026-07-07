@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

rem ============================================================
rem  setup-notes.bat - taskchute-notes セットアップ(Windows用)
rem  ダブルクリック、または PowerShell から .\scripts\setup-notes.bat
rem  やること: (1) git pull で最新化 (2) Git Bash で setup-notes.sh を実行
rem ============================================================

rem この bat は scripts\ 内にあるので、リポジトリルートへ移動
cd /d "%~dp0.."
echo リポジトリ: %CD%
echo.

rem ---- (1) taskchute-ipad を最新化 ----
echo == git pull で最新化 ==
git pull
if errorlevel 1 (
    echo.
    echo [ERROR] git pull に失敗しました。ネットワークと git の状態を確認してください。
    pause
    exit /b 1
)
echo.

rem ---- (2) Git Bash を探す(WSLのSystem32\bash.exeは除外)----
set "BASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe" set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined BASH (
    for /f "delims=" %%i in ('where bash 2^>nul') do (
        if not defined BASH (
            echo %%i | find /i "System32" >nul || set "BASH=%%i"
        )
    )
)
if not defined BASH (
    echo [ERROR] Git Bash が見つかりません。Git for Windows をインストールしてください:
    echo         winget install --id Git.Git
    echo         または https://gitforwindows.org/
    pause
    exit /b 1
)
echo Git Bash: !BASH!
echo.

rem ---- (3) セットアップ本体を実行 ----
echo == taskchute-notes セットアップを実行 ==
"!BASH!" scripts/setup-notes.sh
set "RC=!errorlevel!"

rem 最終メッセージ(if/else ブロック内に半角カッコを置くと cmd が誤解釈するため goto で分岐)
echo.
if "!RC!"=="0" goto :SETUP_OK
echo == 途中で停止しました。上のメッセージ（gh のインストール/認証など）に従って、もう一度この bat を実行してください ==
goto :SETUP_END
:SETUP_OK
echo == 完了しました。上に表示されたパスを Obsidian で開いてください ==
:SETUP_END
pause
exit /b %RC%
