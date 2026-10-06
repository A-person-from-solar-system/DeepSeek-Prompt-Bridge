const STORAGE = {
  chats: 'deepseek.promptStudio.chats.v1',
  prompt: 'deepseek.promptStudio.prompt.v1',
  settings: 'deepseek.promptStudio.settings.v1',
  apiKey: 'deepseek.promptStudio.apiKey'
};

const DEFAULT_SETTINGS = { model: 'deepseek-flash', modelLabel: 'DeepSeek Flash', temperature: 1, maxTokens: 8192, thinking: false };
const legacyPrompt = normalizePrompt(readLocal(STORAGE.prompt, { system: '', examples: [] }));
const state = {
  chats: readLocal(STORAGE.chats, []).map((chat) => ({ ...chat, prompt: normalizePrompt(chat.prompt || legacyPrompt) })),
  activeId: null,
  prompt: { system: '', examples: [] },
  settings: { ...DEFAULT_SETTINGS, ...readLocal(STORAGE.settings, {}) },
  streaming: false,
  abortController: null
};

const $ = (selector) => document.querySelector(selector);
const els = {
  sidebar: $('#sidebar'), history: $('#historyList'), welcome: $('#welcome'), messages: $('#messages'), conversation: $('#conversation'),
  form: $('#composer'), input: $('#messageInput'), send: $('#sendButton'), drawer: $('#promptDrawer'), scrim: $('#scrim'),
  systemPrompt: $('#systemPrompt'), examples: $('#examples'), promptDot: $('#promptStatusDot'), saveState: $('#saveState'),
  modal: $('#settingsModal'), apiKey: $('#apiKey'), temperature: $('#temperature'), temperatureValue: $('#temperatureValue'),
  maxTokens: $('#maxTokens'), modelMenu: $('#modelMenu'), modelLabel: $('#modelLabel'), toast: $('#toast'), think: $('#thinkToggle')
};

init();

function init() {
  if (!state.chats.length) createChat(false);
  else { state.activeId = state.chats[0].id; loadActivePrompt(); }
  els.systemPrompt.value = state.prompt.system || '';
  els.modelLabel.textContent = state.settings.modelLabel;
  els.think.classList.toggle('active', state.settings.thinking);
  bindEvents();
  renderAll();
  fetch('/api/health').then((r) => r.json()).then((health) => {
    if (!health.hasServerKey && !sessionStorage.getItem(STORAGE.apiKey)) setTimeout(openSettings, 500);
  }).catch(() => showToast('本地服务连接异常'));
}

function bindEvents() {
  $('#newChatButton').addEventListener('click', () => createChat());
  $('#promptButton').addEventListener('click', openDrawer);
  document.querySelectorAll('[data-close-drawer]').forEach((button) => button.addEventListener('click', closeOverlays));
  $('#settingsButton').addEventListener('click', openSettings);
  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeOverlays));
  els.scrim.addEventListener('click', closeOverlays);
  $('#addExample').addEventListener('click', addExample);
  $('#resetPrompt').addEventListener('click', resetPrompt);
  els.systemPrompt.addEventListener('input', () => { state.prompt.system = els.systemPrompt.value; persistPrompt(); });
  els.form.addEventListener('submit', sendMessage);
  els.input.addEventListener('input', resizeInput);
  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); els.form.requestSubmit(); }
  });
  document.querySelectorAll('.suggestion').forEach((button) => button.addEventListener('click', () => {
    els.input.value = button.firstChild.textContent.trim(); resizeInput(); els.input.focus();
  }));
  $('#openSidebar').addEventListener('click', () => { els.sidebar.classList.add('open'); els.scrim.classList.add('open'); });
  $('#closeSidebar').addEventListener('click', closeOverlays);
  $('#collapseSidebar').addEventListener('click', () => { if (innerWidth <= 800) closeOverlays(); });
  $('#modelButton').addEventListener('click', (event) => { event.stopPropagation(); els.modelMenu.classList.toggle('open'); });
  els.modelMenu.addEventListener('click', (event) => {
    const option = event.target.closest('[data-model]'); if (!option) return;
    state.settings.model = option.dataset.model; state.settings.modelLabel = option.dataset.label;
    els.modelLabel.textContent = state.settings.modelLabel; persistSettings(); els.modelMenu.classList.remove('open');
  });
  document.addEventListener('click', () => els.modelMenu.classList.remove('open'));
  $('#toggleSecret').addEventListener('click', (event) => {
    const show = els.apiKey.type === 'password'; els.apiKey.type = show ? 'text' : 'password'; event.target.textContent = show ? '隐藏' : '显示';
  });
  els.temperature.addEventListener('input', () => { els.temperatureValue.value = Number(els.temperature.value).toFixed(1); });
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#exportButton').addEventListener('click', exportChat);
  els.think.addEventListener('click', () => { state.settings.thinking = !state.settings.thinking; els.think.classList.toggle('active', state.settings.thinking); persistSettings(); showToast(state.settings.thinking ? '已切换为 V4 Pro 进行深度思考' : '已关闭深度思考'); });
  document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); createChat(); } if (event.key === 'Escape') closeOverlays(); });
}

