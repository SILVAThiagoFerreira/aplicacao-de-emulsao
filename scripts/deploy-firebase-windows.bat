@echo off
cd /d %~dp0..
echo Projeto Firebase: aplicacao-de-emulsao
call firebase login
call firebase use aplicacao-de-emulsao
echo Configure o token administrativo se ainda nao configurou:
echo firebase functions:secrets:set ADMIN_PANEL_TOKEN
echo.
call firebase deploy --only functions,firestore:rules,firestore:indexes
pause
