@echo off
REM D:\REA-tool\bin\rea.cmd - run the D:\REA-tool REA CLI with every engine configured.
REM Engines and the pinned Node come from config\rea.env.cmd (source: config\rea.env.json).
setlocal
call "%~dp0..\config\rea.env.cmd" >nul
"D:\REA-tool\node\node.exe" "%~dp0..\node_modules\rea-agents\scripts\rea.mjs" %*
exit /b %ERRORLEVEL%