function createChat(focus = true) {
  const copiedPrompt = normalizePrompt(state.prompt);
  const chat = { id: crypto.randomUUID(), title: '新对话', createdAt: Date.now(), messages: [], prompt: copiedPrompt };
  state.chats.unshift(chat); state.activeId = chat.id; loadActivePrompt(); persistChats(); renderAll();
  if (focus) { closeOverlays(); els.input.focus(); }
}

function currentChat() { return state.chats.find((chat) => chat.id === state.activeId); }

function renderAll() { renderHistory(); renderMessages(); renderPromptStatus(); }

function renderHistory() {
  els.history.innerHTML = '';
  for (const chat of state.chats) {
    const button = document.createElement('button'); button.className = `history-item${chat.id === state.activeId ? ' active' : ''}`;
    const title = document.createElement('span'); title.textContent = chat.title;
    const remove = document.createElement('span'); remove.className = 'delete-chat'; remove.textContent = '×'; remove.title = '删除';
    remove.addEventListener('click', (event) => { event.stopPropagation(); deleteChat(chat.id); });
    button.append(title, remove); button.addEventListener('click', () => { state.activeId = chat.id; loadActivePrompt(); renderAll(); closeOverlays(); }); els.history.append(button);
  }
}

function deleteChat(id) {
  state.chats = state.chats.filter((chat) => chat.id !== id);
  if (!state.chats.length) createChat(false); else if (state.activeId === id) { state.activeId = state.chats[0].id; loadActivePrompt(); }
  persistChats(); renderAll();
}

function renderMessages() {
  const chat = currentChat(); els.messages.innerHTML = '';
  const hasMessages = chat && chat.messages.length;
  els.welcome.hidden = Boolean(hasMessages); els.messages.hidden = !hasMessages;
  if (!hasMessages) return;
  for (const message of chat.messages) els.messages.append(createMessageElement(message));
  requestAnimationFrame(scrollToBottom);
}

function createMessageElement(message) {
  const wrapper = document.createElement('article'); wrapper.className = `message ${message.role}`; wrapper.dataset.messageId = message.id;
  const bubble = document.createElement('div'); bubble.className = 'message-bubble';
  if (message.role === 'assistant') {
    const head = document.createElement('div'); head.className = 'assistant-head'; head.innerHTML = '<span class="mini-logo">D</span><span>DeepSeek</span>'; bubble.append(head);
    if (message.reasoning) { const reasoning = document.createElement('div'); reasoning.className = 'reasoning'; reasoning.textContent = message.reasoning; bubble.append(reasoning); }
  }
  const content = document.createElement('div'); content.className = `message-content${message.streaming ? ' typing' : ''}${message.error ? ' error-message' : ''}`;
  if (message.role === 'assistant') content.innerHTML = renderMarkdown(message.content || (message.streaming ? '正在思考' : ''));
  else content.textContent = message.content;
  bubble.append(content); wrapper.append(bubble); return wrapper;
}

