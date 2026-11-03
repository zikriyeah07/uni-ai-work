import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(clientDir, '..');
const requireFromClient = createRequire(import.meta.url);

function readEnvValue(file, key) {
  try {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const line = readFileSync(file, 'utf8').match(new RegExp(`^\\s*(?:export\\s+)?${escapedKey}\\s*=\\s*(.*?)\\s*$`, 'm'))?.[1];
    if (line === undefined) return undefined;
    const value = line.replace(/\s+#.*$/, '').trim();
    return value.replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return undefined;
  }
}

export default defineConfig(() => {
  // Read only API-specific configuration. A generic shell PORT can belong to
  // Vite or another service and must not redirect the API proxy.
  const projectEnv = path.resolve(projectDir, '.env');
  const serverEnv = path.resolve(projectDir, 'server', '.env');
  const apiPort = process.env.API_PORT
    || readEnvValue(projectEnv, 'API_PORT')
    || readEnvValue(serverEnv, 'API_PORT')
    || readEnvValue(projectEnv, 'PORT')
    || readEnvValue(serverEnv, 'PORT')
    || '4000';
  const apiTarget = `http://127.0.0.1:${apiPort}`;
  console.info(`[vite] SiteSense API proxy target: ${apiTarget}`);

  return {
    plugins: [react()],
    // AI feature sources live in their requested project folders outside
    // client/src. Resolve their imports to the shared client dependencies.
    resolve: {
      alias: [
        { find: 'react/jsx-runtime', replacement: requireFromClient.resolve('react/jsx-runtime') },
        { find: 'react/jsx-dev-runtime', replacement: requireFromClient.resolve('react/jsx-dev-runtime') },
        { find: 'react', replacement: requireFromClient.resolve('react') },
        { find: 'lucide-react', replacement: requireFromClient.resolve('lucide-react') },
      ],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const file = id.replaceAll('\\', '/');
            if (file.includes('/node_modules/react-router') || file.includes('/node_modules/@remix-run/')) return 'vendor-router';
            if (file.includes('/node_modules/react-dom/') || file.includes('/node_modules/react/') || file.includes('/node_modules/scheduler/')) return 'vendor-react';
            if (file.includes('/node_modules/recharts/') || file.includes('/node_modules/d3-') || file.includes('/node_modules/victory-vendor/')) return 'vendor-charts';
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: { '/api': { target: apiTarget, changeOrigin: true } },
    },
  };
});
