@echo off
cd /d C:\PERSO\TYP_000
echo.
echo ========================================
echo Starting Typing Practice Web Server
echo ========================================
echo.
echo Server is running at:
echo.
echo   http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.
python -m http.server 3000
