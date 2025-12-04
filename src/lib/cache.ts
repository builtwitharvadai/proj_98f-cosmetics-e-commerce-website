import { redis } from './redis';

/**
 * Retrieve and parse a cached value from Redis
 * @param key - Cache key
 * @returns Parsed value or null if not found
 */
export async function get<T>(key: string): Promise<T | null> {
  try {
    const value = await redis.get(key);

    if (value === null) {
      console.debug('[Cache] Cache miss', {
        timestamp: new Date().toISOString(),
        key,
      });
      return null;
    }

    console.debug('[Cache] Cache hit', {
      timestamp: new Date().toISOString(),
      key,
    });

    return JSON.parse(value) as T;
  } catch (error) {
    console.error('[Cache] Error retrieving cached value', {
      timestamp: new Date().toISOString(),
      key,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}

/**
 * Store a value in Redis cache with optional TTL
 * @param key - Cache key
 * @param value - Value to cache
 * @param ttlSeconds - Time to live in seconds (optional)
 */
export async function set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  try {
    const serialized = JSON.stringify(value);

    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await redis.setex(key, ttlSeconds, serialized);
      console.debug('[Cache] Value cached with TTL', {
        timestamp: new Date().toISOString(),
        key,
        ttlSeconds,
      });
    } else {
      await redis.set(key, serialized);
      console.debug('[Cache] Value cached without TTL', {
        timestamp: new Date().toISOString(),
        key,
      });
    }
  } catch (error) {
    console.error('[Cache] Error storing cached value', {
      timestamp: new Date().toISOString(),
      key,
      ttlSeconds,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Delete a cached value from Redis
 * @param key - Cache key to delete
 */
export async function del(key: string): Promise<void> {
  try {
    const result = await redis.del(key);

    console.debug('[Cache] Cache key deleted', {
      timestamp: new Date().toISOString(),
      key,
      existed: result === 1,
    });
  } catch (error) {
    console.error('[Cache] Error deleting cached value', {
      timestamp: new Date().toISOString(),
      key,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Check if a key exists in Redis cache
 * @param key - Cache key to check
 * @returns True if key exists, false otherwise
 */
export async function exists(key: string): Promise<boolean> {
  try {
    const result = await redis.exists(key);

    console.debug('[Cache] Cache key existence check', {
      timestamp: new Date().toISOString(),
      key,
      exists: result === 1,
    });

    return result === 1;
  } catch (error) {
    console.error('[Cache] Error checking cache key existence', {
      timestamp: new Date().toISOString(),
      key,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return false;
  }
}

/**
 * Store a value in Redis cache with expiry date
 * @param key - Cache key
 * @param value - Value to cache
 * @param expiryDate - Date when the cache should expire
 */
export async function setWithExpiry<T>(key: string, value: T, expiryDate: Date): Promise<void> {
  try {
    const now = new Date();
    const ttlMilliseconds = expiryDate.getTime() - now.getTime();

    if (ttlMilliseconds <= 0) {
      console.warn('[Cache] Expiry date is in the past, not caching', {
        timestamp: new Date().toISOString(),
        key,
        expiryDate: expiryDate.toISOString(),
        currentDate: now.toISOString(),
      });
      return;
    }

    const ttlSeconds = Math.ceil(ttlMilliseconds / 1000);

    await set(key, value, ttlSeconds);

    console.debug('[Cache] Value cached with expiry date', {
      timestamp: new Date().toISOString(),
      key,
      expiryDate: expiryDate.toISOString(),
      ttlSeconds,
    });
  } catch (error) {
    console.error('[Cache] Error storing cached value with expiry date', {
      timestamp: new Date().toISOString(),
      key,
      expiryDate: expiryDate.toISOString(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}