@echo off
cd /d "%~dp0logs"
for /f %%d in ('powershell -NoProfile -Command "(Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')"') do set HOJE=%%d
if exist "%HOJE%.txt" (start notepad "%HOJE%.txt") else (echo Ainda nao ha registro hoje. & pause)
