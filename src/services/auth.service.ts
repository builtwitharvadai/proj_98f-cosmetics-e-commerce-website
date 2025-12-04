import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import {
  RegisterInput,
  LoginInput,
  AuthResponse,
  AuthTokens,
  JWTPayload,
} from '../types/auth.types';

/**
 * Authentication Service
 *
 * Provides comprehensive authentication functionality including user registration,
 * login, token management, and password hashing. Implements secure JWT-based
 * authentication with refresh token rotation.
 */
class AuthService {
  private readonly bcryptSaltRounds: number;
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;
  private readonly jwtAccessExpiry: string;
  private readonly jwtRefreshExpiry: string;

  constructor() {
    this.bcryptSaltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);
    this.jwtSecret = process.env.JWT_SECRET || '';
    this.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || '';
    this.jwtAccessExpiry = process.env.JWT_ACCESS_EXPIRY || '15m';
    this.jwtRefreshExpiry = process.env.JWT_REFRESH_EXPIRY || '7d';

    if (!this.jwtSecret || this.jwtSecret.length < 32) {
      throw new Error('[AuthService] JWT_SECRET must be at least 32 characters');
    }

    if (!this.jwtRefreshSecret || this.jwtRefreshSecret.length < 32) {
      throw new Error('[AuthService] JWT_REFRESH_SECRET must be at least 32 characters');
    }
  }

  /**
   * Registers a new user with email, password, and name
   *
   * @param {RegisterInput} input - User registration data
   * @returns {Promise<AuthResponse>} User data and authentication tokens
   * @throws {Error} If email already exists or validation fails
   */
  async register(input: RegisterInput): Promise<AuthResponse> {
    const { email, password, name } = input;

    // Validate email format
    if (!this.validateEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Check email uniqueness
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new Error('Email already registered');
    }

    // Validate password strength
    if (!this.validatePassword(password)) {
      throw new Error(
        'Password must be at least 8 characters and contain uppercase, lowercase, and number'
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, this.bcryptSaltRounds);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email);

    console.log('[AuthService] User registered successfully:', {
      userId: user.id,
      email: user.email,
    });

    return {
      user,
      tokens,
    };
  }

  /**
   * Authenticates user with email and password
   *
   * @param {LoginInput} input - User login credentials
   * @returns {Promise<AuthResponse>} User data and authentication tokens
   * @throws {Error} If credentials are invalid
   */
  async login(input: LoginInput): Promise<AuthResponse> {
    const { email, password } = input;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
      },
    });

    if (!user) {
      console.warn('[AuthService] Login attempt with non-existent email:', email);
      throw new Error('Invalid credentials');
    }

    // Validate password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      console.warn('[AuthService] Failed login attempt for user:', user.id);
      throw new Error('Invalid credentials');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email);

    console.log('[AuthService] User logged in successfully:', {
      userId: user.id,
      email: user.email,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      tokens,
    };
  }

  /**
   * Refreshes access token using valid refresh token
   *
   * @param {string} refreshToken - Refresh token to validate
   * @returns {Promise<AuthTokens>} New access and refresh tokens
   * @throws {Error} If refresh token is invalid or expired
   */
  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    // Find refresh token in database
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    if (!storedToken) {
      console.warn('[AuthService] Refresh token not found in database');
      throw new Error('Invalid refresh token');
    }

    // Check if token is expired
    if (storedToken.expiresAt < new Date()) {
      console.warn('[AuthService] Expired refresh token used:', storedToken.userId);
      await prisma.refreshToken.delete({
        where: { id: storedToken.id },
      });
      throw new Error('Refresh token expired');
    }

    // Verify JWT signature
    try {
      jwt.verify(refreshToken, this.jwtRefreshSecret);
    } catch (error) {
      console.error('[AuthService] Invalid refresh token signature:', error);
      await prisma.refreshToken.delete({
        where: { id: storedToken.id },
      });
      throw new Error('Invalid refresh token');
    }

    // Generate new tokens
    const tokens = await this.generateTokens(storedToken.user.id, storedToken.user.email);

    // Delete old refresh token (token rotation)
    await prisma.refreshToken.delete({
      where: { id: storedToken.id },
    });

    console.log('[AuthService] Token refreshed successfully:', {
      userId: storedToken.user.id,
    });

    return tokens;
  }

  /**
   * Logs out user by invalidating refresh token
   *
   * @param {string} refreshToken - Refresh token to invalidate
   * @returns {Promise<void>}
   * @throws {Error} If refresh token is not found
   */
  async logout(refreshToken: string): Promise<void> {
    const deletedToken = await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });

    if (deletedToken.count === 0) {
      console.warn('[AuthService] Logout attempted with non-existent token');
      throw new Error('Refresh token not found');
    }

    console.log('[AuthService] User logged out successfully');
  }

  /**
   * Generates access and refresh tokens for user
   *
   * @private
   * @param {string} userId - User ID
   * @param {string} email - User email
   * @returns {Promise<AuthTokens>} Access and refresh tokens
   */
  private async generateTokens(userId: string, email: string): Promise<AuthTokens> {
    const payload: JWTPayload = {
      userId,
      email,
    };

    // Generate access token
    const accessToken = this.generateAccessToken(payload);

    // Generate refresh token
    const refreshToken = await this.generateRefreshToken(userId);

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Generates JWT access token
   *
   * @private
   * @param {JWTPayload} payload - JWT payload data
   * @returns {string} Signed JWT access token
   */
  private generateAccessToken(payload: JWTPayload): string {
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtAccessExpiry,
    });
  }

  /**
   * Generates and stores refresh token
   *
   * @private
   * @param {string} userId - User ID
   * @returns {Promise<string>} Refresh token
   */
  private async generateRefreshToken(userId: string): Promise<string> {
    const payload: JWTPayload = {
      userId,
      email: '',
    };

    const token = jwt.sign(payload, this.jwtRefreshSecret, {
      expiresIn: this.jwtRefreshExpiry,
    });

    // Calculate expiry date
    const expiresAt = new Date();
    const expiryDays = parseInt(this.jwtRefreshExpiry.replace('d', ''), 10);
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    // Store refresh token in database
    await prisma.refreshToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });

    return token;
  }

  /**
   * Validates email format
   *
   * @private
   * @param {string} email - Email to validate
   * @returns {boolean} True if email is valid
   */
  private validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validates password strength
   * Requirements: minimum 8 characters, at least one uppercase, one lowercase, one number
   *
   * @private
   * @param {string} password - Password to validate
   * @returns {boolean} True if password meets requirements
   */
  private validatePassword(password: string): boolean {
    if (password.length < 8) {
      return false;
    }

    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    return hasUppercase && hasLowercase && hasNumber;
  }
}

/**
 * Singleton instance of AuthService
 * Use this throughout the application for authentication operations
 */
export const authService = new AuthService();