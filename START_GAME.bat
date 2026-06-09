@echo off
echo.
echo  ==========================================
echo   RAGDOLL ARCHERS - Starting Game Server
echo  ==========================================
echo.
echo   Installing dependencies...
call npm install
echo.
echo   Starting server...
node server.js
pause
