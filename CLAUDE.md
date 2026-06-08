# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

菜单翻译助手（Menu Scanner）— 旅行时拍照识别餐厅菜单，AI 翻译中文，交互点菜自动计算总价。单文件 PWA 架构，手机浏览器直接打开使用。

## 启动命令

```bash
cd menu-scanner

# 设置 API Key（选一个）
set GEMINI_API_KEY=AIza...        # Gemini 免费，推荐
set ANTHROPIC_API_KEY=sk-ant-...  # Claude
set DEEPSEEK_API_KEY=sk-...       # DeepSeek 无视觉，不推荐用于菜单识别

# 启动
node server.js                    # http://localhost:3001
```

或双击 `start.bat` 一键启动。手机需连同一 WiFi，访问 `http://<电脑IP>:3001`。

## 架构

### 整体数据流

```
手机浏览器 → 拍照/选图 → index.html (前端)
  → POST /api/analyze → server.js (代理)
    → Gemini/Claude Vision API (图片→行标记文本)
  ← 解析行标记为 JSON ←
  → 前端渲染交互菜单 → 点菜购物车 → 货币换算
```

### 文件职责

| 文件 | 说明 |
|------|------|
| `index.html` | 完整前端：UI + CSS + JS 全部内嵌，约 1550 行。三个主要状态：welcome / loading / menu |
| `server.js` | Node.js HTTP 代理，零依赖。三个 API 端点 + 三个 AI provider |
| `sw.js` | Service Worker，缓存 App Shell 实现离线打开 |
| `manifest.json` | PWA 配置，支持添加到手机主屏幕 |
| `start.bat` | Windows 一键启动脚本，自动获取 IP、配置防火墙、设置 Key |

### server.js 核心结构

- **Provider 自动检测**：检查 `GEMINI_API_KEY` → `ANTHROPIC_API_KEY` → `DEEPSEEK_API_KEY`，第一个有值的生效
- **API 端点**：
  - `POST /api/analyze` — 接收 `{image: "base64..."}`，返回结构化菜单 JSON
  - `POST /api/chat` — 接收 `{question, menuContext}`，返回 AI 回答
  - `GET /api/health` — 健康检查
- **Prompt 策略**：使用**行标记格式**（`@@RESTAURANT` / `@@CURRENCY` / `@@CATEGORY` / `@@ITEM`）而非 JSON，避免 LLM 输出格式错误。`parseLineFormat()` 解析为 JSON，`fixItemPrices()` 自动修正错位价格
- **备用解析**：`extractJSON()` 兜底处理 JSON 格式响应

### index.html 核心结构

- **状态机**：`showState('welcome'|'loading'|'menu')` 控制三个页面状态
- **图片处理**：`<input capture="environment">` 调摄像头，`<input>` 选相册，拍摄后压缩至 2048px
- **API 调用**：优先使用同源代理 `/api/analyze`（`getProxyUrl()` 自动检测 HTTP 访问），否则直连
- **菜单渲染**：`renderMenu()` → `renderAllItems()` 生成分类标签 + 菜品卡片，`renderDishCard()` 单张卡片
- **购物车**：`cart = {"catIdx-itemIdx": {...dish, qty}}`，`updateCartItem()` / `updateCartUI()` 管理状态
- **货币转换**：`getExchangeRate()` 调 open.er-api.com 免费汇率
- **聊天**：`sendChatMessage()` 发 `/api/chat`，携带当前 `menuData` 上下文
- **全局事件委托**：`menuItems` 和 `cartDrawerItems` 只在初始化时绑定一次 click 监听

### 菜单数据格式

```json
{
  "restaurant": "餐厅名",
  "currency": "USD",
  "currency_symbol": "$",
  "categories": [{
    "name_cn": "前菜", "name_original": "Appetizers",
    "items": [{
      "name_cn": "凯撒沙拉", "name_original": "Caesar Salad",
      "description_cn": "...", "description_original": "...",
      "price": 12.50, "tags": ["素食", "人气"]
    }]
  }]
}
```

## 注意事项

- `index.html` 是单文件，前端所有代码都在 `<script>` 标签内，不要拆分为多个 JS 文件
- 购物车事件监听器使用全局委托绑定在 `menuItems` 和 `cartDrawerItems` 上，**不要**在 `renderAllItems()` 或 `updateCartUI()` 里重复绑定，否则 `+1` 会变 `+2`
- 按钮 `btnRescan` 的点击逻辑是弹出拍照/相册菜单（不是直接开相机），需要在 init 绑定
- LLM 优先输出行标记格式（`parseLineFormat`），JSON 解析器（`extractJSON`）仅作后备
