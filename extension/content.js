(() => {
  'use strict';

  const STORE_KEY = 'deepseekPromptBridgeSessions';
  const CONFIG_NODE_ID = 'ds-prompt-bridge-config';
  const CONFIG_EVENT = 'ds-prompt-bridge:config';
  const STATUS_EVENT = 'ds-prompt-bridge:status';
  const DEFAULT_ID = '__new_chat__';
  let sessions = {};
  let sessionId = getSessionId();
  let config = createDefaultConfig();
  let shadow;
  let host;
  let saveTimer;
  let lastUrl = location.href;

  start();

  async function start() {
    sessions = await storageGet(STORE_KEY) || {};
    config = normalizeConfig(sessions[sessionId] || sessions[DEFAULT_ID]);
    await domReady();
    publishConfig();
    mountUi();
    render();
    window.addEventListener(STATUS_EVENT, onInjectionStatus);
    setInterval(checkNavigation, 700);
  }

  function createDefaultConfig() {
    return { enabled: true, systemPrompt: '', examples: [] };
  }

  function normalizeConfig(value) {
    return {
      enabled: value?.enabled !== false,
      systemPrompt: typeof value?.systemPrompt === 'string' ? value.systemPrompt : '',
      examples: Array.isArray(value?.examples) ? value.examples.map((item) => ({
        id: item.id || crypto.randomUUID(), user: String(item.user || ''), assistant: String(item.assistant || '')
      })) : []
    };
  }

  function getSessionId() {
    const match = location.pathname.match(/\/a\/chat\/s\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : DEFAULT_ID;
  }

  async function checkNavigation() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const nextId = getSessionId();
    if (nextId === sessionId) return;
    sessionId = nextId;
    sessions = await storageGet(STORE_KEY) || {};
    config = normalizeConfig(sessions[sessionId] || sessions[DEFAULT_ID]);
    publishConfig();
    render();
  }

  function publishConfig() {
    let node = document.getElementById(CONFIG_NODE_ID);
    if (!node) {
      node = document.createElement('script');
      node.id = CONFIG_NODE_ID;
      node.type = 'application/json';
      (document.documentElement || document).appendChild(node);
    }
    node.textContent = JSON.stringify({ ...config, sessionId });
    window.dispatchEvent(new Event(CONFIG_EVENT));
  }

  function mountUi() {
    host = document.createElement('div');
    host.id = 'ds-prompt-bridge-root';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;top:0;right:0;width:0;height:0;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${styles()}</style><div id="app"></div>`;
    shadow.addEventListener('click', handleClick);
    shadow.addEventListener('input', handleInput);
    shadow.addEventListener('change', handleInput);
  }

  function render() {
    if (!shadow) return;
    const configured = Boolean(config.systemPrompt.trim() || config.examples.some((item) => item.user.trim() || item.assistant.trim()));
    const shortId = sessionId === DEFAULT_ID ? '新会话默认配置' : sessionId;
    shadow.getElementById('app').innerHTML = `
      <button class="launcher ${configured && config.enabled ? 'active' : ''}" data-action="open" title="系统提示词与示例"><span class="spark">✦</span><span>Prompt</span><i></i></button>
      <div class="scrim" data-action="close"></div>
      <aside class="drawer" aria-label="DeepSeek Prompt Bridge">
        <header><div><small>PROMPT BRIDGE</small><h2>会话增强</h2></div><button class="icon" data-action="close" aria-label="关闭">×</button></header>
        <div class="bound"><span>已绑定官网会话</span><code title="${escapeHtml(shortId)}">${escapeHtml(shortId)}</code></div>
        <main>
          <label class="switch-row"><span><b>启用注入</b><em>每次发送消息前自动加入以下上下文</em></span><input type="checkbox" data-field="enabled" ${config.enabled ? 'checked' : ''}><i class="switch"></i></label>
          <div class="section-title"><span><b>系统提示词</b><em>不会显示在官网的用户消息气泡中</em></span><span class="saved" id="saved">已保存</span></div>
          <textarea data-field="systemPrompt" placeholder="例如：你是一位严谨的软件架构师。回答前先检查假设……">${escapeHtml(config.systemPrompt)}</textarea>
          <div class="divider"></div>
          <div class="section-title examples-title"><span><b>对话示例</b><em>作为 few-shot 上下文随请求注入</em></span><button data-action="add">＋ 添加</button></div>
          <div class="examples">${config.examples.length ? config.examples.map(renderExample).join('') : '<div class="empty">还没有示例。添加理想的提问与回答，让模型模仿你需要的格式和风格。</div>'}</div>
          <details><summary>它是怎么工作的？</summary><p>扩展在官网请求发出前修改请求体，继续使用当前页面的登录状态、会话 ID 和免费额度。扩展不会读取或保存登录 token，也不会向其他服务器发送数据。</p></details>
        </main>
        <footer><button class="danger" data-action="clear">清空本会话配置</button><button class="done" data-action="close">完成</button></footer>
      </aside><div class="toast" id="toast"></div>`;
  }

  function renderExample(item, index) {
    return `<section class="example" data-example-id="${item.id}"><div class="example-head"><span>示例 ${index + 1}</span><button data-action="remove" data-id="${item.id}">删除</button></div><label><span>USER</span><textarea data-example="${item.id}" data-side="user" placeholder="示例提问">${escapeHtml(item.user)}</textarea></label><label><span>ASSISTANT</span><textarea data-example="${item.id}" data-side="assistant" placeholder="期望回答">${escapeHtml(item.assistant)}</textarea></label></section>`;
  }

  function handleClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'open') shadow.host.classList.add('ds-open');
    if (action === 'close') shadow.host.classList.remove('ds-open');
    if (action === 'add') {
      config.examples.push({ id: crypto.randomUUID(), user: '', assistant: '' });
      saveAndRender();
      requestAnimationFrame(() => shadow.querySelector('.example:last-child textarea')?.focus());
    }
    if (action === 'remove') {
      config.examples = config.examples.filter((item) => item.id !== button.dataset.id);
      saveAndRender();
    }
    if (action === 'clear') {
      config = createDefaultConfig();
      saveAndRender();
      showToast('本会话配置已清空');
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (target.dataset.field === 'enabled') config.enabled = target.checked;
    if (target.dataset.field === 'systemPrompt') config.systemPrompt = target.value;
    if (target.dataset.example) {
      const item = config.examples.find((entry) => entry.id === target.dataset.example);
      if (item && ['user', 'assistant'].includes(target.dataset.side)) item[target.dataset.side] = target.value;
    }
    scheduleSave();
  }

  function scheduleSave() {
    const saved = shadow?.getElementById('saved');
    if (saved) saved.textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await persist();
      if (saved?.isConnected) saved.textContent = '已保存';
      const launcher = shadow?.querySelector('.launcher');
      const active = config.enabled && Boolean(config.systemPrompt.trim() || config.examples.some((item) => item.user.trim() || item.assistant.trim()));
      launcher?.classList.toggle('active', active);
    }, 250);
  }

  function saveAndRender() {
    persist();
    const wasOpen = shadow.host.classList.contains('ds-open');
    render();
    if (wasOpen) shadow.host.classList.add('ds-open');
  }

  async function persist() {
    sessions[sessionId] = normalizeConfig(config);
    await storageSet(STORE_KEY, sessions);
    publishConfig();
  }

  function onInjectionStatus() {
    const node = document.getElementById(CONFIG_NODE_ID);
    if (!node?.dataset.status) return;
    try {
      const status = JSON.parse(node.dataset.status);
      if (status.type === 'injected') {
        showToast('已为本次消息注入提示词与示例');
        const launcher = shadow?.querySelector('.launcher');
        launcher?.classList.add('pulse');
        setTimeout(() => launcher?.classList.remove('pulse'), 900);
      } else if (status.type === 'error') showToast(status.message || '提示词注入失败', true);
    } catch {}
  }

  function showToast(text, error = false) {
    const toast = shadow?.getElementById('toast');
    if (!toast) return;
    toast.textContent = text;
    toast.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.className = 'toast', 2600);
  }

  function storageGet(key) { return new Promise((resolve) => chrome.storage.local.get(key, (result) => resolve(result[key]))); }
  function storageSet(key, value) { return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve)); }
  function domReady() {
    if (document.documentElement) return Promise.resolve();
    return new Promise((resolve) => new MutationObserver((_, observer) => {
      if (document.documentElement) { observer.disconnect(); resolve(); }
    }).observe(document, { childList: true }));
  }
  function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }

  function styles() {
    return `:host{--blue:#4d6bfe;--text:#252b3a;--muted:#8c93a5;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--text)}*{box-sizing:border-box}button,textarea,input{font:inherit}.launcher{position:fixed;right:18px;top:16px;height:38px;padding:0 13px;border:1px solid #dce2ff;border-radius:999px;display:flex;align-items:center;gap:7px;color:#4c62d3;background:#f7f8ff;box-shadow:0 5px 18px #26356b14;cursor:pointer;z-index:3}.launcher:hover{background:#eef2ff}.launcher i{width:7px;height:7px;border-radius:50%;background:#c4c8d2}.launcher.active i{background:#36af76;box-shadow:0 0 0 3px #dff5e9}.launcher.pulse{animation:pulse .8s}.spark{font-size:15px}.scrim{position:fixed;inset:0;background:#151a2b4a;opacity:0;visibility:hidden;transition:.2s;backdrop-filter:blur(1px)}.drawer{position:fixed;top:0;right:0;width:min(540px,100vw);height:100vh;display:flex;flex-direction:column;background:#fff;box-shadow:0 18px 60px #19234124;transform:translateX(102%);transition:.25s}:host(.ds-open) .scrim{opacity:1;visibility:visible}:host(.ds-open) .drawer{transform:none}.drawer header{height:83px;padding:17px 21px;border-bottom:1px solid #e8eaf0;display:flex;align-items:center;justify-content:space-between}.drawer header small{color:#6579db;font-size:10px;letter-spacing:1.4px;font-weight:700}.drawer h2{margin:4px 0 0;font-size:20px}.icon{width:36px;height:36px;border:0;border-radius:9px;background:transparent;font-size:22px;cursor:pointer}.icon:hover{background:#f1f3f7}.bound{padding:11px 21px;display:flex;align-items:center;gap:10px;color:#737b8e;background:#f7f8fb;font-size:11px}.bound code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#4d63ca}.drawer main{flex:1;overflow:auto;padding:20px 21px}.switch-row{display:flex;justify-content:space-between;align-items:center;padding:2px 0 20px}.switch-row span,.section-title>span{display:flex;flex-direction:column;gap:4px}.switch-row b,.section-title b{font-size:14px}.switch-row em,.section-title em{color:var(--muted);font-size:11px;font-style:normal}.switch-row input{display:none}.switch{width:42px;height:24px;border-radius:20px;background:#cfd3dc;position:relative;transition:.2s}.switch:after{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:#fff;box-shadow:0 1px 4px #0003;transition:.2s}.switch-row input:checked+.switch{background:var(--blue)}.switch-row input:checked+.switch:after{transform:translateX(18px)}.section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:15px;margin-bottom:10px}.saved{color:#45a373!important;font-size:11px!important}.drawer textarea{width:100%;min-height:170px;padding:13px;border:1px solid #dfe2e9;border-radius:11px;resize:vertical;outline:none;line-height:1.6;font-size:13px}.drawer textarea:focus{border-color:#9cafff;box-shadow:0 0 0 3px #eff2ff}.divider{height:1px;margin:24px 0;background:#e8eaf0}.examples-title button{height:34px;padding:0 12px;border:1px solid #d9dffb;border-radius:8px;color:#4c64d7;background:#f7f8ff;cursor:pointer}.examples{display:flex;flex-direction:column;gap:12px}.empty{padding:25px 20px;border:1px dashed #d9dce5;border-radius:11px;color:#979eae;text-align:center;font-size:12px;line-height:1.6}.example{border:1px solid #e1e4ea;border-radius:11px;overflow:hidden}.example-head{height:36px;padding:0 11px;display:flex;align-items:center;justify-content:space-between;background:#f7f8fa;color:#767e8e;font-size:11px}.example-head button{border:0;color:#a05762;background:transparent;cursor:pointer}.example label{display:block;padding:9px 11px;border-top:1px solid #eceef2}.example label span{display:block;margin-bottom:4px;color:#6478d6;font-size:9px;font-weight:700}.example textarea{min-height:66px;padding:0;border:0;border-radius:0;box-shadow:none;font-size:12px}.example textarea:focus{box-shadow:none}.drawer details{margin-top:19px;padding:11px 13px;border-radius:9px;color:#72798a;background:#f7f8fa;font-size:11px;line-height:1.6}.drawer summary{cursor:pointer;font-weight:600}.drawer footer{height:68px;padding:13px 21px;border-top:1px solid #e8eaf0;display:flex;align-items:center;justify-content:flex-end;gap:9px}.drawer footer button{height:36px;padding:0 14px;border:0;border-radius:9px;cursor:pointer}.danger{margin-right:auto;color:#9e5360;background:#fff0f2}.done{min-width:80px;color:#fff;background:var(--blue)}.toast{position:fixed;right:20px;bottom:24px;max-width:360px;padding:10px 14px;border-radius:9px;color:#fff;background:#2d3445;box-shadow:0 14px 40px #11182733;font-size:12px;opacity:0;visibility:hidden;transform:translateY(8px);transition:.2s}.toast.show{opacity:1;visibility:visible;transform:none}.toast.error{background:#a34051}@keyframes pulse{50%{box-shadow:0 0 0 7px #4d6bfe2e}}@media(max-width:720px){.launcher{right:12px;top:11px;width:39px;padding:0;justify-content:center}.launcher span:nth-child(2){display:none}.drawer main{padding:18px 17px}.drawer header,.drawer footer{padding-left:17px;padding-right:17px}}`;
  }
})();
