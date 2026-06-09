@echo off
cd /d %~dp0..
echo Instalando dependencias...
call npm install
echo Iniciando dashboard...
call npm run dev
pause
