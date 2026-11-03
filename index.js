import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/src/app.js';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const app = createApp({
  expressFactory: express,
  spaIndexPath: path.resolve(projectDir, 'public', 'index.html'),
});

export default app;
