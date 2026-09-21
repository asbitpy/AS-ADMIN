@echo off
rem Levanta el backend y el panel de AS ADMIN en dos ventanas y abre el panel.
rem Para apagar todo: cerrar las dos ventanas negras.

start "AS ADMIN - Backend (puerto 3000)" cmd /k "cd /d %~dp0backend && npm run dev"
start "AS ADMIN - Panel (puerto 5173)" cmd /k "cd /d %~dp0panel && npm run dev"

timeout /t 10 /nobreak >nul
start http://localhost:5173
