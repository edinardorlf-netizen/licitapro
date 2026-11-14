@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.>DESLIGADO.flag
echo.>PARAR.flag
echo Pedindo para o robo desligar...
ping -n 7 127.0.0.1 >nul
if exist robo.pid (for /f %%p in (robo.pid) do taskkill /PID %%p /T /F >nul 2>&1)
if exist robo.pid del robo.pid
echo Robo desligado. Ele NAO volta sozinho (nem reiniciando o computador) ate voce usar LIGAR.bat.
ping -n 6 127.0.0.1 >nul