async function sendMessage(event) {
  event.preventDefault();
  if (state.streaming) { state.abortController?.abort(); return; }
  const text = els.input.value.trim(); if (!text) return;
  const chat = currentChat();
  const userMessage = { id: crypto.randomUUID(), role: 'user', content: text };
  chat.messages.push(userMessage);
  if (chat.title === '新对话') chat.title = text.replace(/\s+/g, ' ').slice(0, 26) || '新对话';
  els.input.value = ''; resizeInput(); persistChats(); renderAll();

  const assistant = { id: crypto.randomUUID(), role: 'assistant', content: '', reasoning: '', streaming: true };
  chat.messages.push(assistant); state.streaming = true; state.abortController = new AbortController(); els.send.textContent = '■';
  renderMessages();

  const requestMessages = buildRequestMessages(chat.messages.filter((item) => item.id !== assistant.id));
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', signal: state.abortController.signal,
      headers: { 'Content-Type': 'application/json', 'X-DeepSeek-API-Key': sessionStorage.getItem(STORAGE.apiKey) || '' },
      body: JSON.stringify({ model: state.settings.thinking ? 'deepseek-v4-pro' : state.settings.model, messages: requestMessages, temperature: state.settings.temperature, max_tokens: state.settings.maxTokens })
    });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `请求失败（${response.status}）`); }
    await consumeStream(response, assistant);
  } catch (error) {
    if (error.name === 'AbortError') { if (!assistant.content) assistant.content = '已停止生成。'; }
    else { assistant.content = `请求失败：${error.message}`; assistant.error = true; if (responseNeedsSettings(error.message)) setTimeout(openSettings, 350); }
  } finally {
    assistant.streaming = false; state.streaming = false; state.abortController = null; els.send.textContent = '↑'; persistChats(); renderAll();
  }
}

function buildRequestMessages(history) {
  const messages = [];
  if (state.prompt.system.trim()) messages.push({ role: 'system', content: state.prompt.system.trim() });
  for (const example of state.prompt.examples) {
    if (example.user.trim()) messages.push({ role: 'user', content: example.user.trim() });
    if (example.assistant.trim()) messages.push({ role: 'assistant', content: example.assistant.trim() });
  }
  for (const message of history) messages.push({ role: message.role, content: message.content });
  return messages;
}

async function consumeStream(response, message) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  while (true) {
    const { done, value } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim(); if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim(); if (!data || data === '[DONE]') continue;
      try {
        const chunk = JSON.parse(data); const delta = chunk.choices?.[0]?.delta || {};
        if (delta.reasoning_content) message.reasoning += delta.reasoning_content;
        if (delta.content) message.content += delta.content;
        updateStreamingMessage(message);
      } catch {}
    }
    if (done) break;
  }
}

function updateStreamingMessage(message) {
  const old = document.querySelector(`[data-message-id="${message.id}"]`); if (!old) return;
  old.replaceWith(createMessageElement(message)); scrollToBottom();
}

function openDrawer() { els.drawer.classList.add('open'); els.drawer.setAttribute('aria-hidden', 'false'); els.scrim.classList.add('open'); renderExamples(); }
function openSettings() {
  els.apiKey.value = sessionStorage.getItem(STORAGE.apiKey) || ''; els.temperature.value = state.settings.temperature; els.temperatureValue.value = Number(state.settings.temperature).toFixed(1); els.maxTokens.value = state.settings.maxTokens;
  els.modal.classList.add('open'); els.modal.setAttribute('aria-hidden', 'false'); els.scrim.classList.add('open');
}
function closeOverlays() { els.drawer.classList.remove('open'); els.modal.classList.remove('open'); els.sidebar.classList.remove('open'); els.scrim.classList.remove('open'); els.drawer.setAttribute('aria-hidden', 'true'); els.modal.setAttribute('aria-hidden', 'true'); }

