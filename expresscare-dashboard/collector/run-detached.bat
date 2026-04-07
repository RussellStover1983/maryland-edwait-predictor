@echo off
cd /d "%~dp0\.."
start "edas-collector" /b cmd /c "npm run collect > collector\data\collector.log 2> collector\data\collector.err"
