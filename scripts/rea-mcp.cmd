@echo off
REM D:\REA-tool\bin\rea-mcp.cmd - run REA as a plain stdio MCP server (no bridge).
REM Use this only for clients that tolerate the full tool catalog; DeepSeek Harness
REM should keep using the progressive-disclosure bridge in %USERPROFILE%\.dsh\rea-mcp-proxy.
setlocal
call "%~dp0..\config\rea.env.cmd" >nul
"D:\REA-tool\node\node.exe" "%~dp0..\node_modules\rea-agents\scripts\rea.mjs" mcp
exit /b %ERRORLEVEL%
