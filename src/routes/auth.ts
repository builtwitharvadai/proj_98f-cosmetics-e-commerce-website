import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { authenticate } from '../middleware/auth';
import {
  RegisterInput,
  LoginInput,
  RefreshTokenInput,
  AuthResponse,
  AuthTokens,
} from '../types/auth.types';

const router = Router();

/**
 * POST /api/auth/register
 * Register a new user account
 *
 * @body {RegisterInput} - User registration data (email, password, name)
 * @returns {AuthResponse} 201 - User data and authentication tokens
 * @returns {Error} 400 - Validation error or duplicate email
 * @returns {Error} 500 - Internal server error
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body as RegisterInput;

    // Validate required fields
    if (!email || !password || !name) {
      res.status(400).json({
        error: 'Validation error',
        message: 'Email, password, and name are required',
      });
      return;
    }

    // Validate email is string
    if (typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string') {
      res.status(400).json({
        error: 'Validation error',
        message: 'Email, password, and name must be strings',
      });
      return;
    }

    // Trim inputs
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    if (!trimmedEmail || !trimmedName) {
      res.status(400).json({
        error: 'Validation error',
        message: 'Email and name cannot be empty',
      });
      return;
    }

    // Register user
    const result: AuthResponse = await authService.register({
      email: trimmedEmail,
      password,
      name: trimmedName,
    });

    console.log('[AuthRoutes] User registered successfully:', {
      userId: result.user.id,
      email: result.user.email,
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('[AuthRoutes] Registration error:', error);

    if (error instanceof Error) {
      // Handle specific error cases
      if (error.message === 'Email already registered') {
        res.status(400).json({
          error: 'Duplicate email',
          message: error.message,
        });
        return;
      }

      if (
        error.message === 'Invalid email format' ||
        error.message.includes('Password must be')
      ) {
        res.status(400).json({
          error: 'Validation error',
          message: error.message,
        });
        return;
      }
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to register user',
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user with email and password
 *
 * @body {LoginInput} - User credentials (email, password)
 * @returns {AuthResponse} 200 - User data and authentication tokens
 * @returns {Error} 400 - Validation error
 * @returns {Error} 401 - Invalid credentials
 * @returns {Error} 500 - Internal server error
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as LoginInput;

    // Validate required fields
    if (!email || !password) {
      res.status(400).json({
        error: 'Validation error',
        message: 'Email and password are required',
      });
      return;
    }

    // Validate types
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({
        error: 'Validation error',
        message: 'Email and password must be strings',
      });
      return;
    }

    // Trim email
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      res.status(400).json({
        error: 'Validation error',
        message: 'Email cannot be empty',
      });
      return;
    }

    // Authenticate user
    const result: AuthResponse = await authService.login({
      email: trimmedEmail,
      password,
    });

    console.log('[AuthRoutes] User logged in successfully:', {
      userId: result.user.id,
      email: result.user.email,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('[AuthRoutes] Login error:', error);

    if (error instanceof Error) {
      // Handle invalid credentials
      if (error.message === 'Invalid credentials') {
        res.status(401).json({
          error: 'Authentication failed',
          message: error.message,
        });
        return;
      }

      // Handle validation errors
      if (error.message === 'Invalid email format') {
        res.status(400).json({
          error: 'Validation error',
          message: error.message,
        });
        return;
      }
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to authenticate user',
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 *
 * @body {RefreshTokenInput} - Refresh token
 * @returns {AuthTokens} 200 - New access and refresh tokens
 * @returns {Error} 400 - Validation error
 * @returns {Error} 401 - Invalid or expired refresh token
 * @returns {Error} 500 - Internal server error
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body as RefreshTokenInput;

    // Validate required field
    if (!refreshToken) {
      res.status(400).json({
        error: 'Validation error',
        message: 'Refresh token is required',
      });
      return;
    }

    // Validate type
    if (typeof refreshToken !== 'string') {
      res.status(400).json({
        error: 'Validation error',
        message: 'Refresh token must be a string',
      });
      return;
    }

    // Trim token
    const trimmedToken = refreshToken.trim();

    if (!trimmedToken) {
      res.status(400).json({
        error: 'Validation error',
        message: 'Refresh token cannot be empty',
      });
      return;
    }

    // Refresh tokens
    const tokens: AuthTokens = await authService.refreshToken(trimmedToken);

    console.log('[AuthRoutes] Token refreshed successfully');

    res.status(200).json(tokens);
  } catch (error) {
    console.error('[AuthRoutes] Token refresh error:', error);

    if (error instanceof Error) {
      // Handle invalid or expired tokens
      if (
        error.message === 'Invalid refresh token' ||
        error.message === 'Refresh token expired'
      ) {
        res.status(401).json({
          error: 'Authentication failed',
          message: error.message,
        });
        return;
      }
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to refresh token',
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user by invalidating refresh token
 *
 * @middleware authenticate - Requires valid access token
 * @body {RefreshTokenInput} - Refresh token to invalidate
 * @returns 204 - Successfully logged out
 * @returns {Error} 400 - Validation error
 * @returns {Error} 401 - Authentication required
 * @returns {Error} 404 - Refresh token not found
 * @returns {Error} 500 - Internal server error
 */
router.post('/logout', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body as RefreshTokenInput;

    // Validate required field
    if (!refreshToken) {
      res.status(400).json({
        error: 'Validation error',
        message: 'Refresh token is required',
      });
      return;
    }

    // Validate type
    if (typeof refreshToken !== 'string') {
      res.status(400).json({
        error: 'Validation error',
        message: 'Refresh token must be a string',
      });
      return;
    }

    // Trim token
    const trimmedToken = refreshToken.trim();

    if (!trimmedToken) {
      res.status(400).json({
        error: 'Validation error',
        message: 'Refresh token cannot be empty',
      });
      return;
    }

    // Logout user
    await authService.logout(trimmedToken);

    console.log('[AuthRoutes] User logged out successfully:', {
      userId: req.user?.userId,
    });

    res.status(204).send();
  } catch (error) {
    console.error('[AuthRoutes] Logout error:', error);

    if (error instanceof Error) {
      // Handle token not found
      if (error.message === 'Refresh token not found') {
        res.status(404).json({
          error: 'Not found',
          message: error.message,
        });
        return;
      }
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to logout user',
    });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user information
 *
 * @middleware authenticate - Requires valid access token
 * @returns {User} 200 - Current user data
 * @returns {Error} 401 - Authentication required
 * @returns {Error} 500 - Internal server error
 */
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    // User is attached to request by authenticate middleware
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'User not authenticated',
      });
      return;
    }

    console.log('[AuthRoutes] User info retrieved:', {
      userId: req.user.userId,
    });

    res.status(200).json({
      id: req.user.userId,
      email: req.user.email,
    });
  } catch (error) {
    console.error('[AuthRoutes] Get user error:', error);

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve user information',
    });
  }
});

export default router;