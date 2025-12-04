import { PrismaClient } from '@prisma/client';

/**
 * Global Prisma Client instance for database access
 * Implements singleton pattern to prevent connection pool exhaustion
 */
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * Configuration for Prisma Client based on environment
 */
const getPrismaConfig = () => {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  return {
    log: isDevelopment
      ? (['query', 'error', 'warn'] as const)
      : (['error', 'warn'] as const),
    errorFormat: isDevelopment ? ('pretty' as const) : ('minimal' as const),
  };
};

/**
 * Creates or retrieves the singleton Prisma Client instance
 * Implements connection pooling and proper logging configuration
 *
 * @returns {PrismaClient} Singleton Prisma Client instance
 */
const getPrismaClient = (): PrismaClient => {
  if (!global.prisma) {
    const config = getPrismaConfig();

    global.prisma = new PrismaClient({
      log: config.log,
      errorFormat: config.errorFormat,
    });

    // Log successful connection in development
    if (process.env.NODE_ENV !== 'production') {
      global.prisma
        .$connect()
        .then(() => {
          console.log('[Prisma] Database connection established successfully');
        })
        .catch((error: Error) => {
          console.error('[Prisma] Failed to connect to database:', error.message);
          throw error;
        });
    }
  }

  return global.prisma;
};

/**
 * Singleton Prisma Client instance
 * Use this throughout the application for database operations
 */
export const prisma = getPrismaClient();

/**
 * Connection retry configuration
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffMultiplier: 2,
} as const;

/**
 * Connects to the database with retry logic
 * Implements exponential backoff for connection failures
 *
 * @returns {Promise<void>}
 * @throws {Error} If connection fails after all retries
 */
export const connectWithRetry = async (): Promise<void> => {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      await prisma.$connect();
      console.log('[Prisma] Database connection established');
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const delay = RETRY_CONFIG.retryDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1);

      console.error(
        `[Prisma] Connection attempt ${attempt}/${RETRY_CONFIG.maxRetries} failed:`,
        lastError.message
      );

      if (attempt < RETRY_CONFIG.maxRetries) {
        console.log(`[Prisma] Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `[Prisma] Failed to connect to database after ${RETRY_CONFIG.maxRetries} attempts: ${lastError?.message}`
  );
};

/**
 * Gracefully disconnects from the database
 * Should be called during application shutdown
 *
 * @returns {Promise<void>}
 */
export const disconnect = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    console.log('[Prisma] Database connection closed gracefully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Prisma] Error during disconnect:', errorMessage);
    throw error;
  }
};

/**
 * Graceful shutdown handler
 * Ensures database connections are properly closed on process termination
 */
const setupGracefulShutdown = (): void => {
  const shutdownHandler = async (signal: string): Promise<void> => {
    console.log(`[Prisma] Received ${signal}, closing database connections...`);

    try {
      await disconnect();
      process.exit(0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Prisma] Error during graceful shutdown:', errorMessage);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('beforeExit', () => shutdownHandler('beforeExit'));
};

// Initialize graceful shutdown handlers
setupGracefulShutdown();

/**
 * Health check function to verify database connectivity
 *
 * @returns {Promise<boolean>} True if database is accessible, false otherwise
 */
export const healthCheck = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Prisma] Health check failed:', errorMessage);
    return false;
  }
};

/**
 * Type-safe database transaction helper
 * Provides a clean interface for executing multiple operations atomically
 *
 * @template T The return type of the transaction
 * @param {Function} fn Transaction function to execute
 * @returns {Promise<T>} Result of the transaction
 */
export const transaction = async <T>(
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>) => Promise<T>
): Promise<T> => {
  return prisma.$transaction(fn);
};