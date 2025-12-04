import Redis from 'ioredis';

declare global {
  // eslint-disable-next-line no-var
  var redis: Redis | undefined;
}

interface RedisConfig {
  maxRetriesPerRequest: number;
  enableReadyCheck: boolean;
  lazyConnect: boolean;
  retryStrategy: (times: number) => number | void;
  reconnectOnError: (err: Error) => boolean | 1 | 2;
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MAX_RETRY_ATTEMPTS = 10;
const BASE_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;

/**
 * Calculate exponential backoff delay with jitter
 * @param attempt - Current retry attempt number
 * @returns Delay in milliseconds
 */
function calculateRetryDelay(attempt: number): number {
  const exponentialDelay = Math.min(
    BASE_RETRY_DELAY * Math.pow(2, attempt - 1),
    MAX_RETRY_DELAY
  );
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.floor(exponentialDelay + jitter);
}

/**
 * Create Redis configuration with retry logic and error handling
 * @returns Redis configuration object
 */
function createRedisConfig(): RedisConfig {
  return {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times: number): number | void => {
      if (times > MAX_RETRY_ATTEMPTS) {
        console.error(
          `[Redis] Max retry attempts (${MAX_RETRY_ATTEMPTS}) exceeded. Giving up.`,
          {
            timestamp: new Date().toISOString(),
            attempts: times,
          }
        );
        return undefined;
      }

      const delay = calculateRetryDelay(times);
      console.warn(`[Redis] Retry attempt ${times}/${MAX_RETRY_ATTEMPTS}. Retrying in ${delay}ms`, {
        timestamp: new Date().toISOString(),
        attempt: times,
        delayMs: delay,
      });

      return delay;
    },
    reconnectOnError: (err: Error): boolean | 1 | 2 => {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];
      const shouldReconnect = targetErrors.some((targetError) =>
        err.message.includes(targetError)
      );

      if (shouldReconnect) {
        console.warn('[Redis] Reconnecting due to error', {
          timestamp: new Date().toISOString(),
          error: err.message,
          errorName: err.name,
        });
        return 1;
      }

      console.error('[Redis] Non-recoverable error occurred', {
        timestamp: new Date().toISOString(),
        error: err.message,
        errorName: err.name,
        stack: err.stack,
      });

      return false;
    },
  };
}

/**
 * Setup Redis event handlers for monitoring and logging
 * @param client - Redis client instance
 */
function setupRedisEventHandlers(client: Redis): void {
  client.on('connect', () => {
    console.info('[Redis] Connection established', {
      timestamp: new Date().toISOString(),
      url: REDIS_URL.replace(/:[^:@]+@/, ':****@'),
    });
  });

  client.on('ready', () => {
    console.info('[Redis] Client ready to accept commands', {
      timestamp: new Date().toISOString(),
    });
  });

  client.on('error', (err: Error) => {
    console.error('[Redis] Client error occurred', {
      timestamp: new Date().toISOString(),
      error: err.message,
      errorName: err.name,
      stack: err.stack,
    });
  });

  client.on('close', () => {
    console.warn('[Redis] Connection closed', {
      timestamp: new Date().toISOString(),
    });
  });

  client.on('reconnecting', (delay: number) => {
    console.info('[Redis] Attempting to reconnect', {
      timestamp: new Date().toISOString(),
      delayMs: delay,
    });
  });

  client.on('end', () => {
    console.warn('[Redis] Connection ended', {
      timestamp: new Date().toISOString(),
    });
  });
}

/**
 * Get or create Redis client singleton with connection pooling and error handling
 * @returns Redis client instance
 */
function getRedisClient(): Redis {
  if (global.redis) {
    return global.redis;
  }

  console.info('[Redis] Initializing new Redis client', {
    timestamp: new Date().toISOString(),
    url: REDIS_URL.replace(/:[^:@]+@/, ':****@'),
  });

  const config = createRedisConfig();
  const client = new Redis(REDIS_URL, config);

  setupRedisEventHandlers(client);

  global.redis = client;

  return client;
}

/**
 * Gracefully disconnect Redis client
 * @returns Promise that resolves when disconnection is complete
 */
async function disconnectRedis(): Promise<void> {
  if (!global.redis) {
    return;
  }

  try {
    console.info('[Redis] Initiating graceful shutdown', {
      timestamp: new Date().toISOString(),
    });

    await global.redis.quit();

    console.info('[Redis] Graceful shutdown completed', {
      timestamp: new Date().toISOString(),
    });

    global.redis = undefined;
  } catch (error) {
    console.error('[Redis] Error during graceful shutdown', {
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });

    if (global.redis) {
      global.redis.disconnect();
      global.redis = undefined;
    }
  }
}

/**
 * Setup graceful shutdown handlers for process termination
 */
function setupGracefulShutdown(): void {
  const shutdownHandler = async (signal: string): Promise<void> => {
    console.info(`[Redis] Received ${signal} signal, shutting down gracefully`, {
      timestamp: new Date().toISOString(),
      signal,
    });

    await disconnectRedis();

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));

  process.on('uncaughtException', async (error: Error) => {
    console.error('[Redis] Uncaught exception, shutting down', {
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
    });

    await disconnectRedis();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason: unknown) => {
    console.error('[Redis] Unhandled rejection, shutting down', {
      timestamp: new Date().toISOString(),
      reason: reason instanceof Error ? reason.message : String(reason),
    });

    await disconnectRedis();
    process.exit(1);
  });
}

setupGracefulShutdown();

export const redis = getRedisClient();
export { disconnectRedis };