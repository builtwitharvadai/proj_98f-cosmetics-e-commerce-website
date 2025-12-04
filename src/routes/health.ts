import express, { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';

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
 * Readiness check endpoint - includes database and Redis connectivity check
 * Returns 200 if service is ready to accept traffic
 * Returns 503 if database or Redis is not accessible
 */
router.get('/ready', async (_req: Request, res: Response) => {
  let databaseStatus = 'disconnected';
  let redisStatus = 'disconnected';
  let databaseError: string | undefined;
  let redisError: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseStatus = 'connected';
  } catch (error) {
    databaseError = error instanceof Error ? error.message : String(error);
  }

  try {
    await redis.ping();
    redisStatus = 'connected';
  } catch (error) {
    redisError = error instanceof Error ? error.message : String(error);
  }

  const isReady = databaseStatus === 'connected' && redisStatus === 'connected';

  if (isReady) {
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      database: databaseStatus,
      redis: redisStatus,
    });
  } else {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      database: databaseStatus,
      redis: redisStatus,
      error: databaseError || redisError,
    });
  }
});

export default router;