const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
http.createServer((req, res) => {
  const pathname = req.url === '/' ? '/tests/extension-preview.html' : req.url.split('?')[0];
  const file = path.resolve(root, pathname.replace(/^\/+/, ''));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(data);
  });
}).listen(3010, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:3010'));
