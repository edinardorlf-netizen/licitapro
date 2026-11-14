@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Robo de lances - LicitaPro (so observar)
if exist PARAR.flag del PARAR.flag
:laco
node main.js
set CODIGO=%errorlevel%
if exist PARAR.flag (del PARAR.flag & echo Robo desligado. & ping -n 6 127.0.0.1 >nul & exit /b)
if "%CODIGO%"=="2" (echo Robo desligado. & ping -n 6 127.0.0.1 >nul & exit /b)
if "%CODIGO%"=="3" (echo Instalando o que a versao nova precisa... & call npm install --omit=dev --no-audit --no-fund)
echo O robo parou. Religando em 10 segundos... (feche esta janela ou use PARAR.bat para desligar)
ping -n 11 127.0.0.1 >nul
goto laco
