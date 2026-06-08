# 🍽️ 菜单翻译助手 - Menu Scanner

旅行菜单翻译助手 — 拍照识别菜单，自动翻译中文，智能点菜计算总价。

## 功能

- 📸 **拍照识别** — 对准菜单拍照，AI 自动识别所有文字
- 🌍 **多语言支持** — 日文、英文、法文、韩文、泰文… 全球菜单都能识别
- 🇨🇳 **中文翻译** — 菜名、描述、分类全部翻译为简体中文
- 🏷️ **智能标签** — 自动标注辣度、素食、人气推荐等
- 🛒 **点菜计算** — 点击菜品加入购物车，实时计算总价
- 💱 **货币转换** — 自动换算人民币，消费一目了然
- 📤 **分享清单** — 一键分享点菜清单给同行伙伴
- 📱 **PWA 支持** — 可添加到手机主屏幕，像原生 App 一样使用

## 快速开始

### 1. 设置 API Key

```bash
# Windows PowerShell
$env:ANTHROPIC_API_KEY="sk-ant-api03-你的密钥"

# Windows CMD
set ANTHROPIC_API_KEY=sk-ant-api03-你的密钥

# Mac / Linux
export ANTHROPIC_API_KEY=sk-ant-api03-你的密钥
```

### 2. 启动服务器

```bash
cd menu-scanner
node server.js
```

### 3. 打开浏览器

- 电脑访问：`http://localhost:3001`
- 手机访问：`http://<你的电脑IP>:3001`（确保同一 WiFi）

## 使用方式

### 方式一：代理模式（推荐）
服务器已配置好 API Key，手机直接访问即可使用，无需额外设置。

### 方式二：浏览器直连模式
如果不想启动服务器，也可以直接打开 `index.html`，在设置（⚙️）中填入自己的 Anthropic API Key，直接调用 Claude Vision API。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML5 + CSS3 + Vanilla JS（单文件 PWA） |
| AI | Claude Vision API (Sonnet 4.6) |
| 后端代理 | Node.js HTTP Server（零依赖） |
| 货币 | ExchangeRate-API（免费，160+ 货币） |
| 离线 | Service Worker Cache |

## 项目结构

```
menu-scanner/
├── index.html      # 主应用（包含完整 UI + 逻辑）
├── server.js       # API 代理服务器
├── sw.js           # Service Worker
├── manifest.json   # PWA 清单
└── README.md       # 说明文档
```

## 部署

可直接部署到任何支持 Node.js 的平台：

```bash
# Vercel / Netlify: 只需部署静态文件，用户自行配置 API Key
# Railway / Render: 部署 server.js，设置 ANTHROPIC_API_KEY 环境变量
```
