import dotenv from 'dotenv';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import apiRoutes from './routes/api.routes.js';
import { AppError } from './utils/errors.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDir, '../../.env') });
try {
  const localFallback = dotenv.parse(readFileSync(path.resolve(serverDir, '../.env')));
  for (const [key, value] of Object.entries(localFallback)) {
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
} catch {
  // The server-local env file is optional; Vercel injects project env vars.
}

export function createApp({ expressFactory = express, spaIndexPath = null } = {}) {
  const app = expressFactory();
  app.disable('x-powered-by');
  if (process.env.VERCEL) app.set('trust proxy', true);
  app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',').map((origin) => origin.trim()) ?? 'http://localhost:5173' }));
  const windows = new Map();
  app.use(['/api/scan', '/api/cv/analyze', '/api/roadmap/generate'], (req, res, next) => {
    if (req.method !== 'POST') return next();
    const now = Date.now();
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const route = req.baseUrl;
    const key = `${route}:${ip}`;
    const prior = windows.get(key);
    const limit = route.includes('/cv/') ? 4 : route.includes('/roadmap/') ? 8 : 6;
    if (!prior || now - prior.startedAt > 60_000) windows.set(key, { startedAt: now, count: 1 });
    else if (prior.count >= limit) return res.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Request limit reached. Wait one minute before trying again.' } });
    else prior.count += 1;
    next();
  });

  // Keep quota protection ahead of JSON parsing. A base64 encoded CV stays
  // below Vercel's 4.5 MB function payload limit at the 2.8 MB file cap.
  app.use('/api/cv/analyze', expressFactory.json({ limit: '4.1mb' }));
  app.use(expressFactory.json({ limit: '32kb' }));

  // Vercel packages the built frontend with the Express function. Serve the
  // hashed Vite bundles before the SPA fallback so the browser can load them.
  if (spaIndexPath) {
    app.use(expressFactory.static(path.dirname(spaIndexPath), { index: false }));
  }

  app.get('/', (_req, res, next) => {
    if (spaIndexPath) return res.sendFile(spaIndexPath, (error) => { if (error) next(error); });
    res.json({ name: 'Applied AI Project Lab API', health: '/api/health' });
  });
  app.use('/api', apiRoutes);

  if (spaIndexPath) {
    const assetsDir = path.resolve(path.dirname(spaIndexPath), 'assets');
    // Vercel normally serves public assets from its CDN. Including a safe
    // function fallback also covers generated assets when deployment settings
    // or a static output configuration prevent the CDN from finding them.
    app.use('/assets', (req, res, next) => {
      let assetPath;
      try {
        const requestedPath = decodeURIComponent(req.path).replace(/^\/+/, '');
        assetPath = path.resolve(assetsDir, requestedPath);
      } catch (error) {
        return next(error);
      }
      const relativePath = path.relative(assetsDir, assetPath);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return next();
      res.sendFile(assetPath, { dotfiles: 'deny' }, (error) => {
        if (!error) return;
        if (error.statusCode === 404 || error.code === 'ENOENT') return next();
        next(error);
      });
    });

    app.use((req, res, next) => {
      const isApiPath = req.path === '/api' || req.path.startsWith('/api/');
      const isSpaNavigation = req.method === 'GET'
        && !isApiPath
        && !path.extname(req.path)
        && req.accepts('html');
      if (!isSpaNavigation) return next();
      res.sendFile(spaIndexPath, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((_req, _res, next) => next(new AppError('Route not found.', 404, 'NOT_FOUND')));
  app.use((error, req, res, _next) => {
    const parserError = error?.type === 'entity.parse.failed';
    const oversizedBody = error?.type === 'entity.too.large';
    const statusCode = error instanceof AppError ? error.statusCode : parserError ? 400 : oversizedBody ? 413 : 500;
    const code = error instanceof AppError ? error.code : parserError ? 'INVALID_JSON' : oversizedBody ? 'REQUEST_TOO_LARGE' : 'INTERNAL_ERROR';
    const message = oversizedBody ? req.originalUrl?.startsWith('/api/cv/analyze') ? 'CV upload is too large. PDF files must be 2.8 MB or smaller.' : 'Request body exceeds the allowed size.'
      : parserError ? 'Request body must be valid JSON.'
        : error instanceof AppError ? error.message : 'The server encountered an unexpected error.';
    if (statusCode >= 500) console.error('[api]', error);
    res.status(statusCode).json({ error: { code, message } });
  });

  return app;
}
