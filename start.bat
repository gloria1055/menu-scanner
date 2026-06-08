@echo off
chcp 65001 >nul
title 菜单翻译助手 - Menu Scanner

echo.
echo ╔══════════════════════════════════════╗
echo ║   🍽️  菜单翻译助手 一键启动          ║
echo ╚══════════════════════════════════════╝
echo.

:: 1. Show IP
echo [1/3] 本机IP地址...
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr "IPv4"') do set IP=%%a
set IP=%IP:~1%
echo       本机IP: %IP%
echo.

:: 2. Firewall
echo [2/3] 配置防火墙（如需管理员权限请右键以管理员身份运行）...
netsh advfirewall firewall add rule name="Menu Scanner 3001" dir=in action=allow protocol=TCP localport=3001 >nul 2>&1
if %errorlevel%==0 (echo       ✅ 防火墙已开放端口3001) else (echo       ⚠️  防火墙配置跳过)
echo.

:: 3. API Key
echo [3/3] API Key 配置...
echo.
echo   【1=Gemini(免费推荐)  2=Anthropic Claude  3=DeepSeek(无视觉)】
echo.
choice /c 123 /n /m "请选择: "
if errorlevel 3 goto deepseek
if errorlevel 2 goto anthropic
if errorlevel 1 goto gemini

:gemini
echo.
echo   请输入 Gemini API Key:
echo   (从 https://aistudio.google.com 免费获取)
echo   ─────────────────────────────────
set /p GK="Key: "
set GEMINI_API_KEY=%GK: =%
echo.
echo   ✅ 使用 Gemini API (免费视觉模型)
goto start

:anthropic
echo.
echo   请输入 Anthropic API Key:
echo   (从 https://console.anthropic.com 获取)
echo   ─────────────────────────────────
set /p AK="Key: "
set ANTHROPIC_API_KEY=%AK: =%
echo.
echo   ✅ 使用 Anthropic API
goto start

:deepseek
echo.
echo   ⚠️  注意：DeepSeek 不支持图片识别！
echo.
echo   请输入 DeepSeek API Key:
echo   (从 https://platform.deepseek.com 获取)
echo   ─────────────────────────────────
set /p DK="Key: "
set DEEPSEEK_API_KEY=%DK: =%
echo.
echo   ⚠️  DeepSeek 无视觉能力，菜单识别会失败
goto start

:start
echo ══════════════════════════════════════
echo   🟢 服务器启动中...
echo   📱 手机浏览器打开: http://%IP%:3001
echo ══════════════════════════════════════
echo   按 Ctrl+C 停止
echo.

cd /d "%~dp0"
node server.js
pause
