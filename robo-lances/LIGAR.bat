@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist DESLIGADO.flag del DESLIGADO.flag
if exist PARAR.flag del PARAR.flag
wscript "%~dp0ROBO-OCULTO.vbs"
echo Robo ligado em segundo plano. Acompanhe no LicitaPro (Robo ^> Ao vivo) ou em VER-LOG.bat.
ping -n 5 127.0.0.1 >nul
