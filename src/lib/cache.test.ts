import * as cache from './cache';
import { redis } from './redis';

// Mock the Redis client
jest.mock('./redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  },
}));

describe('Cache Utilities', () => {
  // Type-safe mock helpers
  const mockRedis = redis as jest.Mocked<typeof redis>;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    // Reset console methods to avoid noise
    jest.spyOn(console, 'debug').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    // Restore console methods
    jest.restoreAllMocks();
  });

  describe('get<T>', () => {
    describe('✅ Happy Path', () => {
      it('should retrieve and parse cached string value', async () => {
        // Arrange
        const key = 'test:string';
        const value = 'Hello, World!';
        mockRedis.get.mockResolvedValue(JSON.stringify(value));

        // Act
        const result = await cache.get<string>(key);

        // Assert
        expect(result).toBe(value);
        expect(mockRedis.get).toHaveBeenCalledWith(key);
        expect(mockRedis.get).toHaveBeenCalledTimes(1);
        expect(console.debug).toHaveBeenCalledWith(
          '[Cache] Cache hit',
          expect.objectContaining({ key })
        );
      });

      it('should retrieve and parse cached object value', async () => {
        // Arrange
        const key = 'test:object';
        const value = { id: 1, name: 'Test User', email: 'test@example.com' };
        mockRedis.get.mockResolvedValue(JSON.stringify(value));

        // Act
        const result = await cache.get<typeof value>(key);

        // Assert
        expect(result).toEqual(value);
        expect(mockRedis.get).toHaveBeenCalledWith(key);
      });

      it('should retrieve and parse cached array value', async () => {
        // Arrange
        const key = 'test:array';
        const value = [1, 2, 3, 4, 5];
        mockRedis.get.mockResolvedValue(JSON.stringify(value));

        // Act
        const result = await cache.get<number[]>(key);

        // Assert
        expect(result).toEqual(value);
        expect(result).toHaveLength(5);
      });

      it('should retrieve and parse cached boolean value', async () => {
        // Arrange
        const key = 'test:boolean';
        const value = true;
        mockRedis.get.mockResolvedValue(JSON.stringify(value));

        // Act
        const result = await cache.get<boolean>(key);

        // Assert
        expect(result).toBe(true);
      });

      it('should retrieve and parse cached number value', async () => {
        // Arrange
        const key = 'test:number';
        const value = 42;
        mockRedis.get.mockResolvedValue(JSON.stringify(value));

        // Act
        const result = await cache.get<number>(key);

        // Assert
        expect(result).toBe(42);
      });

      it('should retrieve and parse nested object structures', async () => {
        // Arrange
        const key = 'test:nested';
        const value = {
          user: {
            id: 1,
            profile: {
              name: 'John Doe',
              settings: {
                theme: 'dark',
                notifications: true,
              },
            },
          },
        };
        mockRedis.get.mockResolvedValue(JSON.stringify(value));

        // Act
        const result = await cache.get<typeof value>(key);

        // Assert
        expect(result).toEqual(value);
        expect(result?.user.profile.settings.theme).toBe('dark');
      });
    });

    describe('🔍 Edge Cases', () => {
      it('should return null for non-existent key', async () => {
        // Arrange
        const key = 'test:nonexistent';
        mockRedis.get.mockResolvedValue(null);

        // Act
        const result = await cache.get<string>(key);

        // Assert
        expect(result).toBeNull();
        expect(console.debug).toHaveBeenCalledWith(
          '[Cache] Cache miss',
          expect.objectContaining({ key })
        );
      });

      it('should handle empty string key', async () => {
        // Arrange
        const key = '';
        mockRedis.get.mockResolvedValue(null);

        // Act
        const result = await cache.get<string>(key);

        // Assert
        expect(result).toBeNull();
        expect(mockRedis.get).toHaveBeenCalledWith('');
      });

      it('should handle special characters in key', async () => {
        // Arrange
        const key = 'test:key:with:colons:and-dashes_underscores';
        const value = 'special';
        mockRedis.get.mockResolvedValue(JSON.stringify(value));

        // Act
        const result = await cache.get<string>(key);

        // Assert
        expect(result).toBe(value);
      });

      it('should handle null value stored in cache', async () => {
        // Arrange
        const key = 'test:null';
        mockRedis.get.mockResolvedValue(JSON.stringify(null));

        // Act
        const result = await cache.get<null>(key);

        // Assert
        expect(result).toBeNull();
      });

      it('should handle undefined value stored in cache', async () => {
        // Arrange
        const key = 'test:undefined';
        mockRedis.get.mockResolvedValue(JSON.stringify(undefined));

        // Act
        const result = await cache.get<undefined>(key);

        // Assert
        expect(result).toBeUndefined();
      });
    });

    describe('❌ Error Handling', () => {
      it('should return null on JSON parse error', async () => {
        // Arrange
        const key = 'test:invalid';
        mockRedis.get.mockResolvedValue('invalid json {');

        // Act
        const result = await cache.get<string>(key);

        // Assert
        expect(result).toBeNull();
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error retrieving cached value',
          expect.objectContaining({
            key,
            error: expect.any(String),
          })
        );
      });

      it('should return null on Redis connection error', async () => {
        // Arrange
        const key = 'test:error';
        const error = new Error('Redis connection failed');
        mockRedis.get.mockRejectedValue(error);

        // Act
        const result = await cache.get<string>(key);

        // Assert
        expect(result).toBeNull();
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error retrieving cached value',
          expect.objectContaining({
            key,
            error: error.message,
            stack: expect.any(String),
          })
        );
      });

      it('should handle non-Error exceptions', async () => {
        // Arrange
        const key = 'test:string-error';
        mockRedis.get.mockRejectedValue('String error');

        // Act
        const result = await cache.get<string>(key);

        // Assert
        expect(result).toBeNull();
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error retrieving cached value',
          expect.objectContaining({
            key,
            error: 'String error',
          })
        );
      });

      it('should handle timeout errors gracefully', async () => {
        // Arrange
        const key = 'test:timeout';
        const error = new Error('Operation timed out');
        error.name = 'TimeoutError';
        mockRedis.get.mockRejectedValue(error);

        // Act
        const result = await cache.get<string>(key);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('🔒 Type Safety', () => {
      it('should maintain type safety for complex types', async () => {
        // Arrange
        interface User {
          id: number;
          name: string;
          email: string;
          roles: string[];
        }
        const key = 'test:user';
        const value: User = {
          id: 1,
          name: 'John',
          email: 'john@example.com',
          roles: ['admin', 'user'],
        };
        mockRedis.get.mockResolvedValue(JSON.stringify(value));

        // Act
        const result = await cache.get<User>(key);

        // Assert
        expect(result).toEqual(value);
        expect(result?.roles).toContain('admin');
      });
    });
  });

  describe('set<T>', () => {
    describe('✅ Happy Path', () => {
      it('should store string value without TTL', async () => {
        // Arrange
        const key = 'test:string';
        const value = 'Hello, World!';
        mockRedis.set.mockResolvedValue('OK');

        // Act
        await cache.set(key, value);

        // Assert
        expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(value));
        expect(mockRedis.setex).not.toHaveBeenCalled();
        expect(console.debug).toHaveBeenCalledWith(
          '[Cache] Value cached without TTL',
          expect.objectContaining({ key })
        );
      });

      it('should store object value without TTL', async () => {
        // Arrange
        const key = 'test:object';
        const value = { id: 1, name: 'Test' };
        mockRedis.set.mockResolvedValue('OK');

        // Act
        await cache.set(key, value);

        // Assert
        expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(value));
      });

      it('should store value with TTL', async () => {
        // Arrange
        const key = 'test:ttl';
        const value = 'temporary';
        const ttl = 3600;
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.set(key, value, ttl);

        // Assert
        expect(mockRedis.setex).toHaveBeenCalledWith(key, ttl, JSON.stringify(value));
        expect(mockRedis.set).not.toHaveBeenCalled();
        expect(console.debug).toHaveBeenCalledWith(
          '[Cache] Value cached with TTL',
          expect.objectContaining({ key, ttlSeconds: ttl })
        );
      });

      it('should store array value with TTL', async () => {
        // Arrange
        const key = 'test:array';
        const value = [1, 2, 3];
        const ttl = 60;
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.set(key, value, ttl);

        // Assert
        expect(mockRedis.setex).toHaveBeenCalledWith(key, ttl, JSON.stringify(value));
      });

      it('should store boolean value', async () => {
        // Arrange
        const key = 'test:boolean';
        const value = false;
        mockRedis.set.mockResolvedValue('OK');

        // Act
        await cache.set(key, value);

        // Assert
        expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(value));
      });

      it('should store number value', async () => {
        // Arrange
        const key = 'test:number';
        const value = 0;
        mockRedis.set.mockResolvedValue('OK');

        // Act
        await cache.set(key, value);

        // Assert
        expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(value));
      });

      it('should store complex nested structures', async () => {
        // Arrange
        const key = 'test:complex';
        const value = {
          users: [
            { id: 1, name: 'User 1' },
            { id: 2, name: 'User 2' },
          ],
          metadata: {
            total: 2,
            page: 1,
          },
        };
        mockRedis.set.mockResolvedValue('OK');

        // Act
        await cache.set(key, value);

        // Assert
        expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(value));
      });
    });

    describe('🔍 Edge Cases', () => {
      it('should handle zero TTL by storing without expiry', async () => {
        // Arrange
        const key = 'test:zero-ttl';
        const value = 'no expiry';
        mockRedis.set.mockResolvedValue('OK');

        // Act
        await cache.set(key, value, 0);

        // Assert
        expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(value));
        expect(mockRedis.setex).not.toHaveBeenCalled();
      });

      it('should handle negative TTL by storing without expiry', async () => {
        // Arrange
        const key = 'test:negative-ttl';
        const value = 'no expiry';
        mockRedis.set.mockResolvedValue('OK');

        // Act
        await cache.set(key, value, -100);

        // Assert
        expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(value));
        expect(mockRedis.setex).not.toHaveBeenCalled();
      });

      it('should handle undefined TTL', async () => {
        // Arrange
        const key = 'test:undefined-ttl';
        const value = 'no expiry';
        mockRedis.set.mockResolvedValue('OK');

        // Act
        await cache.set(key, value, undefined);

        // Assert
        expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(value));
      });

      it('should handle empty string value', async () => {
        // Arrange
        const key = 'test:empty';
        const value = '';
        mockRedis.set.mockResolvedValue('OK');

        // Act
        await cache.set(key, value);

        // Assert
        expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(value));
      });

      it('should handle null value', async () => {
        // Arrange
        const key = 'test:null';
        const value = null;
        mockRedis.set.mockResolvedValue('OK');

        // Act
        await cache.set(key, value);

        // Assert
        expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(value));
      });

      it('should handle very large TTL values', async () => {
        // Arrange
        const key = 'test:large-ttl';
        const value = 'long lived';
        const ttl = 31536000; // 1 year in seconds
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.set(key, value, ttl);

        // Assert
        expect(mockRedis.setex).toHaveBeenCalledWith(key, ttl, JSON.stringify(value));
      });
    });

    describe('❌ Error Handling', () => {
      it('should throw error on Redis set failure', async () => {
        // Arrange
        const key = 'test:error';
        const value = 'fail';
        const error = new Error('Redis set failed');
        mockRedis.set.mockRejectedValue(error);

        // Act & Assert
        await expect(cache.set(key, value)).rejects.toThrow(error);
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error storing cached value',
          expect.objectContaining({
            key,
            error: error.message,
            stack: expect.any(String),
          })
        );
      });

      it('should throw error on Redis setex failure', async () => {
        // Arrange
        const key = 'test:error';
        const value = 'fail';
        const ttl = 60;
        const error = new Error('Redis setex failed');
        mockRedis.setex.mockRejectedValue(error);

        // Act & Assert
        await expect(cache.set(key, value, ttl)).rejects.toThrow(error);
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error storing cached value',
          expect.objectContaining({
            key,
            ttlSeconds: ttl,
            error: error.message,
          })
        );
      });

      it('should handle non-Error exceptions', async () => {
        // Arrange
        const key = 'test:string-error';
        const value = 'fail';
        mockRedis.set.mockRejectedValue('String error');

        // Act & Assert
        await expect(cache.set(key, value)).rejects.toBe('String error');
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error storing cached value',
          expect.objectContaining({
            key,
            error: 'String error',
          })
        );
      });

      it('should handle circular reference in value', async () => {
        // Arrange
        const key = 'test:circular';
        const value: any = { name: 'test' };
        value.self = value; // Create circular reference

        // Act & Assert
        await expect(cache.set(key, value)).rejects.toThrow();
      });
    });

    describe('⚡ Performance', () => {
      it('should handle large objects efficiently', async () => {
        // Arrange
        const key = 'test:large';
        const value = {
          data: Array.from({ length: 1000 }, (_, i) => ({
            id: i,
            name: `Item ${i}`,
            description: 'A'.repeat(100),
          })),
        };
        mockRedis.set.mockResolvedValue('OK');

        // Act
        const startTime = Date.now();
        await cache.set(key, value);
        const duration = Date.now() - startTime;

        // Assert
        expect(duration).toBeLessThan(100); // Should complete in < 100ms
        expect(mockRedis.set).toHaveBeenCalled();
      });
    });
  });

  describe('del', () => {
    describe('✅ Happy Path', () => {
      it('should delete existing key', async () => {
        // Arrange
        const key = 'test:delete';
        mockRedis.del.mockResolvedValue(1);

        // Act
        await cache.del(key);

        // Assert
        expect(mockRedis.del).toHaveBeenCalledWith(key);
        expect(console.debug).toHaveBeenCalledWith(
          '[Cache] Cache key deleted',
          expect.objectContaining({ key, existed: true })
        );
      });

      it('should handle deletion of non-existent key', async () => {
        // Arrange
        const key = 'test:nonexistent';
        mockRedis.del.mockResolvedValue(0);

        // Act
        await cache.del(key);

        // Assert
        expect(mockRedis.del).toHaveBeenCalledWith(key);
        expect(console.debug).toHaveBeenCalledWith(
          '[Cache] Cache key deleted',
          expect.objectContaining({ key, existed: false })
        );
      });

      it('should delete multiple times idempotently', async () => {
        // Arrange
        const key = 'test:idempotent';
        mockRedis.del.mockResolvedValue(0);

        // Act
        await cache.del(key);
        await cache.del(key);
        await cache.del(key);

        // Assert
        expect(mockRedis.del).toHaveBeenCalledTimes(3);
      });
    });

    describe('🔍 Edge Cases', () => {
      it('should handle empty string key', async () => {
        // Arrange
        const key = '';
        mockRedis.del.mockResolvedValue(0);

        // Act
        await cache.del(key);

        // Assert
        expect(mockRedis.del).toHaveBeenCalledWith('');
      });

      it('should handle special characters in key', async () => {
        // Arrange
        const key = 'test:key:with:special:chars!@#$%';
        mockRedis.del.mockResolvedValue(1);

        // Act
        await cache.del(key);

        // Assert
        expect(mockRedis.del).toHaveBeenCalledWith(key);
      });
    });

    describe('❌ Error Handling', () => {
      it('should throw error on Redis del failure', async () => {
        // Arrange
        const key = 'test:error';
        const error = new Error('Redis del failed');
        mockRedis.del.mockRejectedValue(error);

        // Act & Assert
        await expect(cache.del(key)).rejects.toThrow(error);
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error deleting cached value',
          expect.objectContaining({
            key,
            error: error.message,
            stack: expect.any(String),
          })
        );
      });

      it('should handle non-Error exceptions', async () => {
        // Arrange
        const key = 'test:string-error';
        mockRedis.del.mockRejectedValue('String error');

        // Act & Assert
        await expect(cache.del(key)).rejects.toBe('String error');
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error deleting cached value',
          expect.objectContaining({
            key,
            error: 'String error',
          })
        );
      });
    });
  });

  describe('exists', () => {
    describe('✅ Happy Path', () => {
      it('should return true for existing key', async () => {
        // Arrange
        const key = 'test:exists';
        mockRedis.exists.mockResolvedValue(1);

        // Act
        const result = await cache.exists(key);

        // Assert
        expect(result).toBe(true);
        expect(mockRedis.exists).toHaveBeenCalledWith(key);
        expect(console.debug).toHaveBeenCalledWith(
          '[Cache] Cache key existence check',
          expect.objectContaining({ key, exists: true })
        );
      });

      it('should return false for non-existent key', async () => {
        // Arrange
        const key = 'test:nonexistent';
        mockRedis.exists.mockResolvedValue(0);

        // Act
        const result = await cache.exists(key);

        // Assert
        expect(result).toBe(false);
        expect(console.debug).toHaveBeenCalledWith(
          '[Cache] Cache key existence check',
          expect.objectContaining({ key, exists: false })
        );
      });

      it('should check existence multiple times', async () => {
        // Arrange
        const key = 'test:multiple';
        mockRedis.exists.mockResolvedValue(1);

        // Act
        const result1 = await cache.exists(key);
        const result2 = await cache.exists(key);

        // Assert
        expect(result1).toBe(true);
        expect(result2).toBe(true);
        expect(mockRedis.exists).toHaveBeenCalledTimes(2);
      });
    });

    describe('🔍 Edge Cases', () => {
      it('should handle empty string key', async () => {
        // Arrange
        const key = '';
        mockRedis.exists.mockResolvedValue(0);

        // Act
        const result = await cache.exists(key);

        // Assert
        expect(result).toBe(false);
        expect(mockRedis.exists).toHaveBeenCalledWith('');
      });

      it('should handle special characters in key', async () => {
        // Arrange
        const key = 'test:special:!@#$%^&*()';
        mockRedis.exists.mockResolvedValue(1);

        // Act
        const result = await cache.exists(key);

        // Assert
        expect(result).toBe(true);
      });
    });

    describe('❌ Error Handling', () => {
      it('should return false on Redis exists failure', async () => {
        // Arrange
        const key = 'test:error';
        const error = new Error('Redis exists failed');
        mockRedis.exists.mockRejectedValue(error);

        // Act
        const result = await cache.exists(key);

        // Assert
        expect(result).toBe(false);
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error checking cache key existence',
          expect.objectContaining({
            key,
            error: error.message,
            stack: expect.any(String),
          })
        );
      });

      it('should handle non-Error exceptions', async () => {
        // Arrange
        const key = 'test:string-error';
        mockRedis.exists.mockRejectedValue('String error');

        // Act
        const result = await cache.exists(key);

        // Assert
        expect(result).toBe(false);
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error checking cache key existence',
          expect.objectContaining({
            key,
            error: 'String error',
          })
        );
      });

      it('should handle timeout errors gracefully', async () => {
        // Arrange
        const key = 'test:timeout';
        const error = new Error('Operation timed out');
        error.name = 'TimeoutError';
        mockRedis.exists.mockRejectedValue(error);

        // Act
        const result = await cache.exists(key);

        // Assert
        expect(result).toBe(false);
      });
    });
  });

  describe('setWithExpiry<T>', () => {
    describe('✅ Happy Path', () => {
      it('should store value with future expiry date', async () => {
        // Arrange
        const key = 'test:expiry';
        const value = 'expires soon';
        const expiryDate = new Date(Date.now() + 3600000); // 1 hour from now
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        expect(mockRedis.setex).toHaveBeenCalledWith(
          key,
          expect.any(Number),
          JSON.stringify(value)
        );
        const ttl = (mockRedis.setex as jest.Mock).mock.calls[0][1];
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(3600);
      });

      it('should calculate TTL correctly for near-future expiry', async () => {
        // Arrange
        const key = 'test:near-expiry';
        const value = 'expires in 5 seconds';
        const expiryDate = new Date(Date.now() + 5000); // 5 seconds from now
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        const ttl = (mockRedis.setex as jest.Mock).mock.calls[0][1];
        expect(ttl).toBeGreaterThanOrEqual(4);
        expect(ttl).toBeLessThanOrEqual(6);
      });

      it('should store complex object with expiry', async () => {
        // Arrange
        const key = 'test:object-expiry';
        const value = { id: 1, data: [1, 2, 3] };
        const expiryDate = new Date(Date.now() + 60000); // 1 minute from now
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        expect(mockRedis.setex).toHaveBeenCalledWith(
          key,
          expect.any(Number),
          JSON.stringify(value)
        );
      });

      it('should round up TTL to nearest second', async () => {
        // Arrange
        const key = 'test:round-up';
        const value = 'test';
        const expiryDate = new Date(Date.now() + 1500); // 1.5 seconds from now
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        const ttl = (mockRedis.setex as jest.Mock).mock.calls[0][1];
        expect(ttl).toBe(2); // Should round up to 2 seconds
      });
    });

    describe('🔍 Edge Cases', () => {
      it('should not cache when expiry date is in the past', async () => {
        // Arrange
        const key = 'test:past-expiry';
        const value = 'already expired';
        const expiryDate = new Date(Date.now() - 1000); // 1 second ago

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        expect(mockRedis.setex).not.toHaveBeenCalled();
        expect(mockRedis.set).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith(
          '[Cache] Expiry date is in the past, not caching',
          expect.objectContaining({ key })
        );
      });

      it('should not cache when expiry date is exactly now', async () => {
        // Arrange
        const key = 'test:now-expiry';
        const value = 'expires now';
        const expiryDate = new Date();

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        expect(mockRedis.setex).not.toHaveBeenCalled();
        expect(mockRedis.set).not.toHaveBeenCalled();
      });

      it('should handle very far future expiry dates', async () => {
        // Arrange
        const key = 'test:far-future';
        const value = 'expires in 10 years';
        const expiryDate = new Date(Date.now() + 315360000000); // 10 years
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        expect(mockRedis.setex).toHaveBeenCalled();
        const ttl = (mockRedis.setex as jest.Mock).mock.calls[0][1];
        expect(ttl).toBeGreaterThan(315000000);
      });

      it('should handle millisecond precision correctly', async () => {
        // Arrange
        const key = 'test:milliseconds';
        const value = 'precise timing';
        const expiryDate = new Date(Date.now() + 1001); // 1.001 seconds
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        const ttl = (mockRedis.setex as jest.Mock).mock.calls[0][1];
        expect(ttl).toBe(2); // Should round up
      });
    });

    describe('❌ Error Handling', () => {
      it('should throw error on Redis setex failure', async () => {
        // Arrange
        const key = 'test:error';
        const value = 'fail';
        const expiryDate = new Date(Date.now() + 60000);
        const error = new Error('Redis setex failed');
        mockRedis.setex.mockRejectedValue(error);

        // Act & Assert
        await expect(cache.setWithExpiry(key, value, expiryDate)).rejects.toThrow(error);
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error storing cached value with expiry date',
          expect.objectContaining({
            key,
            error: error.message,
            stack: expect.any(String),
          })
        );
      });

      it('should handle non-Error exceptions', async () => {
        // Arrange
        const key = 'test:string-error';
        const value = 'fail';
        const expiryDate = new Date(Date.now() + 60000);
        mockRedis.setex.mockRejectedValue('String error');

        // Act & Assert
        await expect(cache.setWithExpiry(key, value, expiryDate)).rejects.toBe('String error');
        expect(console.error).toHaveBeenCalledWith(
          '[Cache] Error storing cached value with expiry date',
          expect.objectContaining({
            key,
            error: 'String error',
          })
        );
      });

      it('should handle circular reference in value', async () => {
        // Arrange
        const key = 'test:circular';
        const value: any = { name: 'test' };
        value.self = value;
        const expiryDate = new Date(Date.now() + 60000);

        // Act & Assert
        await expect(cache.setWithExpiry(key, value, expiryDate)).rejects.toThrow();
      });
    });

    describe('⏱️ Time Calculations', () => {
      it('should calculate TTL correctly for 1 second expiry', async () => {
        // Arrange
        const key = 'test:1sec';
        const value = 'test';
        const expiryDate = new Date(Date.now() + 1000);
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        const ttl = (mockRedis.setex as jest.Mock).mock.calls[0][1];
        expect(ttl).toBe(1);
      });

      it('should calculate TTL correctly for 1 hour expiry', async () => {
        // Arrange
        const key = 'test:1hour';
        const value = 'test';
        const expiryDate = new Date(Date.now() + 3600000);
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        const ttl = (mockRedis.setex as jest.Mock).mock.calls[0][1];
        expect(ttl).toBeGreaterThanOrEqual(3599);
        expect(ttl).toBeLessThanOrEqual(3601);
      });

      it('should calculate TTL correctly for 1 day expiry', async () => {
        // Arrange
        const key = 'test:1day';
        const value = 'test';
        const expiryDate = new Date(Date.now() + 86400000);
        mockRedis.setex.mockResolvedValue('OK');

        // Act
        await cache.setWithExpiry(key, value, expiryDate);

        // Assert
        const ttl = (mockRedis.setex as jest.Mock).mock.calls[0][1];
        expect(ttl).toBeGreaterThanOrEqual(86399);
        expect(ttl).toBeLessThanOrEqual(86401);
      });
    });
  });

  describe('🔄 Integration Scenarios', () => {
    it('should handle complete cache lifecycle', async () => {
      // Arrange
      const key = 'test:lifecycle';
      const value = { id: 1, name: 'Test' };
      mockRedis.exists.mockResolvedValue(0);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue(JSON.stringify(value));
      mockRedis.del.mockResolvedValue(1);

      // Act & Assert - Check not exists
      let exists = await cache.exists(key);
      expect(exists).toBe(false);

      // Set value
      await cache.set(key, value);
      expect(mockRedis.set).toHaveBeenCalled();

      // Check exists
      mockRedis.exists.mockResolvedValue(1);
      exists = await cache.exists(key);
      expect(exists).toBe(true);

      // Get value
      const retrieved = await cache.get<typeof value>(key);
      expect(retrieved).toEqual(value);

      // Delete value
      await cache.del(key);
      expect(mockRedis.del).toHaveBeenCalled();

      // Check not exists
      mockRedis.exists.mockResolvedValue(0);
      exists = await cache.exists(key);
      expect(exists).toBe(false);
    });

    it('should handle cache update scenario', async () => {
      // Arrange
      const key = 'test:update';
      const value1 = { version: 1 };
      const value2 = { version: 2 };
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(value1));
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(value2));

      // Act & Assert
      await cache.set(key, value1);
      let retrieved = await cache.get<typeof value1>(key);
      expect(retrieved).toEqual(value1);

      await cache.set(key, value2);
      retrieved = await cache.get<typeof value2>(key);
      expect(retrieved).toEqual(value2);
    });

    it('should handle cache with TTL expiry simulation', async () => {
      // Arrange
      const key = 'test:ttl-expiry';
      const value = 'temporary';
      const ttl = 1;
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(value));
      mockRedis.get.mockResolvedValueOnce(null);

      // Act & Assert
      await cache.set(key, value, ttl);
      expect(mockRedis.setex).toHaveBeenCalledWith(key, ttl, JSON.stringify(value));

      // Simulate before expiry
      let retrieved = await cache.get<string>(key);
      expect(retrieved).toBe(value);

      // Simulate after expiry
      retrieved = await cache.get<string>(key);
      expect(retrieved).toBeNull();
    });
  });

  describe('🛡️ Security & Validation', () => {
    it('should handle potentially malicious keys safely', async () => {
      // Arrange
      const maliciousKeys = [
        '../../../etc/passwd',
        'key\nwith\nnewlines',
        'key\x00with\x00nulls',
        'key with spaces',
        'key;with;semicolons',
      ];
      mockRedis.get.mockResolvedValue(null);

      // Act & Assert
      for (const key of maliciousKeys) {
        const result = await cache.get<string>(key);
        expect(result).toBeNull();
        expect(mockRedis.get).toHaveBeenCalledWith(key);
      }
    });

    it('should handle XSS attempt in cached data', async () => {
      // Arrange
      const key = 'test:xss';
      const xssValue = '<script>alert("XSS")</script>';
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue(JSON.stringify(xssValue));

      // Act
      await cache.set(key, xssValue);
      const retrieved = await cache.get<string>(key);

      // Assert
      expect(retrieved).toBe(xssValue);
      expect(mockRedis.set).toHaveBeenCalledWith(key, JSON.stringify(xssValue));
    });

    it('should handle SQL injection attempt in cached data', async () => {
      // Arrange
      const key = 'test:sql';
      const sqlValue = "'; DROP TABLE users; --";
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue(JSON.stringify(sqlValue));

      // Act
      await cache.set(key, sqlValue);
      const retrieved = await cache.get<string>(key);

      // Assert
      expect(retrieved).toBe(sqlValue);
    });
  });

  describe('⚡ Performance & Stress Tests', () => {
    it('should handle rapid sequential operations', async () => {
      // Arrange
      const operations = 100;
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue(JSON.stringify('value'));

      // Act
      const startTime = Date.now();
      for (let i = 0; i < operations; i++) {
        await cache.set(`key:${i}`, `value:${i}`);
        await cache.get<string>(`key:${i}`);
      }
      const duration = Date.now() - startTime;

      // Assert
      expect(mockRedis.set).toHaveBeenCalledTimes(operations);
      expect(mockRedis.get).toHaveBeenCalledTimes(operations);
      expect(duration).toBeLessThan(1000); // Should complete in < 1 second
    });

    it('should handle concurrent operations', async () => {
      // Arrange
      const concurrentOps = 50;
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.get.mockResolvedValue(JSON.stringify('value'));

      // Act
      const promises = Array.from({ length: concurrentOps }, (_, i) =>
        Promise.all([cache.set(`key:${i}`, `value:${i}`), cache.get<string>(`key:${i}`)])
      );

      await Promise.all(promises);

      // Assert
      expect(mockRedis.set).toHaveBeenCalledTimes(concurrentOps);
      expect(mockRedis.get).toHaveBeenCalledTimes(concurrentOps);
    });
  });

  describe('📊 Logging & Monitoring', () => {
    it('should log cache hits with proper metadata', async () => {
      // Arrange
      const key = 'test:logging';
      const value = 'test';
      mockRedis.get.mockResolvedValue(JSON.stringify(value));

      // Act
      await cache.get<string>(key);

      // Assert
      expect(console.debug).toHaveBeenCalledWith(
        '[Cache] Cache hit',
        expect.objectContaining({
          timestamp: expect.any(String),
          key,
        })
      );
    });

    it('should log cache misses with proper metadata', async () => {
      // Arrange
      const key = 'test:miss';
      mockRedis.get.mockResolvedValue(null);

      // Act
      await cache.get<string>(key);

      // Assert
      expect(console.debug).toHaveBeenCalledWith(
        '[Cache] Cache miss',
        expect.objectContaining({
          timestamp: expect.any(String),
          key,
        })
      );
    });

    it('should log errors with stack traces', async () => {
      // Arrange
      const key = 'test:error-log';
      const error = new Error('Test error');
      mockRedis.get.mockRejectedValue(error);

      // Act
      await cache.get<string>(key);

      // Assert
      expect(console.error).toHaveBeenCalledWith(
        '[Cache] Error retrieving cached value',
        expect.objectContaining({
          timestamp: expect.any(String),
          key,
          error: error.message,
          stack: expect.any(String),
        })
      );
    });
  });
});