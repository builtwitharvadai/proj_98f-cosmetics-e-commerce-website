import express, { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

const router = express.Router();

/**
 * Health check endpoint - basic liveness probe
 * Returns 200 if service is running
 */
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness check endpoint - includes database connectivity check
 * Returns 200 if service is ready to accept traffic
 * Returns 503 if database is not accessible
 */
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: errorMessage,
    });
  }
});

export default router;