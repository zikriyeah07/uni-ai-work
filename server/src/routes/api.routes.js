import { Router } from 'express';
import { createScan, getScan, listScans } from '../controllers/scan.controller.js';
import { analyzeCv, generateRoadmap } from '../controllers/ai.controller.js';
import { DEFAULT_OPENROUTER_MODEL } from '../services/openrouter-client.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    services: {
      database: Boolean(process.env.DATABASE_URL),
      pageSpeedApiKey: Boolean(process.env.PAGESPEED_API_KEY),
      openRouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      openRouterModel: process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
    },
  });
});
router.post('/scan', createScan);
router.post('/cv/analyze', analyzeCv);
router.post('/roadmap/generate', generateRoadmap);
router.get('/scans', listScans);
router.get('/scans/:id', getScan);

export default router;
