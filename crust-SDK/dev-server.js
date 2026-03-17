import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT     = 3000;
const DIST_DIR = path.join(__dirname, 'dist');
const HTML     = path.join(__dirname, 'demo.html');

// Log resolved paths on startup so you can verify them
console.log('Serving from:', __dirname);
console.log('dist/ folder:', DIST_DIR);
console.log('demo.html:   ', HTML);
console.log('dist exists: ', fs.existsSync(DIST_DIR));
console.log('iife exists: ', fs.existsSync(path.join(DIST_DIR, 'crust.iife.js')));

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.map':  'application/json',
  '.ts':   'application/typescript',
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = req.url ?? '/';

  // Root → demo.html
  if (url === '/' || url === '/demo.html') {
    if (!fs.existsSync(HTML)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404: demo.html not found at ' + HTML);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(HTML).pipe(res);
    return;
  }

  // /dist/* → serve from dist/ folder
  if (url.startsWith('/dist/')) {
    const filename = path.basename(url);
    const filePath = path.join(DIST_DIR, filename);

    console.log('GET ' + url + ' → ' + filePath + ' (exists: ' + fs.existsSync(filePath) + ')');

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404: ' + filename + ' not found in dist/');
      return;
    }

    const ext         = path.extname(filePath);
    const contentType = MIME[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404: ' + url + ' not found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  CRUST SDK Dev Server running');
  console.log('  Open:  http://localhost:' + PORT);
  console.log('  SDK:   http://localhost:' + PORT + '/dist/crust.iife.js');
  console.log('');
});