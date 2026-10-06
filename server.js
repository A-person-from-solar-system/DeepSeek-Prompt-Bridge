const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_URL = 'https://api.deepseek.com/chat/completions';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/chat') {
      await proxyChat(req, res);
      return;
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      sendJson(res, 200, { ok: true, hasServerKey: Boolean(process.env.DEEPSEEK_API_KEY) });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`DeepSeek Prompt Studio: http://127.0.0.1:${PORT}`);
  console.log(process.env.DEEPSEEK_API_KEY ? 'API key: loaded from environment' : 'API key: enter it in the page settings');
});

async function proxyChat(req, res) {
  const body = await readJson(req, 2 * 1024 * 1024);
  const apiKey = process.env.DEEPSEEK_API_KEY || req.headers['x-deepseek-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    sendJson(res, 401, { error: '尚未配置 DeepSeek API Key。请在设置中填写，或设置 DEEPSEEK_API_KEY。' });
    return;
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    sendJson(res, 400, { error: 'messages 不能为空' });
    return;
  }

  const allowedRoles = new Set(['system', 'user', 'assistant']);
  const messages = body.messages.map((message) => {
    if (!message || !allowedRoles.has(message.role) || typeof message.content !== 'string') {
      throw new Error('消息格式不正确');
    }
    return { role: message.role, content: message.content };
  });

  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  let upstream;
  try {
    upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        model: typeof body.model === 'string' ? body.model : 'deepseek-flash',
        messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: clampNumber(body.temperature, 0, 2, 1),
        max_tokens: clampNumber(body.max_tokens, 1, 32768, 8192)
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') return;
    sendJson(res, 502, { error: `无法连接 DeepSeek API：${error.message}` });
    return;
  }

  if (!upstream.ok) {
    const raw = await upstream.text();
    let message = `DeepSeek API 返回 ${upstream.status}`;
    try {
      const parsed = JSON.parse(raw);
      message = parsed.error?.message || parsed.error || message;
    } catch {}
    sendJson(res, upstream.status, { error: String(message) });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(filePath).pipe(res);
  });
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        reject(new Error('请求内容过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('无效的 JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
