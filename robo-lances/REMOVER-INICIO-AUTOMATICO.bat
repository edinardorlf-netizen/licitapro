@echo off
chcp 65001 >nul
cd /d "%~dp0"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LicitaPro-robo-lances.vbs" >nul 2>nul
schtasks /delete /tn "LicitaPro robo-lances (vigia)" /f >nul 2>nul
call PARAR.bat
echo O robo nao liga mais sozinho (nem com o Windows, nem pelo vigia). Para voltar: INSTALAR.bat.
pause
