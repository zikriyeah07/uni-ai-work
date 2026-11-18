import { Router } from 'express';
import { createScan } from '../controllers/scan.controller.js';
import { analyzeCv, generateRoadmap } from '../controllers/ai.controller.js';
import { DEFAULT_OPENROUTER_MODEL } from '../services/openrouter-client.js';
import { DEFAULT_GEMINI_MODEL } from '../services/gemini-client.js';
import { DEFAULT_OPENCODE_MODEL } from '../services/opencode-client.js';
import { getAiProviderOrder } from '../services/ai-provider-fallback.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    services: {
      pageSpeedApiKey: Boolean(process.env.PAGESPEED_API_KEY),
      opencode: Boolean(process.env.OPENCODE_API_KEY?.trim()),
      opencodeModel: process.env.OPENCODE_MODEL?.trim() || DEFAULT_OPENCODE_MODEL,
      openRouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      openRouterModel: process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
      gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
      geminiModel: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
      aiProviderOrder: getAiProviderOrder(),
    },
  });
});
router.post('/scan', createScan);
router.post('/cv/analyze', analyzeCv);
router.post('/roadmap/generate', generateRoadmap);
export default router;
