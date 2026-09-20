import { cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dataDirectory = resolve(import.meta.dirname, '../data');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-root-data',
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
      },
      generateBundle() {
        if (existsSync(dataDirectory)) cpSync(dataDirectory, resolve(import.meta.dirname, 'dist/data'), { recursive: true });
      },
    },
  ],
  base: './',
});