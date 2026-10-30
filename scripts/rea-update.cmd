@echo off
REM D:\REA-tool\bin\rea-update.cmd - update the D:\REA-tool REA installation in place.
setlocal
set "REA_TOOL=D:\REA-tool"
echo Updating rea-agents in %REA_TOOL% ...
"%REA_TOOL%\node\npm.cmd" install --prefix "%REA_TOOL%" rea-agents@latest --no-audit --no-fund
echo.
echo Installed version:
"%REA_TOOL%\node\node.exe" -e "console.log(require('%REA_TOOL%\\node_modules\\rea-agents\\package.json').version)"
echo.
echo Next: D:\REA-tool\bin\rea.cmd doctor --format json
exit /b %ERRORLEVEL%
