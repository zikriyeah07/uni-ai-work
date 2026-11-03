import { Router } from 'express';
import { createScan, getScan, listScans } from '../controllers/scan.controller.js';
import { analyzeCv, generateRoadmap } from '../controllers/ai.controller.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    services: {
      database: Boolean(process.env.DATABASE_URL),
      pageSpeedApiKey: Boolean(process.env.PAGESPEED_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
      geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
    },
  });
});
router.post('/scan', createScan);
router.post('/cv/analyze', analyzeCv);
router.post('/roadmap/generate', generateRoadmap);
router.get('/scans', listScans);
router.get('/scans/:id', getScan);

export default router;
