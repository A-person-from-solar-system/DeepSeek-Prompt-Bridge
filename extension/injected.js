(() => {
  'use strict';

  if (window.__DS_PROMPT_BRIDGE_INSTALLED__) return;
  window.__DS_PROMPT_BRIDGE_INSTALLED__ = true;

  const API_PATTERNS = [
    '/api/v0/chat/completion',
    '/api/v0/chat/regenerate',
    '/chat/completions',
    '/v1/chat/completions'
  ];
  const CONFIG_NODE_ID = 'ds-prompt-bridge-config';
  const CONFIG_EVENT = 'ds-prompt-bridge:config';
  const STATUS_EVENT = 'ds-prompt-bridge:status';
  let config = emptyConfig();

  function emptyConfig() {
    return { enabled: true, systemPrompt: '', examples: [], sessionId: '' };
  }

  function loadConfigFromDom() {
    const node = document.getElementById(CONFIG_NODE_ID);
    if (!node) return;
    try {
      const next = JSON.parse(node.textContent || '{}');
      config = {
        enabled: next.enabled !== false,
        systemPrompt: typeof next.systemPrompt === 'string' ? next.systemPrompt : '',
        examples: Array.isArray(next.examples) ? next.examples : [],
        sessionId: typeof next.sessionId === 'string' ? next.sessionId : ''
      };
      emitStatus('configured');
    } catch (error) {
      emitStatus('error', `读取配置失败：${error.message}`);
    }
  }

  function matchesApi(input) {
    const url = input instanceof Request ? input.url : String(input || '');
    return API_PATTERNS.some((pattern) => url.includes(pattern));
  }

  function hasUsableConfig() {
    return config.enabled && Boolean(
      config.systemPrompt.trim() ||
      config.examples.some((item) => String(item?.user || '').trim() || String(item?.assistant || '').trim())
    );
  }

  function createPromptPrefix() {
    const sections = [];
    if (config.systemPrompt.trim()) {
      sections.push(`<DS_SYSTEM_INSTRUCTIONS>\n${config.systemPrompt.trim()}\n</DS_SYSTEM_INSTRUCTIONS>`);
    }
    const examples = config.examples.flatMap((item) => {
      const messages = [];
      const user = String(item?.user || '').trim();
      const assistant = String(item?.assistant || '').trim();
      if (user) messages.push(`User: ${user}`);
      if (assistant) messages.push(`Assistant: ${assistant}`);
      return messages;
    });
    if (examples.length) sections.push(`<DS_FEW_SHOT_EXAMPLES>\n${examples.join('\n\n')}\n</DS_FEW_SHOT_EXAMPLES>`);
    return sections.join('\n\n');
  }

  function createStructuredMessages(originalMessages) {
    const injected = [];
    if (config.systemPrompt.trim()) injected.push({ role: 'system', content: config.systemPrompt.trim() });
    for (const item of config.examples) {
      const user = String(item?.user || '').trim();
      const assistant = String(item?.assistant || '').trim();
      if (user) injected.push({ role: 'user', content: user });
      if (assistant) injected.push({ role: 'assistant', content: assistant });
    }
    return [...injected, ...originalMessages];
  }

  function modifyJsonText(raw, url) {
    if (!hasUsableConfig() || typeof raw !== 'string') return raw;
    try {
      const data = JSON.parse(raw);
      let modified = false;
      if (Array.isArray(data.messages)) {
        data.messages = createStructuredMessages(data.messages);
        modified = true;
      } else if (typeof data.prompt === 'string') {
        const prefix = createPromptPrefix();
        if (prefix) {
          data.prompt = `${prefix}\n\n<DS_CURRENT_USER_MESSAGE>\n${data.prompt}\n</DS_CURRENT_USER_MESSAGE>`;
          modified = true;
        }
      }
      if (modified) {
        emitStatus('injected', undefined, url);
        return JSON.stringify(data);
      }
    } catch (error) {
      emitStatus('error', `无法解析聊天请求：${error.message}`);
    }
    return raw;
  }

  async function modifyBody(body, url) {
    if (typeof body === 'string') return modifyJsonText(body, url);
    if (body instanceof Blob) {
      const raw = await body.text();
      const modified = modifyJsonText(raw, url);
      return modified === raw ? body : new Blob([modified], { type: body.type || 'application/json' });
    }
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      try {
        const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
        const raw = new TextDecoder().decode(bytes);
        const modified = modifyJsonText(raw, url);
        return modified === raw ? body : new TextEncoder().encode(modified);
      } catch {}
    }
    return body;
  }

  function emitStatus(type, message, url) {
    const node = document.getElementById(CONFIG_NODE_ID);
    if (!node) return;
    node.dataset.status = JSON.stringify({ type, message: message || '', url: url ? String(url) : '', at: Date.now() });
    window.dispatchEvent(new Event(STATUS_EVENT));
  }

  const originalFetch = window.fetch;
  window.fetch = async function promptBridgeFetch(input, init) {
    if (!matchesApi(input) || !hasUsableConfig()) return originalFetch.apply(this, arguments);
    try {
      if (input instanceof Request && (!init || init.body == null)) {
        const raw = await input.clone().text();
        const body = modifyJsonText(raw, input.url);
        if (body !== raw) return originalFetch.call(this, new Request(input, { body }));
      } else if (init?.body != null) {
        const nextInit = { ...init, body: await modifyBody(init.body, input instanceof Request ? input.url : input) };
        return originalFetch.call(this, input, nextInit);
      }
    } catch (error) {
      emitStatus('error', `Fetch 注入失败：${error.message}`);
    }
    return originalFetch.apply(this, arguments);
  };

  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  const originalSend = OriginalXHR.prototype.send;
  OriginalXHR.prototype.open = function(method, url) {
    this.__dsPromptBridgeUrl = String(url || '');
    return originalOpen.apply(this, arguments);
  };
  OriginalXHR.prototype.send = function(body) {
    if (matchesApi(this.__dsPromptBridgeUrl) && hasUsableConfig() && typeof body === 'string') arguments[0] = modifyJsonText(body, this.__dsPromptBridgeUrl);
    return originalSend.apply(this, arguments);
  };

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function PromptBridgeWebSocket(url, protocols) {
    const socket = protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols);
    const originalSocketSend = socket.send;
    socket.send = function(data) {
      if (hasUsableConfig() && typeof data === 'string') data = modifyJsonText(data, url);
      return originalSocketSend.call(this, data);
    };
    return socket;
  };
  Object.setPrototypeOf(window.WebSocket, OriginalWebSocket);
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((key) => {
    try { window.WebSocket[key] = OriginalWebSocket[key]; } catch {}
  });

  window.addEventListener(CONFIG_EVENT, loadConfigFromDom);
  loadConfigFromDom();
})();
