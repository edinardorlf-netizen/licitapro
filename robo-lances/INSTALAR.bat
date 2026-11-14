@echo off
chcp 65001 >nul
setlocal
set DESTINO=C:\LicitaPro\robo-lances
echo ============================================================
echo  Robo de lances do LicitaPro - instalacao
echo ============================================================
if not exist "%~dp0config.env" (echo FALTA o arquivo config.env com a chave do robo. & pause & exit /b 1)

rem --- 0) Fica sempre em C:\LicitaPro\robo-lances (copia para la se foi extraido em outro lugar)
if /i not "%~dp0"=="%DESTINO%\" (
  echo Copiando para %DESTINO% ...
  robocopy "%~dp0." "%DESTINO%" /E /NFL /NDL /NJH /NJS /NP /XD perfil logs node_modules >nul
  if errorlevel 8 (echo Nao consegui copiar para %DESTINO%. & pause & exit /b 1)
  call "%DESTINO%\INSTALAR.bat"
  exit /b
)
cd /d "%~dp0"

rem --- 1) Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo 1/5 Node.js nao encontrado. Instalando o Node.js LTS pelo winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js instalado. FECHE esta janela e de dois cliques em INSTALAR.bat de novo
  echo (em %DESTINO%^).
  echo Se o winget nao funcionou, instale o Node.js LTS em nodejs.org.
  pause & exit /b 0
)
echo 1/5 Node.js ok.
echo.
echo 2/5 Instalando o que o robo precisa...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (echo A instalacao falhou. & pause & exit /b 1)
echo.
echo 3/5 Ligar sozinho quando o Windows entrar...
set INICIO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LicitaPro-robo-lances.vbs
> "%INICIO%" echo CreateObject("WScript.Shell").Run "wscript ""%~dp0ROBO-OCULTO.vbs""", 0, False
echo     Feito.
echo.
echo 4/5 Vigia: a cada 5 minutos o Windows confere se o robo esta rodando e liga se nao estiver...
schtasks /create /tn "LicitaPro robo-lances (vigia)" /tr "wscript.exe \"%~dp0ROBO-OCULTO.vbs\"" /sc minute /mo 5 /f >nul
if errorlevel 1 (echo     Nao consegui criar o vigia. O robo ainda liga quando o Windows entrar.) else (echo     Feito.)
echo     Energia na tomada: o computador nao suspende nem hiberna sozinho (o robo precisa ficar acordado).
powercfg /change standby-timeout-ac 0 >nul 2>nul
powercfg /change hibernate-timeout-ac 0 >nul 2>nul
echo.
echo 5/5 Ligando o robo agora (segundo plano)...
if exist DESLIGADO.flag del DESLIGADO.flag
if exist PARAR.flag del PARAR.flag
wscript "%~dp0ROBO-OCULTO.vbs"
ping -n 8 127.0.0.1 >nul
echo.
echo ============================================================
echo  Pronto. O robo esta rodando em segundo plano.
echo  Acompanhe no LicitaPro: aba Robo ^> Ao vivo ("Robo ligado").
echo  Se aparecer erro de chave: falta rodar o cadastrar-chave.sql no Supabase.
echo  Registro do dia: VER-LOG.bat
echo ============================================================
pause
