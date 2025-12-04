/**
 * Authentication Middleware
 *
 * JWT validation middleware for protecting routes and optionally authenticating requests.
 * Validates JWT tokens from Authorization headers and attaches decoded user payload to requests.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWTPayload } from '../types/auth.types';

/**
 * Extend Express Request interface to include authenticated user
 */
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * JWT secret from environment variables
 * Must be set in production for security
 */
const JWT_SECRET = process.env.JWT_SECRET || '';

if (!JWT_SECRET) {
  console.error('CRITICAL: JWT_SECRET environment variable is not set');
}

/**
 * Authentication middleware that requires valid JWT token
 *
 * Extracts and validates JWT token from Authorization header (Bearer token format).
 * Attaches decoded payload to req.user for downstream handlers.
 * Returns 401 Unauthorized for missing, invalid, or expired tokens.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No authorization header provided',
      });
      return;
    }

    // Validate Bearer token format
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      res.status(401).json({
        error: 'Invalid authorization format',
        message: 'Authorization header must be in format: Bearer <token>',
      });
      return;
    }

    const token = parts[1];

    if (!token) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No token provided',
      });
      return;
    }

    // Verify JWT token
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;

      // Validate payload structure
      if (!decoded.userId || !decoded.email) {
        res.status(401).json({
          error: 'Invalid token',
          message: 'Token payload is malformed',
        });
        return;
      }

      // Attach user to request
      req.user = decoded;

      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        res.status(401).json({
          error: 'Token expired',
          message: 'Access token has expired. Please refresh your token.',
        });
        return;
      }

      if (error instanceof jwt.JsonWebTokenError) {
        res.status(401).json({
          error: 'Invalid token',
          message: 'Token verification failed',
        });
        return;
      }

      // Unexpected error during verification
      console.error('JWT verification error:', error);
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Token verification failed',
      });
      return;
    }
  } catch (error) {
    // Catch-all for unexpected errors
    console.error('Authentication middleware error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication processing failed',
    });
  }
}

/**
 * Optional authentication middleware
 *
 * Attempts to authenticate the request but does not fail if token is missing.
 * Useful for routes that provide enhanced functionality for authenticated users
 * but also work for anonymous users.
 *
 * If a valid token is provided, attaches decoded payload to req.user.
 * If no token or invalid token, continues without setting req.user.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract Authorization header
    const authHeader = req.headers.authorization;

    // No token provided - continue without authentication
    if (!authHeader) {
      next();
      return;
    }

    // Validate Bearer token format
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      // Invalid format - continue without authentication
      next();
      return;
    }

    const token = parts[1];

    if (!token) {
      // No token - continue without authentication
      next();
      return;
    }

    // Attempt to verify JWT token
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;

      // Validate payload structure
      if (decoded.userId && decoded.email) {
        // Valid token - attach user to request
        req.user = decoded;
      }

      next();
    } catch (error) {
      // Token verification failed - continue without authentication
      // Log for debugging but don't fail the request
      if (error instanceof jwt.TokenExpiredError) {
        console.debug('Optional auth: Token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        console.debug('Optional auth: Invalid token');
      } else {
        console.debug('Optional auth: Token verification failed', error);
      }

      next();
    }
  } catch (error) {
    // Unexpected error - log but continue without authentication
    console.error('Optional authentication middleware error:', error);
    next();
  }
}