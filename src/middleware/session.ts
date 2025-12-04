import session from 'express-session';
import RedisStore from 'connect-redis';
import { redis } from '../lib/redis';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    cartId?: string;
    lastActivity?: Date;
  }
}

export interface SessionConfig {
  secret: string;
  resave: boolean;
  saveUninitialized: boolean;
  cookie: {
    secure: boolean;
    httpOnly: boolean;
    maxAge: number;
    sameSite: 'strict' | 'lax' | 'none';
  };
  name: string;
  store: RedisStore;
}

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7;

if (!process.env.SESSION_SECRET && IS_PRODUCTION) {
  console.error('[Session] SESSION_SECRET not set in production environment', {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
  throw new Error('SESSION_SECRET must be set in production');
}

const redisStore = new RedisStore({
  client: redis,
  prefix: 'session:',
  ttl: SESSION_MAX_AGE / 1000,
});

redisStore.on('error', (error: Error) => {
  console.error('[Session] Redis store error occurred', {
    timestamp: new Date().toISOString(),
    error: error.message,
    errorName: error.name,
    stack: error.stack,
  });
});

redisStore.on('connect', () => {
  console.info('[Session] Redis store connected', {
    timestamp: new Date().toISOString(),
  });
});

redisStore.on('disconnect', () => {
  console.warn('[Session] Redis store disconnected', {
    timestamp: new Date().toISOString(),
  });
});

const sessionConfig: SessionConfig = {
  store: redisStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: IS_PRODUCTION,
    httpOnly: true,
    maxAge: SESSION_MAX_AGE,
    sameSite: 'lax',
  },
  name: 'sessionId',
};

console.info('[Session] Session middleware configured', {
  timestamp: new Date().toISOString(),
  environment: process.env.NODE_ENV,
  secure: sessionConfig.cookie.secure,
  maxAge: sessionConfig.cookie.maxAge,
  sameSite: sessionConfig.cookie.sameSite,
});

export const sessionMiddleware = session(sessionConfig);

export default sessionMiddleware;