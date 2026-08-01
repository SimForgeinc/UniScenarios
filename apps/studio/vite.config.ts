import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

// Serves the gitignored dev-assets/ tree (multi-GB map data) at /dev-assets/*
// with Range support, without copying anything into public/.
function devAssets(): Plugin {
  const root = path.resolve(__dirname, '../../dev-assets');
  return {
    name: 'dev-assets',
    configureServer(server) {
      server.middlewares.use('/dev-assets', (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = path.join(root, urlPath);
        if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return next();
        }
        const stat = fs.statSync(file);
        const range = req.headers.range;
        const type =
          file.endsWith('.glb') ? 'model/gltf-binary'
          : file.endsWith('.png') ? 'image/png'
          : file.endsWith('.hdr') ? 'application/octet-stream'
          : file.endsWith('.json') ? 'application/json'
          : file.endsWith('.gz') ? 'application/gzip'
          : 'application/octet-stream';
        res.setHeader('Content-Type', type);
        res.setHeader('Accept-Ranges', 'bytes');
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range);
          const start = m && m[1] ? parseInt(m[1], 10) : 0;
          const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', end - start + 1);
          fs.createReadStream(file, { start, end }).pipe(res);
        } else {
          res.setHeader('Content-Length', stat.size);
          fs.createReadStream(file).pipe(res);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devAssets()],
  server: { port: 5199 },
});