function addExample() { state.prompt.examples.push({ id: crypto.randomUUID(), user: '', assistant: '' }); persistPrompt(); renderExamples(); }
function renderExamples() {
  els.examples.innerHTML = '';
  if (!state.prompt.examples.length) { const empty = document.createElement('div'); empty.className = 'empty-examples'; empty.textContent = '还没有示例。添加一组理想的提问与回答，帮助模型模仿风格。'; els.examples.append(empty); return; }
  state.prompt.examples.forEach((example, index) => {
    const card = document.createElement('div'); card.className = 'example-card';
    card.innerHTML = `<div class="example-title"><span>示例 ${index + 1}</span><button type="button" title="删除">删除</button></div><div class="example-fields"><label class="example-field"><span>User</span><textarea placeholder="示例提问"></textarea></label><label class="example-field"><span>Assistant</span><textarea placeholder="期望回答"></textarea></label></div>`;
    const [user, assistant] = card.querySelectorAll('textarea'); user.value = example.user; assistant.value = example.assistant;
    user.addEventListener('input', () => { example.user = user.value; persistPrompt(); }); assistant.addEventListener('input', () => { example.assistant = assistant.value; persistPrompt(); });
    card.querySelector('button').addEventListener('click', () => { state.prompt.examples.splice(index, 1); persistPrompt(); renderExamples(); }); els.examples.append(card);
  });
}
function resetPrompt() { state.prompt = { system: '', examples: [] }; els.systemPrompt.value = ''; persistPrompt(); renderExamples(); showToast('提示词配置已清空'); }
function persistPrompt() {
  const chat = currentChat();
  if (chat) chat.prompt = normalizePrompt(state.prompt);
  localStorage.setItem(STORAGE.prompt, JSON.stringify(state.prompt));
  persistChats(); els.saveState.textContent = '已自动保存'; renderPromptStatus();
}
function renderPromptStatus() { els.promptDot.classList.toggle('active', Boolean(state.prompt.system.trim() || state.prompt.examples.some((example) => example.user.trim() || example.assistant.trim()))); }

function saveSettings() {
  const key = els.apiKey.value.trim(); if (key) sessionStorage.setItem(STORAGE.apiKey, key); else sessionStorage.removeItem(STORAGE.apiKey);
  state.settings.temperature = Number(els.temperature.value); state.settings.maxTokens = Number(els.maxTokens.value) || 8192; persistSettings(); closeOverlays(); showToast('设置已保存');
}
function persistSettings() { localStorage.setItem(STORAGE.settings, JSON.stringify(state.settings)); }
function persistChats() { localStorage.setItem(STORAGE.chats, JSON.stringify(state.chats)); }

function exportChat() {
  const chat = currentChat(); if (!chat?.messages.length) { showToast('当前对话还没有内容'); return; }
  const lines = [`# ${chat.title}`, '', ...(state.prompt.system ? ['> 系统提示词：' + state.prompt.system.replace(/\n/g, '\n> '), ''] : [])];
  chat.messages.forEach((message) => lines.push(`## ${message.role === 'user' ? '我' : 'DeepSeek'}`, '', message.content, ''));
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${safeFilename(chat.title)}.md`; a.click(); URL.revokeObjectURL(url);
}

function renderMarkdown(text) {
  const escaped = escapeHtml(text); const blocks = [];
  let html = escaped.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, language, code) => { const key = `@@BLOCK${blocks.length}@@`; blocks.push(`<pre><code data-language="${language.trim()}">${code}</code></pre>`); return key; });
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.split(/\n{2,}/).map((part) => part.startsWith('@@BLOCK') ? part : `<p>${part.replace(/\n/g, '<br>')}</p>`).join('');
  blocks.forEach((block, index) => { html = html.replace(`<p>@@BLOCK${index}@@</p>`, block).replace(`@@BLOCK${index}@@`, block); }); return html;
}

function resizeInput() { els.input.style.height = 'auto'; els.input.style.height = `${Math.min(els.input.scrollHeight, 160)}px`; }
function scrollToBottom() { els.conversation.scrollTop = els.conversation.scrollHeight; }
function showToast(text) { els.toast.textContent = text; els.toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2400); }
function readLocal(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } }
function normalizePrompt(prompt) {
  return {
    system: typeof prompt?.system === 'string' ? prompt.system : '',
    examples: Array.isArray(prompt?.examples) ? prompt.examples.map((example) => ({ id: example.id || crypto.randomUUID(), user: String(example.user || ''), assistant: String(example.assistant || '') })) : []
  };
}
function loadActivePrompt() {
  state.prompt = normalizePrompt(currentChat()?.prompt || legacyPrompt);
  if (els.systemPrompt) els.systemPrompt.value = state.prompt.system;
}
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text || ''; return div.innerHTML; }
function safeFilename(text) { return text.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || 'DeepSeek 对话'; }
function responseNeedsSettings(message) { return /API Key|401|authentication|授权/i.test(message); }
