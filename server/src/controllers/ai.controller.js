import { asyncHandler } from '../utils/errors.js';
import { analyzeCv as analyzeCvService } from '../services/cv-analysis.service.js';
import { generateRoadmap as buildRoadmap } from '../services/roadmap.service.js';

export const analyzeCv = asyncHandler(async (req, res) => {
  const result = await analyzeCvService(req.body);
  res.json(result);
});

export const generateRoadmap = asyncHandler(async (req, res) => {
  const result = await buildRoadmap(req.body);
  res.json(result);
});
