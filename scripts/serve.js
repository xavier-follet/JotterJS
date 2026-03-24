#!/usr/bin/env node
/**
 * Minimal dev server — serves project root on http://localhost:3000
 * Opens the test page automatically.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.map':  'application/json',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];

  // Default route → test page
  if (urlPath === '/' || urlPath === '') urlPath = '/test/index.html';

  const filePath = path.join(ROOT, urlPath);

  // Security: stay within root
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${urlPath}`);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  HTMLed dev server running at ${url}\n`);

  // Try to open browser (best-effort, cross-platform)
  const { exec } = require('child_process');
  const open =
    process.platform === 'win32'  ? `start ${url}` :
    process.platform === 'darwin' ? `open ${url}`  : `xdg-open ${url}`;
  exec(open, () => {});
});
