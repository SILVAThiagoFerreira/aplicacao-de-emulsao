@echo off
cd /d %~dp0..
echo Instalando dependencias...
call npm install
echo Gerando build de producao...
call npm run build
pause
