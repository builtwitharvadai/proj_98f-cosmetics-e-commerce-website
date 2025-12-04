import { authService } from './auth.service';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { RegisterInput, LoginInput } from '../types/auth.types';

// Mock all external dependencies
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('bcrypt');
jest.mock('jsonwebtoken');

describe('AuthService', () => {
  // Test data factories
  const createMockUser = (overrides = {}) => ({
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: '$2b$10$hashedpassword',
    ...overrides,
  });

  const createRegisterInput = (overrides = {}): RegisterInput => ({
    email: 'newuser@example.com',
    password: 'Password123',
    name: 'New User',
    ...overrides,
  });

  const createLoginInput = (overrides = {}): LoginInput => ({
    email: 'test@example.com',
    password: 'Password123',
    ...overrides,
  });

  const mockAccessToken = 'mock.access.token';
  const mockRefreshToken = 'mock.refresh.token';

  // Setup and teardown
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Set required environment variables
    process.env.JWT_SECRET = 'test-jwt-secret-with-minimum-32-characters';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-with-minimum-32-chars';
    process.env.JWT_ACCESS_EXPIRY = '15m';
    process.env.JWT_REFRESH_EXPIRY = '7d';
    process.env.BCRYPT_SALT_ROUNDS = '10';

    // Default mock implementations
    (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$hashedpassword');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (jwt.sign as jest.Mock).mockReturnValue(mockAccessToken);
    (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-123', email: 'test@example.com' });
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.JWT_ACCESS_EXPIRY;
    delete process.env.JWT_REFRESH_EXPIRY;
    delete process.env.BCRYPT_SALT_ROUNDS;
  });

  // 🎯 UNIT TESTS - Registration
  describe('register', () => {
    it('should create user with hashed password', async () => {
      // Arrange
      const input = createRegisterInput();
      const mockUser = createMockUser({
        email: input.email,
        name: input.name,
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: mockUser.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Act
      const result = await authService.register(input);

      // Assert
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: input.email },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(input.password, 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: input.email,
          passwordHash: '$2b$10$hashedpassword',
          name: input.name,
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      });
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
      });
      expect(result.tokens).toHaveProperty('accessToken');
      expect(result.tokens).toHaveProperty('refreshToken');
    });

    it('should validate email format and reject invalid emails', async () => {
      // Arrange
      const invalidEmails = [
        'notanemail',
        'missing@domain',
        '@nodomain.com',
        'spaces in@email.com',
        'double@@domain.com',
      ];

      // Act & Assert
      for (const email of invalidEmails) {
        const input = createRegisterInput({ email });
        await expect(authService.register(input)).rejects.toThrow('Invalid email format');
      }

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should validate password strength and reject weak passwords', async () => {
      // Arrange
      const weakPasswords = [
        { password: 'short', reason: 'too short' },
        { password: 'nouppercase123', reason: 'no uppercase' },
        { password: 'NOLOWERCASE123', reason: 'no lowercase' },
        { password: 'NoNumbers', reason: 'no numbers' },
        { password: 'abc123', reason: 'too short and no uppercase' },
      ];

      // Act & Assert
      for (const { password } of weakPasswords) {
        const input = createRegisterInput({ password });
        await expect(authService.register(input)).rejects.toThrow(
          'Password must be at least 8 characters and contain uppercase, lowercase, and number'
        );
      }

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should prevent duplicate email registration', async () => {
      // Arrange
      const input = createRegisterInput();
      const existingUser = createMockUser({ email: input.email });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

      // Act & Assert
      await expect(authService.register(input)).rejects.toThrow('Email already registered');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: input.email },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should accept valid passwords with all requirements', async () => {
      // Arrange
      const validPasswords = [
        'Password123',
        'StrongP@ss1',
        'MySecure99Pass',
        'Test1234ABC',
      ];

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(createMockUser());
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: 'user-123',
        expiresAt: new Date(),
      });

      // Act & Assert
      for (const password of validPasswords) {
        const input = createRegisterInput({ password });
        const result = await authService.register(input);
        expect(result).toHaveProperty('user');
        expect(result).toHaveProperty('tokens');
      }
    });

    it('should generate both access and refresh tokens on registration', async () => {
      // Arrange
      const input = createRegisterInput();
      const mockUser = createMockUser();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce(mockAccessToken)
        .mockReturnValueOnce(mockRefreshToken);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: mockUser.id,
        expiresAt: new Date(),
      });

      // Act
      const result = await authService.register(input);

      // Assert
      expect(jwt.sign).toHaveBeenCalledTimes(2);
      expect(jwt.sign).toHaveBeenCalledWith(
        { userId: mockUser.id, email: mockUser.email },
        expect.any(String),
        { expiresIn: '15m' }
      );
      expect(prisma.refreshToken.create).toHaveBeenCalled();
      expect(result.tokens.accessToken).toBe(mockAccessToken);
      expect(result.tokens.refreshToken).toBe(mockRefreshToken);
    });
  });

  // 🎯 UNIT TESTS - Login
  describe('login', () => {
    it('should validate credentials and return user with tokens', async () => {
      // Arrange
      const input = createLoginInput();
      const mockUser = createMockUser();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce(mockAccessToken)
        .mockReturnValueOnce(mockRefreshToken);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: mockUser.id,
        expiresAt: new Date(),
      });

      // Act
      const result = await authService.login(input);

      // Assert
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: input.email },
        select: {
          id: true,
          email: true,
          name: true,
          passwordHash: true,
        },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(input.password, mockUser.passwordHash);
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
      });
      expect(result.tokens).toHaveProperty('accessToken');
      expect(result.tokens).toHaveProperty('refreshToken');
    });

    it('should fail with invalid email', async () => {
      // Arrange
      const input = createLoginInput({ email: 'nonexistent@example.com' });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      // Act & Assert
      await expect(authService.login(input)).rejects.toThrow('Invalid credentials');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: input.email },
        select: {
          id: true,
          email: true,
          name: true,
          passwordHash: true,
        },
      });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should fail with invalid password', async () => {
      // Arrange
      const input = createLoginInput({ password: 'WrongPassword123' });
      const mockUser = createMockUser();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      // Act & Assert
      await expect(authService.login(input)).rejects.toThrow('Invalid credentials');

      expect(prisma.user.findUnique).toHaveBeenCalled();
      expect(bcrypt.compare).toHaveBeenCalledWith(input.password, mockUser.passwordHash);
    });

    it('should not reveal whether email or password is incorrect', async () => {
      // Arrange
      const invalidEmailInput = createLoginInput({ email: 'wrong@example.com' });
      const invalidPasswordInput = createLoginInput({ password: 'WrongPass123' });
      const mockUser = createMockUser();

      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      // Act & Assert
      const emailError = authService.login(invalidEmailInput);
      const passwordError = authService.login(invalidPasswordInput);

      await expect(emailError).rejects.toThrow('Invalid credentials');
      await expect(passwordError).rejects.toThrow('Invalid credentials');
    });
  });

  // 🎯 UNIT TESTS - Token Refresh
  describe('refreshToken', () => {
    it('should generate new access token with valid refresh token', async () => {
      // Arrange
      const mockUser = createMockUser();
      const storedToken = {
        id: 'token-123',
        token: mockRefreshToken,
        userId: mockUser.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: {
          id: mockUser.id,
          email: mockUser.email,
        },
      };

      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(storedToken);
      (jwt.verify as jest.Mock).mockReturnValue({ userId: mockUser.id });
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce('new.access.token')
        .mockReturnValueOnce('new.refresh.token');
      (prisma.refreshToken.delete as jest.Mock).mockResolvedValue(storedToken);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'new-token-123',
        token: 'new.refresh.token',
        userId: mockUser.id,
        expiresAt: new Date(),
      });

      // Act
      const result = await authService.refreshToken(mockRefreshToken);

      // Assert
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { token: mockRefreshToken },
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      });
      expect(jwt.verify).toHaveBeenCalledWith(
        mockRefreshToken,
        process.env.JWT_REFRESH_SECRET
      );
      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: storedToken.id },
      });
      expect(result).toHaveProperty('accessToken', 'new.access.token');
      expect(result).toHaveProperty('refreshToken', 'new.refresh.token');
    });

    it('should validate token expiry and reject expired tokens', async () => {
      // Arrange
      const expiredToken = {
        id: 'token-123',
        token: mockRefreshToken,
        userId: 'user-123',
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        user: {
          id: 'user-123',
          email: 'test@example.com',
        },
      };

      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(expiredToken);
      (prisma.refreshToken.delete as jest.Mock).mockResolvedValue(expiredToken);

      // Act & Assert
      await expect(authService.refreshToken(mockRefreshToken)).rejects.toThrow(
        'Refresh token expired'
      );

      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: expiredToken.id },
      });
    });

    it('should reject non-existent refresh token', async () => {
      // Arrange
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(null);

      // Act & Assert
      await expect(authService.refreshToken('invalid.token')).rejects.toThrow(
        'Invalid refresh token'
      );

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { token: 'invalid.token' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      });
    });

    it('should reject token with invalid signature', async () => {
      // Arrange
      const storedToken = {
        id: 'token-123',
        token: mockRefreshToken,
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: {
          id: 'user-123',
          email: 'test@example.com',
        },
      };

      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(storedToken);
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid signature');
      });
      (prisma.refreshToken.delete as jest.Mock).mockResolvedValue(storedToken);

      // Act & Assert
      await expect(authService.refreshToken(mockRefreshToken)).rejects.toThrow(
        'Invalid refresh token'
      );

      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: storedToken.id },
      });
    });

    it('should implement token rotation by deleting old token', async () => {
      // Arrange
      const mockUser = createMockUser();
      const oldToken = {
        id: 'old-token-123',
        token: mockRefreshToken,
        userId: mockUser.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: {
          id: mockUser.id,
          email: mockUser.email,
        },
      };

      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(oldToken);
      (jwt.verify as jest.Mock).mockReturnValue({ userId: mockUser.id });
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce('new.access.token')
        .mockReturnValueOnce('new.refresh.token');
      (prisma.refreshToken.delete as jest.Mock).mockResolvedValue(oldToken);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'new-token-123',
        token: 'new.refresh.token',
        userId: mockUser.id,
        expiresAt: new Date(),
      });

      // Act
      await authService.refreshToken(mockRefreshToken);

      // Assert
      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: oldToken.id },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });
  });

  // 🎯 UNIT TESTS - Logout
  describe('logout', () => {
    it('should delete refresh token on logout', async () => {
      // Arrange
      (prisma.refreshToken.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      // Act
      await authService.logout(mockRefreshToken);

      // Assert
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: mockRefreshToken },
      });
    });

    it('should throw error when token not found', async () => {
      // Arrange
      (prisma.refreshToken.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      // Act & Assert
      await expect(authService.logout('nonexistent.token')).rejects.toThrow(
        'Refresh token not found'
      );

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'nonexistent.token' },
      });
    });

    it('should handle multiple logout attempts gracefully', async () => {
      // Arrange
      (prisma.refreshToken.deleteMany as jest.Mock)
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      // Act & Assert
      await expect(authService.logout(mockRefreshToken)).resolves.not.toThrow();
      await expect(authService.logout(mockRefreshToken)).rejects.toThrow(
        'Refresh token not found'
      );
    });
  });

  // 🔒 SECURITY TESTS
  describe('Security', () => {
    it('should use bcrypt with configured salt rounds', async () => {
      // Arrange
      const input = createRegisterInput();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(createMockUser());
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: 'user-123',
        expiresAt: new Date(),
      });

      // Act
      await authService.register(input);

      // Assert
      expect(bcrypt.hash).toHaveBeenCalledWith(input.password, 10);
    });

    it('should not expose password hash in responses', async () => {
      // Arrange
      const input = createRegisterInput();
      const mockUser = createMockUser();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: mockUser.id,
        expiresAt: new Date(),
      });

      // Act
      const result = await authService.register(input);

      // Assert
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.any(Object),
        select: {
          id: true,
          email: true,
          name: true,
        },
      });
    });

    it('should use different secrets for access and refresh tokens', async () => {
      // Arrange
      const input = createRegisterInput();
      const mockUser = createMockUser();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce(mockAccessToken)
        .mockReturnValueOnce(mockRefreshToken);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: mockUser.id,
        expiresAt: new Date(),
      });

      // Act
      await authService.register(input);

      // Assert
      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        expect.any(Object),
        process.env.JWT_SECRET,
        expect.any(Object)
      );
      expect(jwt.sign).toHaveBeenNthCalledWith(
        2,
        expect.any(Object),
        process.env.JWT_REFRESH_SECRET,
        expect.any(Object)
      );
    });

    it('should enforce minimum JWT secret length', () => {
      // Arrange
      process.env.JWT_SECRET = 'short';

      // Act & Assert
      expect(() => {
        jest.isolateModules(() => {
          require('./auth.service');
        });
      }).toThrow('JWT_SECRET must be at least 32 characters');
    });

    it('should enforce minimum refresh secret length', () => {
      // Arrange
      process.env.JWT_REFRESH_SECRET = 'short';

      // Act & Assert
      expect(() => {
        jest.isolateModules(() => {
          require('./auth.service');
        });
      }).toThrow('JWT_REFRESH_SECRET must be at least 32 characters');
    });
  });

  // ⚡ PERFORMANCE TESTS
  describe('Performance', () => {
    it('should complete registration within acceptable time', async () => {
      // Arrange
      const input = createRegisterInput();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(createMockUser());
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: 'user-123',
        expiresAt: new Date(),
      });

      // Act
      const startTime = Date.now();
      await authService.register(input);
      const duration = Date.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should complete login within acceptable time', async () => {
      // Arrange
      const input = createLoginInput();
      const mockUser = createMockUser();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: mockUser.id,
        expiresAt: new Date(),
      });

      // Act
      const startTime = Date.now();
      await authService.login(input);
      const duration = Date.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  // 🔄 EDGE CASES
  describe('Edge Cases', () => {
    it('should handle database connection errors during registration', async () => {
      // Arrange
      const input = createRegisterInput();
      (prisma.user.findUnique as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      // Act & Assert
      await expect(authService.register(input)).rejects.toThrow('Database connection failed');
    });

    it('should handle bcrypt hashing errors', async () => {
      // Arrange
      const input = createRegisterInput();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockRejectedValue(new Error('Hashing failed'));

      // Act & Assert
      await expect(authService.register(input)).rejects.toThrow('Hashing failed');
    });

    it('should handle JWT signing errors', async () => {
      // Arrange
      const input = createRegisterInput();
      const mockUser = createMockUser();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (jwt.sign as jest.Mock).mockImplementation(() => {
        throw new Error('JWT signing failed');
      });

      // Act & Assert
      await expect(authService.register(input)).rejects.toThrow('JWT signing failed');
    });

    it('should handle empty string inputs', async () => {
      // Arrange
      const emptyInputs = [
        { email: '', password: 'Password123', name: 'Test' },
        { email: 'test@example.com', password: '', name: 'Test' },
        { email: 'test@example.com', password: 'Password123', name: '' },
      ];

      // Act & Assert
      for (const input of emptyInputs) {
        await expect(authService.register(input as RegisterInput)).rejects.toThrow();
      }
    });

    it('should handle special characters in email', async () => {
      // Arrange
      const specialEmails = [
        'user+tag@example.com',
        'user.name@example.com',
        'user_name@example.com',
      ];

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(createMockUser());
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: 'user-123',
        expiresAt: new Date(),
      });

      // Act & Assert
      for (const email of specialEmails) {
        const input = createRegisterInput({ email });
        const result = await authService.register(input);
        expect(result.user.email).toBe(email);
      }
    });

    it('should handle very long passwords', async () => {
      // Arrange
      const longPassword = 'A1' + 'a'.repeat(1000); // 1002 characters
      const input = createRegisterInput({ password: longPassword });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(createMockUser());
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        id: 'token-123',
        token: mockRefreshToken,
        userId: 'user-123',
        expiresAt: new Date(),
      });

      // Act
      const result = await authService.register(input);

      // Assert
      expect(result).toHaveProperty('user');
      expect(bcrypt.hash).toHaveBeenCalledWith(longPassword, 10);
    });
  });

  // 🧹 CLEANUP TESTS
  describe('Token Cleanup', () => {
    it('should store refresh token with correct expiry date', async () => {
      // Arrange
      const input = createRegisterInput();
      const mockUser = createMockUser();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce(mockAccessToken)
        .mockReturnValueOnce(mockRefreshToken);

      let capturedExpiryDate: Date | undefined;
      (prisma.refreshToken.create as jest.Mock).mockImplementation((args) => {
        capturedExpiryDate = args.data.expiresAt;
        return Promise.resolve({
          id: 'token-123',
          token: mockRefreshToken,
          userId: mockUser.id,
          expiresAt: args.data.expiresAt,
        });
      });

      // Act
      await authService.register(input);

      // Assert
      expect(capturedExpiryDate).toBeDefined();
      const expectedExpiry = new Date();
      expectedExpiry.setDate(expectedExpiry.getDate() + 7);

      const timeDiff = Math.abs(
        capturedExpiryDate!.getTime() - expectedExpiry.getTime()
      );
      expect(timeDiff).toBeLessThan(5000); // Within 5 seconds
    });
  });
});