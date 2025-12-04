/**
 * Authentication Type Definitions
 *
 * Comprehensive type definitions for the authentication system including
 * user registration, login, token management, and JWT payload structures.
 */

/**
 * User registration input data
 */
export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

/**
 * User login credentials
 */
export interface LoginInput {
  email: string;
  password: string;
}

/**
 * Authentication tokens returned after successful login/registration
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * JWT payload structure for access tokens
 */
export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * Refresh token input for token renewal
 */
export interface RefreshTokenInput {
  refreshToken: string;
}

/**
 * Complete authentication response including user data and tokens
 */
export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
  };
  tokens: AuthTokens;
}