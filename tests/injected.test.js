const assert = require('node:assert/strict');

const listeners = new Map();
const configNode = {
  textContent: JSON.stringify({
    enabled: true,
    systemPrompt: '只输出简洁答案',
    examples: [{ user: '1+1', assistant: '2' }],
    sessionId: 'test-session'
  }),
  dataset: {}
};

global.window = globalThis;
global.document = { getElementById: (id) => id === 'ds-prompt-bridge-config' ? configNode : null };
global.addEventListener = (name, handler) => {
  const group = listeners.get(name) || [];
  group.push(handler);
  listeners.set(name, group);
};
global.dispatchEvent = (event) => {
  for (const handler of listeners.get(event.type) || []) handler(event);
  return true;
};

class FakeXHR {
  open(method, url) { this.method = method; this.url = url; }
  send(body) { this.sentBody = body; return body; }
}
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) { this.url = url; }
  send(data) { this.sentData = data; return data; }
}

global.XMLHttpRequest = FakeXHR;
global.WebSocket = FakeWebSocket;
global.fetch = async (input, init) => ({ input, init });

require('../extension/injected.js');

async function run() {
  const structured = await fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }] })
  });
  const structuredBody = JSON.parse(structured.init.body);
  assert.deepEqual(structuredBody.messages, [
    { role: 'system', content: '只输出简洁答案' },
    { role: 'user', content: '1+1' },
    { role: 'assistant', content: '2' },
    { role: 'user', content: '你好' }
  ]);

  const prompt = await fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST', body: JSON.stringify({ prompt: '介绍一下自己' })
  });
  const promptBody = JSON.parse(prompt.init.body);
  assert.match(promptBody.prompt, /<DS_SYSTEM_INSTRUCTIONS>/);
  assert.match(promptBody.prompt, /<DS_FEW_SHOT_EXAMPLES>/);
  assert.match(promptBody.prompt, /<DS_CURRENT_USER_MESSAGE>\n介绍一下自己/);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://chat.deepseek.com/api/v0/chat/completion');
  xhr.send(JSON.stringify({ prompt: 'XHR 消息' }));
  assert.match(JSON.parse(xhr.sentBody).prompt, /XHR 消息/);
  assert.match(JSON.parse(xhr.sentBody).prompt, /DS_SYSTEM_INSTRUCTIONS/);

  configNode.textContent = JSON.stringify({ enabled: false, systemPrompt: '不应注入', examples: [] });
  dispatchEvent(new Event('ds-prompt-bridge:config'));
  const original = JSON.stringify({ prompt: '保持原样' });
  const disabled = await fetch('https://chat.deepseek.com/api/v0/chat/completion', { method: 'POST', body: original });
  assert.equal(disabled.init.body, original);

  console.log('injected request tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
