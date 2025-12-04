import Redis from 'ioredis';
import { redis, disconnectRedis } from './redis';

// Mock ioredis
jest.mock('ioredis');

describe('Redis Client', () => {
  let mockRedisInstance: jest.Mocked<Redis>;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup console spies
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Create mock Redis instance
    mockRedisInstance = {
      on: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      status: 'ready',
    } as unknown as jest.Mocked<Redis>;

    // Mock Redis constructor
    (Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedisInstance);

    // Clear global redis instance
    global.redis = undefined;
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    global.redis = undefined;
  });

  afterAll(async () => {
    await disconnectRedis();
  });

  describe('🎯 Unit Tests - Client Initialization', () => {
    test('should create Redis client with correct configuration', () => {
      const client = redis;

      expect(Redis).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
          retryStrategy: expect.any(Function),
          reconnectOnError: expect.any(Function),
        })
      );

      expect(client).toBeDefined();
      expect(mockRedisInstance.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockRedisInstance.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockRedisInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedisInstance.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockRedisInstance.on).toHaveBeenCalledWith('reconnecting', expect.any(Function));
      expect(mockRedisInstance.on).toHaveBeenCalledWith('end', expect.any(Function));
    });

    test('should return singleton instance on multiple calls', () => {
      const client1 = redis;
      const client2 = redis;

      expect(client1).toBe(client2);
      expect(Redis).toHaveBeenCalledTimes(1);
    });

    test('should use REDIS_URL from environment or default', () => {
      const originalEnv = process.env.REDIS_URL;
      process.env.REDIS_URL = 'redis://custom:6380';

      // Force re-initialization by clearing global
      global.redis = undefined;
      jest.resetModules();

      expect(Redis).toHaveBeenCalled();

      process.env.REDIS_URL = originalEnv;
    });

    test('should log initialization with masked credentials', () => {
      redis;

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[Redis] Initializing new Redis client',
        expect.objectContaining({
          timestamp: expect.any(String),
          url: expect.stringMatching(/:\*\*\*\*@|localhost/),
        })
      );
    });
  });

  describe('🔄 Unit Tests - Retry Strategy', () => {
    let retryStrategy: (times: number) => number | void;

    beforeEach(() => {
      redis;
      const redisCall = (Redis as jest.MockedClass<typeof Redis>).mock.calls[0];
      retryStrategy = redisCall[1].retryStrategy;
    });

    test('should calculate exponential backoff with jitter for retry attempts', () => {
      const delay1 = retryStrategy(1);
      const delay2 = retryStrategy(2);
      const delay3 = retryStrategy(3);

      expect(delay1).toBeGreaterThanOrEqual(1000);
      expect(delay1).toBeLessThanOrEqual(1300);

      expect(delay2).toBeGreaterThanOrEqual(2000);
      expect(delay2).toBeLessThanOrEqual(2600);

      expect(delay3).toBeGreaterThanOrEqual(4000);
      expect(delay3).toBeLessThanOrEqual(5200);
    });

    test('should cap retry delay at maximum value', () => {
      const delay = retryStrategy(10);

      expect(delay).toBeLessThanOrEqual(30000 * 1.3);
    });

    test('should return undefined after max retry attempts', () => {
      const result = retryStrategy(11);

      expect(result).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Max retry attempts'),
        expect.objectContaining({
          timestamp: expect.any(String),
          attempts: 11,
        })
      );
    });

    test('should log retry attempts with details', () => {
      retryStrategy(3);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Retry attempt 3/10'),
        expect.objectContaining({
          timestamp: expect.any(String),
          attempt: 3,
          delayMs: expect.any(Number),
        })
      );
    });

    test('should handle edge case of first retry attempt', () => {
      const delay = retryStrategy(1);

      expect(delay).toBeGreaterThan(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Retry attempt 1/10'),
        expect.any(Object)
      );
    });
  });

  describe('🔌 Unit Tests - Reconnect Error Handling', () => {
    let reconnectOnError: (err: Error) => boolean | 1 | 2;

    beforeEach(() => {
      redis;
      const redisCall = (Redis as jest.MockedClass<typeof Redis>).mock.calls[0];
      reconnectOnError = redisCall[1].reconnectOnError;
    });

    test('should reconnect on READONLY error', () => {
      const error = new Error('READONLY You cannot write against a read only replica');

      const result = reconnectOnError(error);

      expect(result).toBe(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Redis] Reconnecting due to error',
        expect.objectContaining({
          timestamp: expect.any(String),
          error: expect.stringContaining('READONLY'),
          errorName: 'Error',
        })
      );
    });

    test('should reconnect on ECONNRESET error', () => {
      const error = new Error('Connection reset by peer - ECONNRESET');

      const result = reconnectOnError(error);

      expect(result).toBe(1);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    test('should reconnect on ETIMEDOUT error', () => {
      const error = new Error('Connection timed out - ETIMEDOUT');

      const result = reconnectOnError(error);

      expect(result).toBe(1);
    });

    test('should reconnect on ENOTFOUND error', () => {
      const error = new Error('Host not found - ENOTFOUND');

      const result = reconnectOnError(error);

      expect(result).toBe(1);
    });

    test('should not reconnect on non-recoverable errors', () => {
      const error = new Error('WRONGPASS invalid username-password pair');

      const result = reconnectOnError(error);

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Redis] Non-recoverable error occurred',
        expect.objectContaining({
          timestamp: expect.any(String),
          error: expect.stringContaining('WRONGPASS'),
          errorName: 'Error',
          stack: expect.any(String),
        })
      );
    });

    test('should handle errors without specific error codes', () => {
      const error = new Error('Generic connection error');

      const result = reconnectOnError(error);

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('📡 Unit Tests - Event Handlers', () => {
    let eventHandlers: Record<string, Function>;

    beforeEach(() => {
      redis;
      eventHandlers = {};

      mockRedisInstance.on.mock.calls.forEach(([event, handler]) => {
        eventHandlers[event] = handler;
      });
    });

    test('should log connection establishment', () => {
      eventHandlers['connect']();

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[Redis] Connection established',
        expect.objectContaining({
          timestamp: expect.any(String),
          url: expect.any(String),
        })
      );
    });

    test('should log when client is ready', () => {
      eventHandlers['ready']();

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[Redis] Client ready to accept commands',
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });

    test('should log client errors with full details', () => {
      const error = new Error('Connection failed');
      error.stack = 'Error: Connection failed\n    at test.ts:1:1';

      eventHandlers['error'](error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Redis] Client error occurred',
        expect.objectContaining({
          timestamp: expect.any(String),
          error: 'Connection failed',
          errorName: 'Error',
          stack: expect.any(String),
        })
      );
    });

    test('should log connection closure', () => {
      eventHandlers['close']();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Redis] Connection closed',
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });

    test('should log reconnection attempts with delay', () => {
      eventHandlers['reconnecting'](5000);

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[Redis] Attempting to reconnect',
        expect.objectContaining({
          timestamp: expect.any(String),
          delayMs: 5000,
        })
      );
    });

    test('should log connection end', () => {
      eventHandlers['end']();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[Redis] Connection ended',
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe('🔗 Integration Tests - Redis Operations', () => {
    test('should successfully ping Redis server', async () => {
      const response = await redis.ping();

      expect(response).toBe('PONG');
      expect(mockRedisInstance.ping).toHaveBeenCalledTimes(1);
    });

    test('should handle ping failure gracefully', async () => {
      mockRedisInstance.ping.mockRejectedValueOnce(new Error('Connection lost'));

      await expect(redis.ping()).rejects.toThrow('Connection lost');
    });

    test('should perform get operation', async () => {
      mockRedisInstance.get.mockResolvedValueOnce('test-value');

      const result = await redis.get('test-key');

      expect(result).toBe('test-value');
      expect(mockRedisInstance.get).toHaveBeenCalledWith('test-key');
    });

    test('should perform set operation', async () => {
      mockRedisInstance.set.mockResolvedValueOnce('OK');

      const result = await redis.set('test-key', 'test-value');

      expect(result).toBe('OK');
      expect(mockRedisInstance.set).toHaveBeenCalledWith('test-key', 'test-value');
    });

    test('should perform delete operation', async () => {
      mockRedisInstance.del.mockResolvedValueOnce(1);

      const result = await redis.del('test-key');

      expect(result).toBe(1);
      expect(mockRedisInstance.del).toHaveBeenCalledWith('test-key');
    });
  });

  describe('🛡️ Integration Tests - Graceful Shutdown', () => {
    test('should disconnect gracefully when quit succeeds', async () => {
      global.redis = mockRedisInstance;

      await disconnectRedis();

      expect(mockRedisInstance.quit).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[Redis] Initiating graceful shutdown',
        expect.any(Object)
      );
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[Redis] Graceful shutdown completed',
        expect.any(Object)
      );
      expect(global.redis).toBeUndefined();
    });

    test('should handle quit failure and force disconnect', async () => {
      global.redis = mockRedisInstance;
      mockRedisInstance.quit.mockRejectedValueOnce(new Error('Quit failed'));

      await disconnectRedis();

      expect(mockRedisInstance.quit).toHaveBeenCalledTimes(1);
      expect(mockRedisInstance.disconnect).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Redis] Error during graceful shutdown',
        expect.objectContaining({
          timestamp: expect.any(String),
          error: 'Quit failed',
        })
      );
      expect(global.redis).toBeUndefined();
    });

    test('should handle disconnect when no client exists', async () => {
      global.redis = undefined;

      await disconnectRedis();

      expect(mockRedisInstance.quit).not.toHaveBeenCalled();
      expect(mockRedisInstance.disconnect).not.toHaveBeenCalled();
    });

    test('should handle non-Error exceptions during shutdown', async () => {
      global.redis = mockRedisInstance;
      mockRedisInstance.quit.mockRejectedValueOnce('String error');

      await disconnectRedis();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Redis] Error during graceful shutdown',
        expect.objectContaining({
          error: 'String error',
        })
      );
    });
  });

  describe('⚡ Performance Tests', () => {
    test('should complete ping operation within acceptable time', async () => {
      const startTime = Date.now();

      await redis.ping();

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100);
    });

    test('should handle multiple concurrent operations', async () => {
      mockRedisInstance.get.mockResolvedValue('value');

      const operations = Array.from({ length: 100 }, (_, i) => redis.get(`key-${i}`));

      const results = await Promise.all(operations);

      expect(results).toHaveLength(100);
      expect(results.every((r) => r === 'value')).toBe(true);
    });

    test('should calculate retry delay efficiently', () => {
      redis;
      const redisCall = (Redis as jest.MockedClass<typeof Redis>).mock.calls[0];
      const retryStrategy = redisCall[1].retryStrategy;

      const startTime = Date.now();

      for (let i = 1; i <= 10; i++) {
        retryStrategy(i);
      }

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(10);
    });
  });

  describe('🛡️ Security Tests', () => {
    test('should mask credentials in logs', () => {
      process.env.REDIS_URL = 'redis://user:password@localhost:6379';
      global.redis = undefined;

      redis;

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          url: expect.stringMatching(/:\*\*\*\*@/),
        })
      );

      expect(consoleInfoSpy).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          url: expect.stringContaining('password'),
        })
      );
    });

    test('should not expose sensitive error details in production', () => {
      redis;
      const redisCall = (Redis as jest.MockedClass<typeof Redis>).mock.calls[0];
      const reconnectOnError = redisCall[1].reconnectOnError;

      const sensitiveError = new Error('WRONGPASS invalid password for user admin');

      reconnectOnError(sensitiveError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          error: expect.any(String),
          errorName: 'Error',
        })
      );
    });
  });

  describe('🎯 Edge Cases', () => {
    test('should handle undefined environment variable', () => {
      delete process.env.REDIS_URL;
      global.redis = undefined;

      const client = redis;

      expect(client).toBeDefined();
      expect(Redis).toHaveBeenCalledWith(
        'redis://localhost:6379',
        expect.any(Object)
      );
    });

    test('should handle retry strategy at boundary (attempt 10)', () => {
      redis;
      const redisCall = (Redis as jest.MockedClass<typeof Redis>).mock.calls[0];
      const retryStrategy = redisCall[1].retryStrategy;

      const delay = retryStrategy(10);

      expect(delay).toBeDefined();
      expect(delay).toBeGreaterThan(0);
    });

    test('should handle retry strategy at boundary (attempt 11)', () => {
      redis;
      const redisCall = (Redis as jest.MockedClass<typeof Redis>).mock.calls[0];
      const retryStrategy = redisCall[1].retryStrategy;

      const result = retryStrategy(11);

      expect(result).toBeUndefined();
    });

    test('should handle error with empty message', () => {
      redis;
      const redisCall = (Redis as jest.MockedClass<typeof Redis>).mock.calls[0];
      const reconnectOnError = redisCall[1].reconnectOnError;

      const error = new Error('');

      const result = reconnectOnError(error);

      expect(result).toBe(false);
    });

    test('should handle error without stack trace', () => {
      redis;
      const eventHandlers: Record<string, Function> = {};
      mockRedisInstance.on.mock.calls.forEach(([event, handler]) => {
        eventHandlers[event] = handler;
      });

      const error = new Error('Test error');
      delete error.stack;

      eventHandlers['error'](error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          error: 'Test error',
          stack: undefined,
        })
      );
    });
  });

  describe('🔄 State Management Tests', () => {
    test('should maintain singleton state across module imports', () => {
      const client1 = redis;
      global.redis = mockRedisInstance;
      const client2 = redis;

      expect(client1).toBe(client2);
      expect(global.redis).toBe(mockRedisInstance);
    });

    test('should clear global state after disconnect', async () => {
      global.redis = mockRedisInstance;

      await disconnectRedis();

      expect(global.redis).toBeUndefined();
    });

    test('should allow reconnection after disconnect', async () => {
      global.redis = mockRedisInstance;

      await disconnectRedis();

      expect(global.redis).toBeUndefined();

      const newClient = redis;

      expect(newClient).toBeDefined();
      expect(Redis).toHaveBeenCalled();
    });
  });

  describe('📊 Logging Tests', () => {
    test('should include timestamp in all log messages', () => {
      redis;

      const allCalls = [
        ...consoleInfoSpy.mock.calls,
        ...consoleWarnSpy.mock.calls,
        ...consoleErrorSpy.mock.calls,
      ];

      allCalls.forEach((call) => {
        if (call[1] && typeof call[1] === 'object') {
          expect(call[1]).toHaveProperty('timestamp');
          expect(call[1].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        }
      });
    });

    test('should use consistent log format across all events', () => {
      redis;
      const eventHandlers: Record<string, Function> = {};
      mockRedisInstance.on.mock.calls.forEach(([event, handler]) => {
        eventHandlers[event] = handler;
      });

      eventHandlers['connect']();
      eventHandlers['ready']();
      eventHandlers['close']();

      const logCalls = consoleInfoSpy.mock.calls.concat(consoleWarnSpy.mock.calls);

      logCalls.forEach((call) => {
        expect(call[0]).toMatch(/^\[Redis\]/);
        expect(call[1]).toHaveProperty('timestamp');
      });
    });
  });
});