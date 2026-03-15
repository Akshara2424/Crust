import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Serve demo.html at root
  if (req.url === '/' || req.url === '/demo.html') {
    const filePath = path.join(__dirname, 'demo.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404: File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // Serve dist files
  if (req.url.startsWith('/dist/')) {
    const filePath = path.join(__dirname, req.url);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404: File not found');
        return;
      }
      const ext = path.extname(filePath);
      let contentType = 'application/octet-stream';
      if (ext === '.js') contentType = 'application/javascript';
      if (ext === '.ts') contentType = 'application/typescript';
      if (ext === '.css') contentType = 'text/css';
      if (ext === '.map') contentType = 'application/json';
      
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404: Not found');
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  🚀 Crust SDK Demo Server Running                              ║
╠════════════════════════════════════════════════════════════════╣
║  📍 Open in browser: http://localhost:${PORT}                    ║
║                                                                ║
║  🎯 Demo Instructions:                                        ║
║  1. Open http://localhost:${PORT} in your browser            ║
║  2. Press F12 to open DevTools                               ║
║  3. Go to Network tab                                        ║
║  4. Click "Login Verification" button                        ║
║  5. Watch the POST /verify request fire                      ║
║  6. Check Application tab (no cookies)                       ║
║  7. Check Sources tab (see Web Worker)                       ║
║                                                                ║
║  📡 Backend running on: http://localhost:8000                 ║
║     POST /api/crust/verify                                   ║
║                                                                ║
║  Press Ctrl+C to stop this server                            ║
╚════════════════════════════════════════════════════════════════╝
  `);
});
