/**
 * Menu Scanner — API Proxy Server
 *
 * Supports Gemini (free vision!), Anthropic, and DeepSeek.
 * Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or DEEPSEEK_API_KEY.
 *
 * Usage: node server.js
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ── Configuration ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

// Auto-detect provider (Gemini first — free and great vision)
const PROVIDER = GEMINI_API_KEY ? 'gemini' : ANTHROPIC_API_KEY ? 'anthropic' : DEEPSEEK_API_KEY ? 'deepseek' : null;
const API_KEY = GEMINI_API_KEY || ANTHROPIC_API_KEY || DEEPSEEK_API_KEY || '';

// ── MIME Types ─────────────────────────────────────────────────────
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
};

// ── CORS Headers ───────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ── Serve Static Files ─────────────────────────────────────────────
function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'index.html'), (err2, data2) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data2);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── Parse JSON Body ────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ── System Prompt (shared) ─────────────────────────────────────────
const SYSTEM_PROMPT = `你是一个专业的餐厅菜单分析助手。分析菜单图片，使用行标记格式输出（每行一条信息，用 | 分隔）。

格式：
@@RESTAURANT 餐厅名称
@@CURRENCY 货币代码 货币符号
@@CATEGORY 分类原文|分类中文
@@ITEM 菜名原文|菜名中文|描述原文|描述中文|价格数字|标签

【重要规则 - 必须严格遵守】：
- 价格字段只能是纯数字，如 12.50 或 280，绝对不能包含 $、¥ 等货币符号
- 描述字段里绝对不能出现价格数字
- 如果菜单上有价格，必须提取到第5个字段（价格位置）
- 每个 @@ITEM 必须是6个字段，用竖线 | 分隔
- 字段内容中不要使用 | 字符
- 没有标签时第6个字段留空

正确示例：
@@ITEM Caesar Salad|凯撒沙拉|Fresh romaine with parmesan|新鲜罗马生菜配帕尔玛干酪|12.50|素食
错误示例（价格跑到描述里）：
@@ITEM Caesar Salad|凯撒沙拉|Fresh romaine $12.50|新鲜罗马生菜|0|素食

每个 @@ITEM = 菜名原文 | 菜名中文 | 描述原文 | 描述中文 | 纯数字价格 | 标签`;

const USER_PROMPT = '请按照行标记格式分析这张菜单图片。严格使用 @@RESTAURANT, @@CURRENCY, @@CATEGORY, @@ITEM 标记。每个 @@ITEM 行固定6个字段用竖线分隔。描述里不要出现价格，价格必须单独放第5个字段。';

// ── Fix misplaced prices in menu items ──────────────────────────────
function fixItemPrices(result) {
  // Currency symbol patterns to strip from descriptions
  const pricePatterns = [
    /([\$€£¥₩฿])\s*(\d+\.?\d*)/g,    // $12.50, € 15
    /(\d+\.?\d*)\s*([\$€£¥₩฿])/g,    // 12.50$
    /(?:price|价格|售价|单价)[:\s]*(\d+\.?\d*)/gi,
  ];

  let fixedCount = 0;
  for (const cat of result.categories) {
    for (const item of cat.items) {
      // If price is already valid, skip
      if (item.price > 0) continue;

      const textFields = [
        { key: 'name_original', val: item.name_original },
        { key: 'name_cn', val: item.name_cn },
        { key: 'description_original', val: item.description_original },
        { key: 'description_cn', val: item.description_cn },
      ];

      for (const field of textFields) {
        if (!field.val || item.price > 0) continue;

        // Try to find a price pattern
        for (const pattern of pricePatterns) {
          const match = field.val.match(pattern);
          if (match) {
            const extracted = parseFloat(match[1] || match[2]);
            if (extracted > 0 && extracted < 100000) {
              item.price = extracted;
              // Clean the price from the text field
              item[field.key] = field.val.replace(match[0], '').replace(/\s{2,}/g, ' ').trim();
              fixedCount++;
              console.log(`   💰 修正: "${item.name_cn}" 价格 ${extracted} (从${field.key}中提取)`);
              break;
            }
          }
        }

        // Also try: bare number at end of description (common pattern: "...12.50")
        if (item.price <= 0) {
          const barePrice = field.val.match(/(?:^|\s)(\d+\.?\d{1,2})\s*$/);
          if (barePrice) {
            const val = parseFloat(barePrice[1]);
            // Only treat as price if it looks like one (2 digits after decimal, or > 1)
            if (val > 0.5 && val < 100000) {
              item.price = val;
              item[field.key] = field.val.replace(barePrice[0], '').trim();
              fixedCount++;
              console.log(`   💰 修正: "${item.name_cn}" 价格 ${val} (从${field.key}末尾提取)`);
            }
          }
        }
      }

      // Fallback: scan the entire item as a string for any price-like number
      if (item.price <= 0) {
        const allText = `${item.name_original} ${item.name_cn} ${item.description_original} ${item.description_cn}`;
        const anyPrice = allText.match(/(\d{2,4}(?:\.\d{1,2})?)\s*(?:元|[¥\$€£]|$)/);
        if (anyPrice) {
          const val = parseFloat(anyPrice[1]);
          if (val > 0.5 && val < 100000) {
            item.price = val;
            fixedCount++;
            console.log(`   💰 修正: "${item.name_cn}" 价格 ${val} (从全文提取)`);
          }
        }
      }
    }
  }
  if (fixedCount > 0) {
    console.log(`   💰 共修正 ${fixedCount} 个菜品的价格`);
  }
}

// ── Parse line-based format (primary, robust) ──────────────────────
function parseLineFormat(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const result = { restaurant: '', currency: 'CNY', currency_symbol: '¥', categories: [] };
  let currentCategory = null;

  for (const line of lines) {
    // Skip non-marker lines
    if (!line.startsWith('@@')) continue;

    if (line.startsWith('@@RESTAURANT')) {
      result.restaurant = line.slice('@@RESTAURANT'.length).trim() || result.restaurant;
    } else if (line.startsWith('@@CURRENCY')) {
      const parts = line.slice('@@CURRENCY'.length).trim().split(/\s+/);
      if (parts[0]) result.currency = parts[0];
      if (parts[1]) result.currency_symbol = parts[1];
    } else if (line.startsWith('@@CATEGORY')) {
      const content = line.slice('@@CATEGORY'.length).trim();
      const parts = content.split('|');
      currentCategory = {
        name_original: (parts[0] || '').trim(),
        name_cn: (parts[1] || parts[0] || '').trim(),
        items: []
      };
      result.categories.push(currentCategory);
    } else if (line.startsWith('@@ITEM') && currentCategory) {
      const content = line.slice('@@ITEM'.length).trim();
      const parts = content.split('|');
      if (parts.length >= 5) {
        const item = {
          name_original: (parts[0] || '').trim(),
          name_cn: (parts[1] || parts[0] || '').trim(),
          description_original: (parts[2] || '').trim(),
          description_cn: (parts[3] || parts[2] || '').trim(),
          price: parseFloat(parts[4]) || 0,
          tags: (parts[5] || '').split(',').map(t => t.trim()).filter(Boolean)
        };
        currentCategory.items.push(item);
      }
    }
  }

  // Check if we got meaningful data
  if (result.categories.length > 0) {
    console.log(`   ✅ 行格式解析成功: ${result.categories.length} 个分类, ${result.categories.reduce((s,c) => s + c.items.length, 0)} 道菜品`);
    fixItemPrices(result);
    return result;
  }
  return null;
}

// ── Extract JSON (fallback parser) ─────────────────────────────────
function extractJSON(text) {
  try { return JSON.parse(text); } catch {}

  // Remove markdown code blocks
  let cleaned = text;
  const codeBlock = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlock) {
    cleaned = codeBlock[1];
    try { return JSON.parse(cleaned); } catch {}
  }

  // Brace-counting extraction
  const startIdx = cleaned.indexOf('{');
  if (startIdx !== -1) {
    let depth = 0, inString = false, escaped = false;
    for (let i = startIdx; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) {
        const candidate = cleaned.slice(startIdx, i + 1)
          .replace(/,(\s*[}\]])/g, '$1'); // fix trailing commas
        try { return JSON.parse(candidate); } catch {}
        break;
      }}
    }
  }
  return null;
}

// ── Call Gemini API ────────────────────────────────────────────────
function callGeminiAPI(imageBase64) {
  return new Promise((resolve, reject) => {
    // Strip data URI prefix, get pure base64
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageSizeMB = ((base64Data.length * 0.75) / (1024 * 1024)).toFixed(2);
    console.log(`   📷 图片大小约: ${imageSizeMB} MB (base64: ${(base64Data.length/1024).toFixed(1)}KB)`);

    // Warn if image is too large
    if (base64Data.length > 10 * 1024 * 1024) {
      console.log('   ⚠️  图片较大，可能影响识别速度...');
    }

    const payload = JSON.stringify({
      contents: [{
        parts: [
          { text: USER_PROMPT },
          { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
        ]
      }],
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        topP: 0.95
      }
    });

    const modelName = 'gemini-2.5-flash';
    const apiUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`);
    const options = {
      hostname: apiUrl.hostname,
      port: 443,
      path: apiUrl.pathname + apiUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 90000
    };

    console.log(`   🤖 调用 ${modelName}...`);

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        console.log(`   📡 HTTP ${apiRes.statusCode}, 响应大小: ${(data.length/1024).toFixed(1)}KB`);

        try {
          const json = JSON.parse(data);

          if (json.error) {
            const errMsg = json.error?.message || JSON.stringify(json.error);
            console.error('   ❌ Gemini API 返回错误:', errMsg);

            if (errMsg.includes('API key') || errMsg.includes('API_KEY_INVALID')) {
              reject(new Error('Gemini API Key 无效'));
            } else if (errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
              reject(new Error('Gemini 免费额度已用完，明天自动重置'));
            } else if (errMsg.includes('PERMISSION_DENIED')) {
              reject(new Error('Gemini API Key 权限不足'));
            } else if (errMsg.includes('not found') || errMsg.includes('404')) {
              reject(new Error('Gemini 模型不可用，请检查网络'));
            } else {
              reject(new Error(`Gemini: ${errMsg}`));
            }
            return;
          }

          // Check safety filters
          if (json.promptFeedback?.blockReason) {
            console.error('   🚫 内容被安全过滤:', json.promptFeedback.blockReason);
            reject(new Error('图片内容被安全策略拦截，请尝试更清晰的菜单图片'));
            return;
          }

          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';

          if (!text) {
            console.error('   ❌ 响应为空，完整响应:', JSON.stringify(json).slice(0, 500));
            reject(new Error('Gemini 返回为空，请重试'));
            return;
          }

          console.log(`   📝 AI 响应前100字: ${text.slice(0, 100).replace(/\n/g, ' ')}...`);

          // 1. Try line-based format (preferred)
          let parsed = parseLineFormat(text);
          if (parsed) {
            resolve(parsed);
            return;
          }

          // 2. Fallback: try JSON
          parsed = extractJSON(text);
          if (parsed) {
            console.log(`   ✅ JSON解析成功: ${parsed.categories?.length || 0} 个分类`);
            resolve(parsed);
            return;
          }

          // 3. Last resort: return raw text
          console.log('   ⚠️  所有解析均失败，返回原始文本');
          resolve({ restaurant: '', currency: 'CNY', currency_symbol: '¥', categories: [] });
        } catch (e) {
          console.error('   ❌ 响应解析异常:', e.message);
          console.error('   原始响应(前500字符):', data.slice(0, 500));
          reject(new Error(`解析失败: ${e.message}`));
        }
      });
    });

    apiReq.on('timeout', () => {
      apiReq.destroy();
      console.error('   ⏰ API 请求超时 (90秒)');
      reject(new Error('请求超时 — 图片可能太大或网络不稳定，请重试'));
    });
    apiReq.on('error', (e) => {
      console.error('   🌐 网络错误:', e.message);
      reject(new Error(`网络连接失败: ${e.message}。请检查网络，或尝试 VPN`));
    });
    apiReq.write(payload);
    apiReq.end();
  });
}

// ── Call DeepSeek API ──────────────────────────────────────────────
function callDeepSeekAPI(imageBase64) {
  return new Promise((resolve, reject) => {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const payload = JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 4096,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
            { type: 'text', text: USER_PROMPT }
          ]
        }
      ]
    });

    const apiUrl = new URL('https://api.deepseek.com/v1/chat/completions');
    const options = {
      hostname: apiUrl.hostname,
      port: 443,
      path: apiUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 120000
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            const errMsg = json.error?.message || JSON.stringify(json.error);
            if (errMsg.includes('Authentication') || errMsg.includes('Invalid API Key') || errMsg.includes('401')) {
              reject(new Error('DeepSeek API Key 无效！请在 https://platform.deepseek.com 重新获取，确保以 sk- 开头'));
            } else if (errMsg.includes('quota') || errMsg.includes('balance') || errMsg.includes('insufficient')) {
              reject(new Error('DeepSeek 账户余额不足，请前往 https://platform.deepseek.com 充值'));
            } else {
              reject(new Error(`DeepSeek API Error: ${errMsg}`));
            }
            return;
          }

          const text = json.choices?.[0]?.message?.content || '';
          let parsed = parseLineFormat(text) || extractJSON(text);
          if (parsed) {
            resolve(parsed);
          } else {
            resolve({ restaurant: '', currency: 'CNY', currency_symbol: '¥', categories: [] });
          }
        } catch (e) {
          reject(new Error(`解析 DeepSeek 响应失败: ${e.message}`));
        }
      });
    });

    apiReq.on('timeout', () => { apiReq.destroy(); reject(new Error('DeepSeek API 请求超时（120秒）')); });
    apiReq.on('error', (e) => { reject(new Error(`网络错误: ${e.message}`)); });
    apiReq.write(payload);
    apiReq.end();
  });
}

// ── Call Anthropic API ─────────────────────────────────────────────
function callClaudeAPI(imageBase64) {
  return new Promise((resolve, reject) => {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } },
          { type: 'text', text: USER_PROMPT }
        ]
      }]
    });

    const apiUrl = new URL('https://api.anthropic.com/v1/messages');
    const options = {
      hostname: apiUrl.hostname,
      port: 443,
      path: apiUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 60000
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            const errMsg = json.error?.message || JSON.stringify(json.error);
            if (errMsg.includes('invalid x-api-key') || errMsg.includes('authentication')) {
              reject(new Error('Anthropic API Key 无效！请重新获取，确保以 sk-ant-api03- 开头'));
            } else {
              reject(new Error(`API Error: ${errMsg}`));
            }
            return;
          }

          const text = json.content?.[0]?.text || '';
          let parsed = parseLineFormat(text) || extractJSON(text);
          if (parsed) {
            resolve(parsed);
          } else {
            resolve({ restaurant: '', currency: 'CNY', currency_symbol: '¥', categories: [] });
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${e.message}`));
        }
      });
    });

    apiReq.on('timeout', () => { apiReq.destroy(); reject(new Error('API 请求超时')); });
    apiReq.on('error', (e) => { reject(new Error(`网络错误: ${e.message}`)); });
    apiReq.write(payload);
    apiReq.end();
  });
}

// ── Unified API call ───────────────────────────────────────────────
async function callVisionAPI(imageBase64) {
  if (PROVIDER === 'gemini') {
    return callGeminiAPI(imageBase64);
  } else if (PROVIDER === 'deepseek') {
    return callDeepSeekAPI(imageBase64);
  } else if (PROVIDER === 'anthropic') {
    return callClaudeAPI(imageBase64);
  }
  throw new Error('未配置 API Key');
}

// ── Chat API (food Q&A) ───────────────────────────────────────────
async function callChatAPI(question, menuContext) {
  const menuSummary = menuContext ? buildMenuSummary(menuContext) : '';

  const chatPrompt = `你是餐厅菜单顾问，帮助用户理解菜单上的菜品。根据当前菜单信息回答用户问题。

当前菜单概览：
${menuSummary || '（无菜单上下文）'}

用户问题：${question}

要求：
- 用简体中文回答
- 回答简洁，2-5句话为宜
- 可以解释菜品的食材、做法、口味、文化背景
- 如果是没出现在菜单里的菜，也可以凭知识回答
- 如果有饮食禁忌相关的，提醒用户`;

  if (PROVIDER === 'gemini') {
    return callGeminiChat(chatPrompt);
  } else if (PROVIDER === 'anthropic') {
    return callClaudeChat(chatPrompt);
  } else if (PROVIDER === 'deepseek') {
    return callDeepSeekChat(chatPrompt);
  }
  return 'AI 服务不可用';
}

function buildMenuSummary(menuData) {
  if (!menuData || !menuData.categories) return '';
  const lines = [];
  lines.push(`餐厅: ${menuData.restaurant || '未知'}, 货币: ${menuData.currency || '?'}`);
  for (const cat of menuData.categories) {
    lines.push(`【${cat.name_cn}】`);
    for (const item of cat.items) {
      lines.push(`  - ${item.name_cn} (${item.name_original}) ${menuData.currency_symbol || ''}${item.price} ${item.description_cn || ''}`);
    }
  }
  return lines.join('\n');
}

function callGeminiChat(prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    });
    const apiUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`);
    const req = https.request({
      hostname: apiUrl.hostname, port: 443,
      path: apiUrl.pathname + apiUrl.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 30000
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve(json.candidates?.[0]?.content?.parts?.[0]?.text || '抱歉，暂时无法回答');
        } catch { resolve('抱歉，回答解析失败'); }
      });
    });
    req.on('error', () => resolve('网络错误，请重试'));
    req.on('timeout', () => { req.destroy(); resolve('回答超时，请重试'); });
    req.write(payload);
    req.end();
  });
}

function callClaudeChat(prompt) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-6', max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
    const apiUrl = new URL('https://api.anthropic.com/v1/messages');
    const req = https.request({
      hostname: apiUrl.hostname, port: 443, path: apiUrl.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 30000
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).content?.[0]?.text || '抱歉'); }
        catch { resolve('抱歉，回答解析失败'); }
      });
    });
    req.on('error', () => resolve('网络错误'));
    req.on('timeout', () => { req.destroy(); resolve('超时'); });
    req.write(payload);
    req.end();
  });
}

function callDeepSeekChat(prompt) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: 'deepseek-chat', max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.deepseek.com', port: 443, path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Length': Buffer.byteLength(payload) },
      timeout: 30000
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).choices?.[0]?.message?.content || '抱歉'); }
        catch { resolve('抱歉，回答解析失败'); }
      });
    });
    req.on('error', () => resolve('网络错误'));
    req.on('timeout', () => { req.destroy(); resolve('超时'); });
    req.write(payload);
    req.end();
  });
}

// ── Request Handler ────────────────────────────────────────────────
async function handleRequest(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: POST /api/analyze
  if (req.method === 'POST' && req.url === '/api/analyze') {
    if (!PROVIDER) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '服务器未配置 API Key。请设置 GEMINI_API_KEY、ANTHROPIC_API_KEY 或 DEEPSEEK_API_KEY 环境变量' }));
      return;
    }

    try {
      const body = await parseBody(req);
      if (!body.image) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '缺少图片数据' }));
        return;
      }

      console.log(`[${new Date().toISOString()}] 分析菜单中... (${PROVIDER} API, 图片${body.image.length}字符)`);
      const result = await callVisionAPI(body.image);
      console.log(`[${new Date().toISOString()}] 完成 — ${result.categories?.length || 0} 个分类`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error(`[${new Date().toISOString()}] 错误:`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: POST /api/chat (food Q&A)
  if (req.method === 'POST' && req.url === '/api/chat') {
    if (!PROVIDER) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '服务器未配置 API Key' }));
      return;
    }

    try {
      const body = await parseBody(req);
      if (!body.question) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '缺少问题' }));
        return;
      }

      console.log(`[${new Date().toISOString()}] 用户提问: ${body.question.slice(0, 60)}...`);
      const answer = await callChatAPI(body.question, body.menuContext);
      console.log(`[${new Date().toISOString()}] 回答: ${answer.slice(0, 60)}...`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ answer }));
    } catch (err) {
      console.error(`[${new Date().toISOString()}] 聊天错误:`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Health check
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      provider: PROVIDER || 'none',
      keyConfigured: !!API_KEY
    }));
    return;
  }

  // Static files
  serveStatic(req, res);
}

// ── Start Server ───────────────────────────────────────────────────
const server = http.createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   🍽️  菜单翻译助手 - Menu Scanner       ║');
  console.log(`║   地址:   http://${HOST}:${PORT}                  ║`);
  console.log(`║   API:    /api/analyze                  ║`);
  if (PROVIDER === 'gemini') {
    console.log('║   模型:   Gemini 2.5 Flash (免费)       ║');
  } else if (PROVIDER === 'deepseek') {
    console.log('║   模型:   DeepSeek (deepseek-chat)      ║');
  } else if (PROVIDER === 'anthropic') {
    console.log('║   模型:   Claude (claude-sonnet-4-6)    ║');
  }
  console.log(`║   状态:   ${PROVIDER ? '✅ 已配置 (' + PROVIDER + ')' : '❌ 未配置 API Key'}        ║`);
  console.log('╚═══════════════════════════════════════════╝');

  if (!PROVIDER) {
    console.log('\n⚠️  请设置以下任一环境变量：');
    console.log('   Gemini (免费):  set GEMINI_API_KEY=AIza...');
    console.log('   DeepSeek:       set DEEPSEEK_API_KEY=sk-...');
    console.log('   Anthropic:      set ANTHROPIC_API_KEY=sk-ant-...\n');
  }
});
