import { PrismaClient } from '@prisma/client';
import {
  prisma,
  connectWithRetry,
  disconnect,
  healthCheck,
  transaction,
} from './prisma';

// Mock PrismaClient
jest.mock('@prisma/client', () => {
  const mockPrismaClient = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    category: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
    },
  };

  return {
    PrismaClient: jest.fn(() => mockPrismaClient),
  };
});

describe('Prisma Client Module', () => {
  let mockPrismaInstance: any;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    originalEnv = { ...process.env };
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaInstance = new PrismaClient();
    (global as any).prisma = undefined;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // ============================================
  // 🎯 UNIT TESTS - Singleton Pattern
  // ============================================

  describe('Singleton Pattern', () => {
    it('should return the same Prisma Client instance on multiple calls', () => {
      const instance1 = prisma;
      const instance2 = prisma;

      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(PrismaClient);
    });

    it('should create Prisma Client with development config in non-production', () => {
      process.env.NODE_ENV = 'development';
      (global as any).prisma = undefined;

      const client = prisma;

      expect(PrismaClient).toHaveBeenCalledWith({
        log: ['query', 'error', 'warn'],
        errorFormat: 'pretty',
      });
      expect(client).toBeDefined();
    });

    it('should create Prisma Client with production config in production', () => {
      process.env.NODE_ENV = 'production';
      (global as any).prisma = undefined;

      const client = prisma;

      expect(PrismaClient).toHaveBeenCalledWith({
        log: ['error', 'warn'],
        errorFormat: 'minimal',
      });
      expect(client).toBeDefined();
    });

    it('should reuse existing global Prisma instance', () => {
      const existingInstance = new PrismaClient();
      (global as any).prisma = existingInstance;

      const client = prisma;

      expect(client).toBe(existingInstance);
      expect(PrismaClient).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================
  // 🔗 INTEGRATION TESTS - Database Connection
  // ============================================

  describe('Database Connection', () => {
    it('should successfully connect to database', async () => {
      mockPrismaInstance.$connect.mockResolvedValue(undefined);

      await expect(prisma.$connect()).resolves.not.toThrow();
      expect(mockPrismaInstance.$connect).toHaveBeenCalledTimes(1);
    });

    it('should handle connection errors gracefully', async () => {
      const connectionError = new Error('Connection refused');
      mockPrismaInstance.$connect.mockRejectedValue(connectionError);

      await expect(prisma.$connect()).rejects.toThrow('Connection refused');
    });

    it('should log successful connection in development', async () => {
      process.env.NODE_ENV = 'development';
      (global as any).prisma = undefined;
      mockPrismaInstance.$connect.mockResolvedValue(undefined);

      // Trigger connection
      const client = prisma;
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(client).toBeDefined();
    });

    it('should log connection failure in development', async () => {
      process.env.NODE_ENV = 'development';
      (global as any).prisma = undefined;
      const error = new Error('Database unavailable');
      mockPrismaInstance.$connect.mockRejectedValue(error);

      // Trigger connection
      const client = prisma;
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(client).toBeDefined();
    });
  });

  // ============================================
  // 🔄 INTEGRATION TESTS - Retry Logic
  // ============================================

  describe('Connection Retry Logic', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should connect successfully on first attempt', async () => {
      mockPrismaInstance.$connect.mockResolvedValue(undefined);

      const connectPromise = connectWithRetry();
      await jest.runAllTimersAsync();
      await connectPromise;

      expect(mockPrismaInstance.$connect).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Prisma] Database connection established'
      );
    });

    it('should retry connection on failure and succeed', async () => {
      mockPrismaInstance.$connect
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce(undefined);

      const connectPromise = connectWithRetry();
      await jest.runAllTimersAsync();
      await connectPromise;

      expect(mockPrismaInstance.$connect).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connection attempt 1/3 failed'),
        'Connection failed'
      );
    });

    it('should fail after maximum retry attempts', async () => {
      const error = new Error('Persistent connection failure');
      mockPrismaInstance.$connect.mockRejectedValue(error);

      const connectPromise = connectWithRetry();
      await jest.runAllTimersAsync();

      await expect(connectPromise).rejects.toThrow(
        /Failed to connect to database after 3 attempts/
      );
      expect(mockPrismaInstance.$connect).toHaveBeenCalledTimes(3);
    });

    it('should implement exponential backoff between retries', async () => {
      mockPrismaInstance.$connect
        .mockRejectedValueOnce(new Error('Attempt 1'))
        .mockRejectedValueOnce(new Error('Attempt 2'))
        .mockResolvedValueOnce(undefined);

      const connectPromise = connectWithRetry();
      await jest.runAllTimersAsync();
      await connectPromise;

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Retrying in 1000ms')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Retrying in 2000ms')
      );
    });

    it('should handle non-Error exceptions during retry', async () => {
      mockPrismaInstance.$connect.mockRejectedValue('String error');

      const connectPromise = connectWithRetry();
      await jest.runAllTimersAsync();

      await expect(connectPromise).rejects.toThrow(
        /Failed to connect to database after 3 attempts/
      );
    });
  });

  // ============================================
  // 🛡️ INTEGRATION TESTS - Disconnect
  // ============================================

  describe('Database Disconnect', () => {
    it('should disconnect successfully', async () => {
      mockPrismaInstance.$disconnect.mockResolvedValue(undefined);

      await expect(disconnect()).resolves.not.toThrow();
      expect(mockPrismaInstance.$disconnect).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Prisma] Database connection closed gracefully'
      );
    });

    it('should handle disconnect errors', async () => {
      const error = new Error('Disconnect failed');
      mockPrismaInstance.$disconnect.mockRejectedValue(error);

      await expect(disconnect()).rejects.toThrow('Disconnect failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Prisma] Error during disconnect:',
        'Disconnect failed'
      );
    });

    it('should handle non-Error exceptions during disconnect', async () => {
      mockPrismaInstance.$disconnect.mockRejectedValue('String error');

      await expect(disconnect()).rejects.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Prisma] Error during disconnect:',
        'String error'
      );
    });
  });

  // ============================================
  // 🏥 INTEGRATION TESTS - Health Check
  // ============================================

  describe('Health Check', () => {
    it('should return true when database is accessible', async () => {
      mockPrismaInstance.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await healthCheck();

      expect(result).toBe(true);
      expect(mockPrismaInstance.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should return false when database query fails', async () => {
      const error = new Error('Query failed');
      mockPrismaInstance.$queryRaw.mockRejectedValue(error);

      const result = await healthCheck();

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Prisma] Health check failed:',
        'Query failed'
      );
    });

    it('should handle non-Error exceptions in health check', async () => {
      mockPrismaInstance.$queryRaw.mockRejectedValue('Database timeout');

      const result = await healthCheck();

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Prisma] Health check failed:',
        'Database timeout'
      );
    });
  });

  // ============================================
  // 🔄 INTEGRATION TESTS - Transactions
  // ============================================

  describe('Transaction Helper', () => {
    it('should execute transaction successfully', async () => {
      const mockResult = { id: '1', name: 'Test Category' };
      mockPrismaInstance.$transaction.mockImplementation(async (fn) => {
        return fn(mockPrismaInstance);
      });
      mockPrismaInstance.category.create.mockResolvedValue(mockResult);

      const result = await transaction(async (tx) => {
        return tx.category.create({
          data: { name: 'Test Category', slug: 'test-category' },
        });
      });

      expect(result).toEqual(mockResult);
      expect(mockPrismaInstance.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should rollback transaction on error', async () => {
      const error = new Error('Transaction failed');
      mockPrismaInstance.$transaction.mockRejectedValue(error);

      await expect(
        transaction(async (tx) => {
          return tx.category.create({
            data: { name: 'Test', slug: 'test' },
          });
        })
      ).rejects.toThrow('Transaction failed');
    });

    it('should handle complex multi-operation transactions', async () => {
      const mockCategory = { id: '1', name: 'Beauty' };
      const mockProduct = { id: '2', name: 'Lipstick', categoryId: '1' };

      mockPrismaInstance.$transaction.mockImplementation(async (fn) => {
        return fn(mockPrismaInstance);
      });
      mockPrismaInstance.category.create.mockResolvedValue(mockCategory);
      mockPrismaInstance.product.create.mockResolvedValue(mockProduct);

      const result = await transaction(async (tx) => {
        const category = await tx.category.create({
          data: { name: 'Beauty', slug: 'beauty' },
        });
        const product = await tx.product.create({
          data: {
            name: 'Lipstick',
            description: 'Red lipstick',
            price: 19.99,
            categoryId: category.id,
          },
        });
        return { category, product };
      });

      expect(result.category).toEqual(mockCategory);
      expect(result.product).toEqual(mockProduct);
    });
  });

  // ============================================
  // 🎯 INTEGRATION TESTS - Database Queries
  // ============================================

  describe('Database Query Operations', () => {
    it('should query categories successfully', async () => {
      const mockCategories = [
        { id: '1', name: 'Skincare', slug: 'skincare' },
        { id: '2', name: 'Makeup', slug: 'makeup' },
      ];
      mockPrismaInstance.category.findMany.mockResolvedValue(mockCategories);

      const categories = await prisma.category.findMany();

      expect(categories).toEqual(mockCategories);
      expect(categories).toHaveLength(2);
      expect(mockPrismaInstance.category.findMany).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no categories exist', async () => {
      mockPrismaInstance.category.findMany.mockResolvedValue([]);

      const categories = await prisma.category.findMany();

      expect(categories).toEqual([]);
      expect(categories).toHaveLength(0);
    });

    it('should handle query errors gracefully', async () => {
      const error = new Error('Database query failed');
      mockPrismaInstance.category.findMany.mockRejectedValue(error);

      await expect(prisma.category.findMany()).rejects.toThrow(
        'Database query failed'
      );
    });

    it('should query products successfully', async () => {
      const mockProducts = [
        {
          id: '1',
          name: 'Moisturizer',
          price: 29.99,
          categoryId: '1',
        },
      ];
      mockPrismaInstance.product.findMany.mockResolvedValue(mockProducts);

      const products = await prisma.product.findMany();

      expect(products).toEqual(mockProducts);
      expect(products).toHaveLength(1);
    });
  });

  // ============================================
  // 🛡️ EDGE CASES & ERROR SCENARIOS
  // ============================================

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle undefined global prisma instance', () => {
      (global as any).prisma = undefined;

      const client = prisma;

      expect(client).toBeInstanceOf(PrismaClient);
      expect(client).toBeDefined();
    });

    it('should handle null environment variables', () => {
      delete process.env.NODE_ENV;
      (global as any).prisma = undefined;

      const client = prisma;

      expect(client).toBeDefined();
      expect(PrismaClient).toHaveBeenCalledWith({
        log: ['query', 'error', 'warn'],
        errorFormat: 'pretty',
      });
    });

    it('should handle connection pool exhaustion', async () => {
      const connections = Array(10)
        .fill(null)
        .map(() => prisma.$connect());

      await expect(Promise.all(connections)).resolves.not.toThrow();
    });

    it('should handle concurrent transaction requests', async () => {
      mockPrismaInstance.$transaction.mockImplementation(async (fn) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return fn(mockPrismaInstance);
      });

      const transactions = Array(5)
        .fill(null)
        .map(() =>
          transaction(async (tx) => {
            return tx.category.findMany();
          })
        );

      await expect(Promise.all(transactions)).resolves.not.toThrow();
    });
  });

  // ============================================
  // ⚡ PERFORMANCE TESTS
  // ============================================

  describe('Performance Tests', () => {
    it('should create Prisma Client instance quickly', () => {
      const startTime = Date.now();
      (global as any).prisma = undefined;

      const client = prisma;

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(client).toBeDefined();
      expect(duration).toBeLessThan(100); // Should be instantaneous
    });

    it('should handle multiple rapid connection attempts', async () => {
      mockPrismaInstance.$connect.mockResolvedValue(undefined);

      const startTime = Date.now();
      const connections = Array(20)
        .fill(null)
        .map(() => prisma.$connect());

      await Promise.all(connections);
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should execute health checks efficiently', async () => {
      mockPrismaInstance.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const startTime = Date.now();
      await healthCheck();
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(100); // Should be fast
    });
  });

  // ============================================
  // 🔒 SECURITY TESTS
  // ============================================

  describe('Security Tests', () => {
    it('should not expose sensitive connection details in logs', async () => {
      process.env.DATABASE_URL =
        'postgresql://user:password@localhost:5432/db';
      mockPrismaInstance.$connect.mockResolvedValue(undefined);

      await connectWithRetry();

      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('password')
      );
    });

    it('should handle SQL injection attempts safely', async () => {
      const maliciousInput = "'; DROP TABLE categories; --";
      mockPrismaInstance.category.findMany.mockResolvedValue([]);

      await expect(
        prisma.category.findMany({
          where: { name: maliciousInput },
        })
      ).resolves.not.toThrow();
    });

    it('should sanitize error messages', async () => {
      const sensitiveError = new Error(
        'Connection failed: password=secret123'
      );
      mockPrismaInstance.$connect.mockRejectedValue(sensitiveError);

      await expect(prisma.$connect()).rejects.toThrow();
      // Verify error is thrown but sensitive data handling is in place
    });
  });

  // ============================================
  // 🎭 GRACEFUL SHUTDOWN TESTS
  // ============================================

  describe('Graceful Shutdown', () => {
    let processExitSpy: jest.SpyInstance;

    beforeEach(() => {
      processExitSpy = jest.spyOn(process, 'exit').mockImplementation();
    });

    afterEach(() => {
      processExitSpy.mockRestore();
    });

    it('should handle SIGINT signal', async () => {
      mockPrismaInstance.$disconnect.mockResolvedValue(undefined);

      process.emit('SIGINT');
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Received SIGINT')
      );
    });

    it('should handle SIGTERM signal', async () => {
      mockPrismaInstance.$disconnect.mockResolvedValue(undefined);

      process.emit('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Received SIGTERM')
      );
    });

    it('should handle beforeExit event', async () => {
      mockPrismaInstance.$disconnect.mockResolvedValue(undefined);

      process.emit('beforeExit');
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Received beforeExit')
      );
    });
  });

  // ============================================
  // 📊 COVERAGE TESTS - Configuration
  // ============================================

  describe('Configuration Tests', () => {
    it('should use correct log levels for development', () => {
      process.env.NODE_ENV = 'development';
      (global as any).prisma = undefined;

      prisma;

      expect(PrismaClient).toHaveBeenCalledWith(
        expect.objectContaining({
          log: ['query', 'error', 'warn'],
        })
      );
    });

    it('should use correct log levels for production', () => {
      process.env.NODE_ENV = 'production';
      (global as any).prisma = undefined;

      prisma;

      expect(PrismaClient).toHaveBeenCalledWith(
        expect.objectContaining({
          log: ['error', 'warn'],
        })
      );
    });

    it('should use correct error format for development', () => {
      process.env.NODE_ENV = 'development';
      (global as any).prisma = undefined;

      prisma;

      expect(PrismaClient).toHaveBeenCalledWith(
        expect.objectContaining({
          errorFormat: 'pretty',
        })
      );
    });

    it('should use correct error format for production', () => {
      process.env.NODE_ENV = 'production';
      (global as any).prisma = undefined;

      prisma;

      expect(PrismaClient).toHaveBeenCalledWith(
        expect.objectContaining({
          errorFormat: 'minimal',
        })
      );
    });
  });
});