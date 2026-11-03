import { z } from 'zod';
import { getPrisma } from '../db/prisma.js';
import { executeScan } from '../services/scan.service.js';
import { AppError, asyncHandler } from '../utils/errors.js';

const scanRequest = z.object({
  url: z.string().min(1).max(2048),
  device: z.enum(['mobile', 'desktop']).default('mobile'),
});

export const createScan = asyncHandler(async (req, res) => {
  const parsed = scanRequest.safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? 'Enter a valid website URL.', 400, 'INVALID_REQUEST');
  if (req.query.stream !== '1') {
    const scan = await executeScan(parsed.data);
    return res.status(201).json({ scan });
  }

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const send = (event, data) => {
    if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': keep-alive\n\n');
  }, 15000);
  heartbeat.unref?.();
  try {
    const scan = await executeScan({
      ...parsed.data,
      onProgress: (progress) => send('progress', progress),
    });
    send('result', { scan });
    res.end();
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    send('error', {
      error: {
        code: error instanceof AppError ? error.code : 'SCAN_FAILED',
        message: statusCode >= 500 ? 'The scan could not be completed. Please retry.' : error.message,
      },
    });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

export const listScans = asyncHandler(async (_req, res) => {
  const prisma = getPrisma();
  if (!prisma) return res.json({ scans: [], storageConfigured: false, message: 'Add DATABASE_URL to save and view scan history.' });
  const [scans, totalScans] = await Promise.all([prisma.scan.findMany({
    orderBy: { scannedAt: 'desc' },
    take: 100,
    select: {
      id: true, url: true, device: true, scannedAt: true, status: true,
      performanceScore: true, accessibilityScore: true, bestPracticesScore: true,
      seoScore: true, overallScore: true, _count: { select: { issues: true } },
    },
  }), prisma.scan.count()]);
  res.json({ scans, totalScans, storageConfigured: true });
});

export const getScan = asyncHandler(async (req, res) => {
  const prisma = getPrisma();
  if (!prisma) throw new AppError('Scan reports are only saved when DATABASE_URL is configured.', 503, 'STORAGE_UNAVAILABLE');
  const scan = await prisma.scan.findUnique({
    where: { id: req.params.id },
    include: { issues: { orderBy: { createdAt: 'asc' } }, recommendations: { orderBy: { createdAt: 'asc' } } },
  });
  if (!scan) throw new AppError('That scan report was not found.', 404, 'SCAN_NOT_FOUND');
  res.json({ scan });
});
