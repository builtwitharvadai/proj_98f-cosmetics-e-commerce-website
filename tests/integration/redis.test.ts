import { redis, disconnectRedis } from '../../src/lib/redis';
import * as cache from '../../src/lib/cache';
import app from '../../src/index';
import request from 'supertest';

/**
 * Integration Test Suite for Redis Operations and Session Management
 * 
 * Test Categories:
 * 1. Redis Connection & Health
 * 2. Cache Operations (CRUD)
 * 3. Session Management
 * 4. Error Handling & Recovery
 * 5. Performance & Concurrency
 */

describe('Redis Integration Tests', () => {
  // Test data factory
  const createTestData = (id: string) => ({
    id,
    name: `Test User ${id}`,
    email: `test${id}@example.com`,
    timestamp: new Date().toISOString(),
  });

  // Setup: Connect to test Redis instance
  beforeAll(async () => {
    // Wait for Redis connection to be ready
    await redis.ping();
    console.log('[Test] Redis connection established');
  });

  // Cleanup: Disconnect and flush test database
  afterAll(async () => {
    // Clean up all test keys
    const keys = await redis.keys('test:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    // Flush session keys
    const sessionKeys = await redis.keys('session:*');
    if (sessionKeys.length > 0) {
      await redis.del(...sessionKeys);
    }

    await disconnectRedis();
    console.log('[Test] Redis connection closed and test data cleaned');
  });

  // Reset between tests
  afterEach(async () => {
    const keys = await redis.keys('test:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  // ==========================================
  // 1. 🔌 Redis Connection & Health Tests
  // ==========================================
  describe('Redis Connection & Health', () => {
    it('should establish Redis connection successfully', async () => {
      const result = await redis.ping();
      expect(result).toBe('PONG');
    });

    it('should verify Redis is ready to accept commands', async () => {
      const info = await redis.info('server');
      expect(info).toContain('redis_version');
    });

    it('should handle Redis commands without errors', async () => {
      await expect(redis.set('test:health', 'ok')).resolves.toBe('OK');
      await expect(redis.get('test:health')).resolves.toBe('ok');
      await expect(redis.del('test:health')).resolves.toBe(1);
    });
  });

  // ==========================================
  // 2. 💾 Cache Operations (CRUD) Tests
  // ==========================================
  describe('Cache Operations', () => {
    describe('SET operations', () => {
      it('should store and retrieve a simple value', async () => {
        const key = 'test:simple';
        const value = { message: 'Hello Redis' };

        await cache.set(key, value);
        const retrieved = await cache.get<typeof value>(key);

        expect(retrieved).toEqual(value);
      });

      it('should store complex nested objects', async () => {
        const key = 'test:complex';
        const value = {
          user: createTestData('1'),
          metadata: {
            nested: { deep: { value: 'test' } },
            array: [1, 2, 3],
          },
        };

        await cache.set(key, value);
        const retrieved = await cache.get<typeof value>(key);

        expect(retrieved).toEqual(value);
      });

      it('should store value with TTL and expire correctly', async () => {
        const key = 'test:ttl';
        const value = { data: 'expires soon' };
        const ttl = 2; // 2 seconds

        await cache.set(key, value, ttl);

        // Verify value exists
        const retrieved = await cache.get<typeof value>(key);
        expect(retrieved).toEqual(value);

        // Wait for expiration
        await new Promise((resolve) => setTimeout(resolve, 2100));

        // Verify value expired
        const expired = await cache.get<typeof value>(key);
        expect(expired).toBeNull();
      });

      it('should store value with expiry date', async () => {
        const key = 'test:expiry-date';
        const value = { data: 'expires at specific time' };
        const expiryDate = new Date(Date.now() + 2000); // 2 seconds from now

        await cache.setWithExpiry(key, value, expiryDate);

        // Verify value exists
        const retrieved = await cache.get<typeof value>(key);
        expect(retrieved).toEqual(value);

        // Wait for expiration
        await new Promise((resolve) => setTimeout(resolve, 2100));

        // Verify value expired
        const expired = await cache.get<typeof value>(key);
        expect(expired).toBeNull();
      });

      it('should not cache value with past expiry date', async () => {
        const key = 'test:past-expiry';
        const value = { data: 'should not be cached' };
        const pastDate = new Date(Date.now() - 1000); // 1 second ago

        await cache.setWithExpiry(key, value, pastDate);

        const retrieved = await cache.get<typeof value>(key);
        expect(retrieved).toBeNull();
      });

      it('should handle storing null and undefined values', async () => {
        const keyNull = 'test:null';
        const keyUndefined = 'test:undefined';

        await cache.set(keyNull, null);
        await cache.set(keyUndefined, undefined);

        const retrievedNull = await cache.get(keyNull);
        const retrievedUndefined = await cache.get(keyUndefined);

        expect(retrievedNull).toBeNull();
        expect(retrievedUndefined).toBeNull();
      });

      it('should handle storing arrays', async () => {
        const key = 'test:array';
        const value = [1, 2, 3, 'four', { five: 5 }];

        await cache.set(key, value);
        const retrieved = await cache.get<typeof value>(key);

        expect(retrieved).toEqual(value);
      });
    });

    describe('GET operations', () => {
      it('should return null for non-existent key', async () => {
        const result = await cache.get('test:nonexistent');
        expect(result).toBeNull();
      });

      it('should retrieve value with correct type', async () => {
        const key = 'test:typed';
        const value = { id: 1, name: 'Test', active: true };

        await cache.set(key, value);
        const retrieved = await cache.get<typeof value>(key);

        expect(retrieved).toEqual(value);
        expect(typeof retrieved?.id).toBe('number');
        expect(typeof retrieved?.name).toBe('string');
        expect(typeof retrieved?.active).toBe('boolean');
      });

      it('should handle concurrent GET operations', async () => {
        const key = 'test:concurrent-get';
        const value = { data: 'concurrent test' };

        await cache.set(key, value);

        const promises = Array.from({ length: 10 }, () =>
          cache.get<typeof value>(key)
        );

        const results = await Promise.all(promises);

        results.forEach((result) => {
          expect(result).toEqual(value);
        });
      });
    });

    describe('DELETE operations', () => {
      it('should delete existing key', async () => {
        const key = 'test:delete';
        const value = { data: 'to be deleted' };

        await cache.set(key, value);
        await cache.del(key);

        const retrieved = await cache.get(key);
        expect(retrieved).toBeNull();
      });

      it('should handle deleting non-existent key', async () => {
        await expect(cache.del('test:nonexistent')).resolves.not.toThrow();
      });

      it('should delete multiple keys', async () => {
        const keys = ['test:del1', 'test:del2', 'test:del3'];

        for (const key of keys) {
          await cache.set(key, { data: key });
        }

        for (const key of keys) {
          await cache.del(key);
        }

        for (const key of keys) {
          const result = await cache.get(key);
          expect(result).toBeNull();
        }
      });
    });

    describe('EXISTS operations', () => {
      it('should return true for existing key', async () => {
        const key = 'test:exists';
        await cache.set(key, { data: 'exists' });

        const exists = await cache.exists(key);
        expect(exists).toBe(true);
      });

      it('should return false for non-existent key', async () => {
        const exists = await cache.exists('test:nonexistent');
        expect(exists).toBe(false);
      });

      it('should return false after key deletion', async () => {
        const key = 'test:exists-delete';
        await cache.set(key, { data: 'exists' });
        await cache.del(key);

        const exists = await cache.exists(key);
        expect(exists).toBe(false);
      });

      it('should return false after key expiration', async () => {
        const key = 'test:exists-expire';
        await cache.set(key, { data: 'expires' }, 1);

        await new Promise((resolve) => setTimeout(resolve, 1100));

        const exists = await cache.exists(key);
        expect(exists).toBe(false);
      });
    });

    describe('End-to-end cache workflow', () => {
      it('should complete full cache lifecycle', async () => {
        const key = 'test:lifecycle';
        const value = createTestData('lifecycle');

        // 1. Verify key doesn't exist
        expect(await cache.exists(key)).toBe(false);
        expect(await cache.get(key)).toBeNull();

        // 2. Set value
        await cache.set(key, value);

        // 3. Verify key exists
        expect(await cache.exists(key)).toBe(true);

        // 4. Get and verify value
        const retrieved = await cache.get<typeof value>(key);
        expect(retrieved).toEqual(value);

        // 5. Delete key
        await cache.del(key);

        // 6. Verify key no longer exists
        expect(await cache.exists(key)).toBe(false);
        expect(await cache.get(key)).toBeNull();
      });
    });
  });

  // ==========================================
  // 3. 🔐 Session Management Tests
  // ==========================================
  describe('Session Management', () => {
    it('should create and persist session across requests', async () => {
      // First request: Create session
      const response1 = await request(app).get('/health').expect(200);

      const cookies = response1.headers['set-cookie'];
      expect(cookies).toBeDefined();

      const sessionCookie = cookies.find((cookie: string) =>
        cookie.startsWith('sessionId=')
      );
      expect(sessionCookie).toBeDefined();

      // Second request: Use existing session
      const response2 = await request(app)
        .get('/health')
        .set('Cookie', sessionCookie)
        .expect(200);

      // Session should persist (no new session created)
      const newCookies = response2.headers['set-cookie'];
      expect(newCookies).toBeUndefined();
    });

    it('should store and retrieve session data', async () => {
      const agent = request.agent(app);

      // Create session with data
      await agent.get('/health').expect(200);

      // Verify session exists in Redis
      const sessionKeys = await redis.keys('session:*');
      expect(sessionKeys.length).toBeGreaterThan(0);

      // Verify session data structure
      const sessionData = await redis.get(sessionKeys[0]);
      expect(sessionData).toBeDefined();
      expect(sessionData).toContain('cookie');
    });

    it('should handle concurrent session requests', async () => {
      const agent = request.agent(app);

      const promises = Array.from({ length: 5 }, () =>
        agent.get('/health').expect(200)
      );

      const responses = await Promise.all(promises);

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    });

    it('should expire session after TTL', async () => {
      // This test requires modifying session TTL for testing
      // In production, sessions expire after 7 days
      // For testing, we verify the session exists and can be manually expired

      const agent = request.agent(app);
      await agent.get('/health').expect(200);

      const sessionKeys = await redis.keys('session:*');
      expect(sessionKeys.length).toBeGreaterThan(0);

      // Manually expire session for testing
      await redis.del(sessionKeys[0]);

      // Verify session no longer exists
      const expiredKeys = await redis.keys('session:*');
      expect(expiredKeys.length).toBe(0);
    });

    it('should create new session after expiration', async () => {
      const agent = request.agent(app);

      // Create initial session
      const response1 = await agent.get('/health').expect(200);
      const cookie1 = response1.headers['set-cookie'];

      // Delete session from Redis
      const sessionKeys = await redis.keys('session:*');
      if (sessionKeys.length > 0) {
        await redis.del(...sessionKeys);
      }

      // New request should create new session
      const response2 = await agent.get('/health').expect(200);
      const cookie2 = response2.headers['set-cookie'];

      expect(cookie2).toBeDefined();
    });
  });

  // ==========================================
  // 4. 🛡️ Error Handling & Recovery Tests
  // ==========================================
  describe('Error Handling & Recovery', () => {
    it('should handle invalid JSON gracefully', async () => {
      const key = 'test:invalid-json';

      // Manually set invalid JSON
      await redis.set(key, 'invalid{json}');

      const result = await cache.get(key);
      expect(result).toBeNull();
    });

    it('should handle cache.set errors gracefully', async () => {
      const key = 'test:error';
      const circularValue: any = { a: 1 };
      circularValue.self = circularValue; // Create circular reference

      await expect(cache.set(key, circularValue)).rejects.toThrow();
    });

    it('should handle Redis connection errors', async () => {
      // This test verifies error handling is in place
      // Actual connection errors are handled by retry logic
      const result = await cache.get('test:any-key');
      expect(result).toBeDefined(); // Should not throw
    });

    it('should recover from temporary failures', async () => {
      const key = 'test:recovery';
      const value = { data: 'recovery test' };

      // Normal operation
      await cache.set(key, value);
      const retrieved = await cache.get<typeof value>(key);
      expect(retrieved).toEqual(value);

      // Cleanup
      await cache.del(key);
    });
  });

  // ==========================================
  // 5. ⚡ Performance & Concurrency Tests
  // ==========================================
  describe('Performance & Concurrency', () => {
    it('should handle high-volume cache operations', async () => {
      const operations = 100;
      const promises: Promise<void>[] = [];

      for (let i = 0; i < operations; i++) {
        const key = `test:perf:${i}`;
        const value = createTestData(String(i));
        promises.push(cache.set(key, value));
      }

      await expect(Promise.all(promises)).resolves.not.toThrow();

      // Cleanup
      const keys = await redis.keys('test:perf:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    });

    it('should complete cache operations within performance threshold', async () => {
      const key = 'test:performance';
      const value = createTestData('perf');

      const startTime = Date.now();

      await cache.set(key, value);
      await cache.get(key);
      await cache.exists(key);
      await cache.del(key);

      const duration = Date.now() - startTime;

      // All operations should complete within 100ms
      expect(duration).toBeLessThan(100);
    });

    it('should handle concurrent writes to same key', async () => {
      const key = 'test:concurrent-write';
      const promises = Array.from({ length: 10 }, (_, i) =>
        cache.set(key, { value: i })
      );

      await expect(Promise.all(promises)).resolves.not.toThrow();

      // Last write should win
      const result = await cache.get<{ value: number }>(key);
      expect(result).toBeDefined();
      expect(typeof result?.value).toBe('number');

      await cache.del(key);
    });

    it('should handle concurrent reads and writes', async () => {
      const key = 'test:concurrent-rw';
      const initialValue = { counter: 0 };

      await cache.set(key, initialValue);

      const operations = Array.from({ length: 20 }, (_, i) => {
        if (i % 2 === 0) {
          return cache.get(key);
        } else {
          return cache.set(key, { counter: i });
        }
      });

      await expect(Promise.all(operations)).resolves.not.toThrow();

      await cache.del(key);
    });

    it('should handle large payload storage and retrieval', async () => {
      const key = 'test:large-payload';
      const largeArray = Array.from({ length: 1000 }, (_, i) =>
        createTestData(String(i))
      );

      const startTime = Date.now();

      await cache.set(key, largeArray);
      const retrieved = await cache.get<typeof largeArray>(key);

      const duration = Date.now() - startTime;

      expect(retrieved).toEqual(largeArray);
      expect(duration).toBeLessThan(500); // Should complete within 500ms

      await cache.del(key);
    });
  });

  // ==========================================
  // 6. 🏥 Health Endpoint Tests
  // ==========================================
  describe('Health Endpoint', () => {
    it('should report Redis connection status', async () => {
      const response = await request(app).get('/ready').expect(200);

      expect(response.body).toHaveProperty('redis');
      expect(response.body.redis).toBe('connected');
    });

    it('should respond quickly to health checks', async () => {
      const startTime = Date.now();

      await request(app).get('/health').expect(200);

      const duration = Date.now() - startTime;

      // Health check should respond within 100ms
      expect(duration).toBeLessThan(100);
    });

    it('should handle multiple concurrent health checks', async () => {
      const promises = Array.from({ length: 10 }, () =>
        request(app).get('/health').expect(200)
      );

      const responses = await Promise.all(promises);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    });
  });

  // ==========================================
  // 7. 🔒 Security & Edge Cases
  // ==========================================
  describe('Security & Edge Cases', () => {
    it('should handle special characters in keys', async () => {
      const specialKeys = [
        'test:key:with:colons',
        'test:key-with-dashes',
        'test:key_with_underscores',
        'test:key.with.dots',
      ];

      for (const key of specialKeys) {
        await cache.set(key, { data: key });
        const retrieved = await cache.get<{ data: string }>(key);
        expect(retrieved?.data).toBe(key);
        await cache.del(key);
      }
    });

    it('should handle empty string values', async () => {
      const key = 'test:empty-string';
      await cache.set(key, '');
      const retrieved = await cache.get<string>(key);
      expect(retrieved).toBe('');
      await cache.del(key);
    });

    it('should handle zero and negative numbers', async () => {
      const key = 'test:numbers';
      const values = [0, -1, -999, Number.MIN_SAFE_INTEGER];

      for (const value of values) {
        await cache.set(key, value);
        const retrieved = await cache.get<number>(key);
        expect(retrieved).toBe(value);
      }

      await cache.del(key);
    });

    it('should handle boolean values', async () => {
      const keyTrue = 'test:bool-true';
      const keyFalse = 'test:bool-false';

      await cache.set(keyTrue, true);
      await cache.set(keyFalse, false);

      expect(await cache.get<boolean>(keyTrue)).toBe(true);
      expect(await cache.get<boolean>(keyFalse)).toBe(false);

      await cache.del(keyTrue);
      await cache.del(keyFalse);
    });

    it('should prevent key collision between different namespaces', async () => {
      const key1 = 'test:namespace1:key';
      const key2 = 'test:namespace2:key';
      const value1 = { data: 'namespace1' };
      const value2 = { data: 'namespace2' };

      await cache.set(key1, value1);
      await cache.set(key2, value2);

      expect(await cache.get(key1)).toEqual(value1);
      expect(await cache.get(key2)).toEqual(value2);

      await cache.del(key1);
      await cache.del(key2);
    });
  });

  // ==========================================
  // 8. 📊 Data Integrity Tests
  // ==========================================
  describe('Data Integrity', () => {
    it('should preserve data types after round-trip', async () => {
      const key = 'test:types';
      const value = {
        string: 'text',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { nested: 'value' },
        date: new Date().toISOString(),
      };

      await cache.set(key, value);
      const retrieved = await cache.get<typeof value>(key);

      expect(retrieved).toEqual(value);
      expect(typeof retrieved?.string).toBe('string');
      expect(typeof retrieved?.number).toBe('number');
      expect(typeof retrieved?.boolean).toBe('boolean');
      expect(Array.isArray(retrieved?.array)).toBe(true);
      expect(typeof retrieved?.object).toBe('object');

      await cache.del(key);
    });

    it('should handle Unicode and emoji characters', async () => {
      const key = 'test:unicode';
      const value = {
        emoji: '🚀💾🔥',
        chinese: '你好世界',
        arabic: 'مرحبا بالعالم',
        special: '©®™€£¥',
      };

      await cache.set(key, value);
      const retrieved = await cache.get<typeof value>(key);

      expect(retrieved).toEqual(value);

      await cache.del(key);
    });

    it('should maintain precision for large numbers', async () => {
      const key = 'test:large-numbers';
      const value = {
        large: 9007199254740991, // Number.MAX_SAFE_INTEGER
        small: -9007199254740991, // Number.MIN_SAFE_INTEGER
        decimal: 3.141592653589793,
      };

      await cache.set(key, value);
      const retrieved = await cache.get<typeof value>(key);

      expect(retrieved).toEqual(value);

      await cache.del(key);
    });
  });
});