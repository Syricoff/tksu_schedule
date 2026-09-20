import { cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dataDirectory = resolve(import.meta.dirname, 'data');
const legacyDirectory = resolve(import.meta.dirname, 'legacy');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-data-and-legacy',
      configureServer(server) {
        server.middlewares.use('/data', (request, response, next) => {
          if (!request.url || !existsSync(dataDirectory)) return next();
          const relativePath = request.url.split('?')[0].replace(/^\//, '');
          const file = resolve(dataDirectory, relativePath);
          if (!file.startsWith(dataDirectory)) return next();
          if (!existsSync(file)) return next();
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(readFileSync(file));
        });

        server.middlewares.use('/legacy', (request, response, next) => {
          if (!request.url || !existsSync(legacyDirectory)) return next();
          let relativePath = request.url.split('?')[0].replace(/^\//, '');
          if (!relativePath || relativePath.endsWith('/')) {
            relativePath += 'index.html';
          }
          const file = resolve(legacyDirectory, relativePath);
          if (!file.startsWith(legacyDirectory)) return next();
          if (!existsSync(file)) return next();

          if (file.endsWith('.html')) response.setHeader('Content-Type', 'text/html; charset=utf-8');
          else if (file.endsWith('.js')) response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          else if (file.endsWith('.css')) response.setHeader('Content-Type', 'text/css; charset=utf-8');
          else if (file.endsWith('.svg')) response.setHeader('Content-Type', 'image/svg+xml');
          response.end(readFileSync(file));
        });
      },
      closeBundle() {
        const distDir = resolve(import.meta.dirname, 'dist');
        if (existsSync(dataDirectory)) {
          cpSync(dataDirectory, resolve(distDir, 'data'), { recursive: true });
        }
        if (existsSync(legacyDirectory)) {
          cpSync(legacyDirectory, resolve(distDir, 'legacy'), { recursive: true });
        }
      },
    },
  ],
  base: './',
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});