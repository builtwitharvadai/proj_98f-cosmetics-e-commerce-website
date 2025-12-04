/**
 * Integration Tests for Authentication API
 * 
 * Test Coverage:
 * - User Registration (POST /api/auth/register)
 * - User Login (POST /api/auth/login)
 * - Token Refresh (POST /api/auth/refresh)
 * - User Logout (POST /api/auth/logout)
 * - Get Current User (GET /api/auth/me)
 * - Authentication Middleware
 * - Input Validation
 * - Error Handling
 * - Security Scenarios
 * 
 * @complexity Medium - Integration testing with database
 * @coverage-target 85%
 */

import request from 'supertest';
import app from '../../src/index';
import { prisma } from '../../src/lib/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Test data factory
const createTestUser = (overrides = {}) => ({
  email: `test${Date.now()}@example.com`,
  password: 'Test1234',
  name: 'Test User',
  ...overrides,
});

// Helper to generate valid JWT token
const generateTestToken = (userId: string, email: string): string => {
  return jwt.sign(
    { userId, email },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '15m' }
  );
};

// Helper to create user directly in database
const createUserInDb = async (userData = {}) => {
  const defaultData = createTestUser(userData);
  const passwordHash = await bcrypt.hash(defaultData.password, 10);

  return prisma.user.create({
    data: {
      email: defaultData.email,
      passwordHash,
      name: defaultData.name,
    },
  });
};

describe('Authentication API Integration Tests', () => {
  // 🏗️ Setup and Teardown
  beforeAll(async () => {
    // Ensure database connection
    await prisma.$connect();
  });

  afterAll(async () => {
    // Cleanup all test data
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Clean up after each test
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({});
  });

  // 🎯 User Registration Tests
  describe('POST /api/auth/register', () => {
    describe('✅ Success Cases', () => {
      it('should create user with valid data and return tokens', async () => {
        // Arrange
        const userData = createTestUser();

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        // Assert
        expect(response.body).toHaveProperty('user');
        expect(response.body).toHaveProperty('tokens');
        expect(response.body.user).toMatchObject({
          email: userData.email,
          name: userData.name,
        });
        expect(response.body.user).toHaveProperty('id');
        expect(response.body.tokens).toHaveProperty('accessToken');
        expect(response.body.tokens).toHaveProperty('refreshToken');

        // Verify user in database
        const dbUser = await prisma.user.findUnique({
          where: { email: userData.email },
        });
        expect(dbUser).toBeDefined();
        expect(dbUser?.email).toBe(userData.email);
        expect(dbUser?.name).toBe(userData.name);

        // Verify refresh token in database
        const refreshToken = await prisma.refreshToken.findFirst({
          where: { userId: dbUser?.id },
        });
        expect(refreshToken).toBeDefined();
        expect(refreshToken?.token).toBe(response.body.tokens.refreshToken);
      });

      it('should hash password before storing', async () => {
        // Arrange
        const userData = createTestUser();

        // Act
        await request(app).post('/api/auth/register').send(userData).expect(201);

        // Assert
        const dbUser = await prisma.user.findUnique({
          where: { email: userData.email },
        });
        expect(dbUser?.passwordHash).toBeDefined();
        expect(dbUser?.passwordHash).not.toBe(userData.password);

        // Verify password can be validated
        const isValid = await bcrypt.compare(userData.password, dbUser!.passwordHash);
        expect(isValid).toBe(true);
      });

      it('should trim whitespace from email and name', async () => {
        // Arrange
        const userData = createTestUser({
          email: '  test@example.com  ',
          name: '  Test User  ',
        });

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        // Assert
        expect(response.body.user.email).toBe('test@example.com');
        expect(response.body.user.name).toBe('Test User');
      });
    });

    describe('❌ Validation Error Cases', () => {
      it('should reject registration with missing email', async () => {
        // Arrange
        const userData = createTestUser();
        delete (userData as any).email;

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('Email');
      });

      it('should reject registration with missing password', async () => {
        // Arrange
        const userData = createTestUser();
        delete (userData as any).password;

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('password');
      });

      it('should reject registration with missing name', async () => {
        // Arrange
        const userData = createTestUser();
        delete (userData as any).name;

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('name');
      });

      it('should reject registration with invalid email format', async () => {
        // Arrange
        const userData = createTestUser({ email: 'invalid-email' });

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('Invalid email format');
      });

      it('should reject registration with weak password (no uppercase)', async () => {
        // Arrange
        const userData = createTestUser({ password: 'test1234' });

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('Password must be');
      });

      it('should reject registration with weak password (no lowercase)', async () => {
        // Arrange
        const userData = createTestUser({ password: 'TEST1234' });

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('Password must be');
      });

      it('should reject registration with weak password (no number)', async () => {
        // Arrange
        const userData = createTestUser({ password: 'TestPassword' });

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('Password must be');
      });

      it('should reject registration with short password', async () => {
        // Arrange
        const userData = createTestUser({ password: 'Test12' });

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('Password must be');
      });

      it('should reject registration with non-string email', async () => {
        // Arrange
        const userData = { ...createTestUser(), email: 12345 };

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('must be strings');
      });

      it('should reject registration with empty email after trim', async () => {
        // Arrange
        const userData = createTestUser({ email: '   ' });

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('cannot be empty');
      });

      it('should reject registration with empty name after trim', async () => {
        // Arrange
        const userData = createTestUser({ name: '   ' });

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('cannot be empty');
      });
    });

    describe('🔒 Duplicate Email Cases', () => {
      it('should prevent duplicate email registration', async () => {
        // Arrange
        const userData = createTestUser();
        await request(app).post('/api/auth/register').send(userData).expect(201);

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Duplicate email');
        expect(response.body.message).toContain('Email already registered');
      });

      it('should prevent duplicate email with different case', async () => {
        // Arrange
        const userData = createTestUser({ email: 'test@example.com' });
        await request(app).post('/api/auth/register').send(userData).expect(201);

        // Act - Try with uppercase email
        const response = await request(app)
          .post('/api/auth/register')
          .send({ ...userData, email: 'TEST@EXAMPLE.COM' })
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Duplicate email');
      });
    });
  });

  // 🔐 User Login Tests
  describe('POST /api/auth/login', () => {
    describe('✅ Success Cases', () => {
      it('should login with valid credentials and return tokens', async () => {
        // Arrange
        const userData = createTestUser();
        await request(app).post('/api/auth/register').send(userData).expect(201);

        // Act
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: userData.email,
            password: userData.password,
          })
          .expect(200);

        // Assert
        expect(response.body).toHaveProperty('user');
        expect(response.body).toHaveProperty('tokens');
        expect(response.body.user.email).toBe(userData.email);
        expect(response.body.tokens).toHaveProperty('accessToken');
        expect(response.body.tokens).toHaveProperty('refreshToken');
      });

      it('should login with trimmed email', async () => {
        // Arrange
        const userData = createTestUser();
        await request(app).post('/api/auth/register').send(userData).expect(201);

        // Act
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: `  ${userData.email}  `,
            password: userData.password,
          })
          .expect(200);

        // Assert
        expect(response.body.user.email).toBe(userData.email);
      });

      it('should generate new refresh token on each login', async () => {
        // Arrange
        const userData = createTestUser();
        await request(app).post('/api/auth/register').send(userData).expect(201);

        // Act - First login
        const response1 = await request(app)
          .post('/api/auth/login')
          .send({
            email: userData.email,
            password: userData.password,
          })
          .expect(200);

        // Act - Second login
        const response2 = await request(app)
          .post('/api/auth/login')
          .send({
            email: userData.email,
            password: userData.password,
          })
          .expect(200);

        // Assert
        expect(response1.body.tokens.refreshToken).not.toBe(
          response2.body.tokens.refreshToken
        );
      });
    });

    describe('❌ Authentication Error Cases', () => {
      it('should reject login with non-existent email', async () => {
        // Arrange
        const userData = createTestUser();

        // Act
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: userData.email,
            password: userData.password,
          })
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Authentication failed');
        expect(response.body.message).toContain('Invalid credentials');
      });

      it('should reject login with incorrect password', async () => {
        // Arrange
        const userData = createTestUser();
        await request(app).post('/api/auth/register').send(userData).expect(201);

        // Act
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: userData.email,
            password: 'WrongPassword123',
          })
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Authentication failed');
        expect(response.body.message).toContain('Invalid credentials');
      });

      it('should reject login with missing email', async () => {
        // Act
        const response = await request(app)
          .post('/api/auth/login')
          .send({ password: 'Test1234' })
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('Email');
      });

      it('should reject login with missing password', async () => {
        // Act
        const response = await request(app)
          .post('/api/auth/login')
          .send({ email: 'test@example.com' })
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('password');
      });

      it('should reject login with non-string credentials', async () => {
        // Act
        const response = await request(app)
          .post('/api/auth/login')
          .send({ email: 12345, password: 67890 })
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('must be strings');
      });

      it('should reject login with empty email after trim', async () => {
        // Act
        const response = await request(app)
          .post('/api/auth/login')
          .send({ email: '   ', password: 'Test1234' })
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('cannot be empty');
      });
    });
  });

  // 🔄 Token Refresh Tests
  describe('POST /api/auth/refresh', () => {
    describe('✅ Success Cases', () => {
      it('should refresh tokens with valid refresh token', async () => {
        // Arrange
        const userData = createTestUser();
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        const { refreshToken } = registerResponse.body.tokens;

        // Act
        const response = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken })
          .expect(200);

        // Assert
        expect(response.body).toHaveProperty('accessToken');
        expect(response.body).toHaveProperty('refreshToken');
        expect(response.body.refreshToken).not.toBe(refreshToken);
      });

      it('should invalidate old refresh token after refresh', async () => {
        // Arrange
        const userData = createTestUser();
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        const { refreshToken: oldToken } = registerResponse.body.tokens;

        // Act - Refresh token
        await request(app).post('/api/auth/refresh').send({ refreshToken: oldToken }).expect(200);

        // Assert - Old token should not work
        const response = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken: oldToken })
          .expect(401);

        expect(response.body).toHaveProperty('error', 'Authentication failed');
      });
    });

    describe('❌ Token Error Cases', () => {
      it('should reject refresh with invalid token', async () => {
        // Act
        const response = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken: 'invalid-token' })
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Authentication failed');
        expect(response.body.message).toContain('Invalid refresh token');
      });

      it('should reject refresh with missing token', async () => {
        // Act
        const response = await request(app).post('/api/auth/refresh').send({}).expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('Refresh token is required');
      });

      it('should reject refresh with non-string token', async () => {
        // Act
        const response = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken: 12345 })
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('must be a string');
      });

      it('should reject refresh with empty token after trim', async () => {
        // Act
        const response = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken: '   ' })
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('cannot be empty');
      });

      it('should reject refresh with expired token', async () => {
        // Arrange - Create user and expired token
        const user = await createUserInDb();
        const expiredToken = jwt.sign(
          { userId: user.id, email: '' },
          process.env.JWT_REFRESH_SECRET || 'test-refresh-secret',
          { expiresIn: '0s' }
        );

        await prisma.refreshToken.create({
          data: {
            token: expiredToken,
            userId: user.id,
            expiresAt: new Date(Date.now() - 1000), // Expired
          },
        });

        // Act
        const response = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken: expiredToken })
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Authentication failed');
        expect(response.body.message).toContain('expired');
      });
    });
  });

  // 🚪 User Logout Tests
  describe('POST /api/auth/logout', () => {
    describe('✅ Success Cases', () => {
      it('should logout and invalidate refresh token', async () => {
        // Arrange
        const userData = createTestUser();
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        const { accessToken, refreshToken } = registerResponse.body.tokens;

        // Act
        await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ refreshToken })
          .expect(204);

        // Assert - Refresh token should be deleted
        const tokenInDb = await prisma.refreshToken.findUnique({
          where: { token: refreshToken },
        });
        expect(tokenInDb).toBeNull();
      });

      it('should require authentication for logout', async () => {
        // Act
        const response = await request(app)
          .post('/api/auth/logout')
          .send({ refreshToken: 'some-token' })
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Authentication required');
      });
    });

    describe('❌ Logout Error Cases', () => {
      it('should reject logout with missing refresh token', async () => {
        // Arrange
        const userData = createTestUser();
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        const { accessToken } = registerResponse.body.tokens;

        // Act
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({})
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('Refresh token is required');
      });

      it('should reject logout with non-existent refresh token', async () => {
        // Arrange
        const userData = createTestUser();
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        const { accessToken } = registerResponse.body.tokens;

        // Act
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ refreshToken: 'non-existent-token' })
          .expect(404);

        // Assert
        expect(response.body).toHaveProperty('error', 'Not found');
        expect(response.body.message).toContain('Refresh token not found');
      });

      it('should reject logout with non-string token', async () => {
        // Arrange
        const userData = createTestUser();
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        const { accessToken } = registerResponse.body.tokens;

        // Act
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ refreshToken: 12345 })
          .expect(400);

        // Assert
        expect(response.body).toHaveProperty('error', 'Validation error');
        expect(response.body.message).toContain('must be a string');
      });
    });
  });

  // 👤 Get Current User Tests
  describe('GET /api/auth/me', () => {
    describe('✅ Success Cases', () => {
      it('should return current user with valid token', async () => {
        // Arrange
        const userData = createTestUser();
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        const { accessToken } = registerResponse.body.tokens;

        // Act
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        // Assert
        expect(response.body).toHaveProperty('id');
        expect(response.body).toHaveProperty('email', userData.email);
      });
    });

    describe('❌ Authentication Error Cases', () => {
      it('should reject request without authorization header', async () => {
        // Act
        const response = await request(app).get('/api/auth/me').expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Authentication required');
        expect(response.body.message).toContain('No authorization header');
      });

      it('should reject request with invalid token format', async () => {
        // Act
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'InvalidFormat token')
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Invalid authorization format');
      });

      it('should reject request with missing Bearer prefix', async () => {
        // Act
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'some-token')
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Invalid authorization format');
      });

      it('should reject request with empty token', async () => {
        // Act
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'Bearer ')
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Authentication required');
        expect(response.body.message).toContain('No token provided');
      });

      it('should reject request with invalid token', async () => {
        // Act
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Invalid token');
      });

      it('should reject request with expired token', async () => {
        // Arrange
        const user = await createUserInDb();
        const expiredToken = jwt.sign(
          { userId: user.id, email: user.email },
          process.env.JWT_SECRET || 'test-secret',
          { expiresIn: '0s' }
        );

        // Act
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${expiredToken}`)
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Token expired');
        expect(response.body.message).toContain('expired');
      });

      it('should reject request with malformed token payload', async () => {
        // Arrange
        const malformedToken = jwt.sign(
          { invalidField: 'value' },
          process.env.JWT_SECRET || 'test-secret',
          { expiresIn: '15m' }
        );

        // Act
        const response = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${malformedToken}`)
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Invalid token');
        expect(response.body.message).toContain('malformed');
      });
    });
  });

  // 🔒 Security Tests
  describe('🛡️ Security Scenarios', () => {
    describe('Password Security', () => {
      it('should not return password hash in any response', async () => {
        // Arrange
        const userData = createTestUser();

        // Act - Register
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        // Assert
        expect(registerResponse.body.user).not.toHaveProperty('passwordHash');
        expect(registerResponse.body.user).not.toHaveProperty('password');

        // Act - Login
        const loginResponse = await request(app)
          .post('/api/auth/login')
          .send({
            email: userData.email,
            password: userData.password,
          })
          .expect(200);

        // Assert
        expect(loginResponse.body.user).not.toHaveProperty('passwordHash');
        expect(loginResponse.body.user).not.toHaveProperty('password');

        // Act - Get user
        const meResponse = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${registerResponse.body.tokens.accessToken}`)
          .expect(200);

        // Assert
        expect(meResponse.body).not.toHaveProperty('passwordHash');
        expect(meResponse.body).not.toHaveProperty('password');
      });

      it('should use bcrypt for password hashing', async () => {
        // Arrange
        const userData = createTestUser();
        await request(app).post('/api/auth/register').send(userData).expect(201);

        // Act
        const dbUser = await prisma.user.findUnique({
          where: { email: userData.email },
        });

        // Assert
        expect(dbUser?.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/); // bcrypt format
      });
    });

    describe('Token Security', () => {
      it('should use different secrets for access and refresh tokens', async () => {
        // Arrange
        const userData = createTestUser();
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        const { accessToken, refreshToken } = response.body.tokens;

        // Act - Try to verify access token with refresh secret (should fail)
        let accessTokenValid = false;
        try {
          jwt.verify(accessToken, process.env.JWT_REFRESH_SECRET || 'test-refresh-secret');
          accessTokenValid = true;
        } catch {
          accessTokenValid = false;
        }

        // Assert
        expect(accessTokenValid).toBe(false);
      });

      it('should include user information in access token', async () => {
        // Arrange
        const userData = createTestUser();
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        const { accessToken } = response.body.tokens;

        // Act
        const decoded = jwt.decode(accessToken) as any;

        // Assert
        expect(decoded).toHaveProperty('userId');
        expect(decoded).toHaveProperty('email', userData.email);
        expect(decoded).toHaveProperty('exp');
        expect(decoded).toHaveProperty('iat');
      });

      it('should store refresh tokens in database', async () => {
        // Arrange
        const userData = createTestUser();
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        const { refreshToken } = response.body.tokens;

        // Act
        const tokenInDb = await prisma.refreshToken.findUnique({
          where: { token: refreshToken },
        });

        // Assert
        expect(tokenInDb).toBeDefined();
        expect(tokenInDb?.token).toBe(refreshToken);
        expect(tokenInDb?.expiresAt).toBeInstanceOf(Date);
      });
    });

    describe('Rate Limiting & Brute Force Protection', () => {
      it('should handle multiple failed login attempts', async () => {
        // Arrange
        const userData = createTestUser();
        await request(app).post('/api/auth/register').send(userData).expect(201);

        // Act - Multiple failed attempts
        const attempts = Array(5)
          .fill(null)
          .map(() =>
            request(app)
              .post('/api/auth/login')
              .send({
                email: userData.email,
                password: 'WrongPassword123',
              })
          );

        const responses = await Promise.all(attempts);

        // Assert - All should fail with 401
        responses.forEach((response) => {
          expect(response.status).toBe(401);
        });
      });
    });

    describe('Input Sanitization', () => {
      it('should handle SQL injection attempts in email', async () => {
        // Arrange
        const maliciousEmail = "admin'--";

        // Act
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: maliciousEmail,
            password: 'Test1234',
          })
          .expect(401);

        // Assert
        expect(response.body).toHaveProperty('error', 'Authentication failed');
      });

      it('should handle XSS attempts in name field', async () => {
        // Arrange
        const xssName = '<script>alert("xss")</script>';
        const userData = createTestUser({ name: xssName });

        // Act
        const response = await request(app)
          .post('/api/auth/register')
          .send(userData)
          .expect(201);

        // Assert - Name should be stored as-is (sanitization happens on output)
        expect(response.body.user.name).toBe(xssName);
      });
    });
  });

  // ⚡ Performance Tests
  describe('⚡ Performance Scenarios', () => {
    it('should register user within acceptable time', async () => {
      // Arrange
      const userData = createTestUser();
      const startTime = Date.now();

      // Act
      await request(app).post('/api/auth/register').send(userData).expect(201);

      const duration = Date.now() - startTime;

      // Assert - Should complete within 2 seconds
      expect(duration).toBeLessThan(2000);
    });

    it('should login within acceptable time', async () => {
      // Arrange
      const userData = createTestUser();
      await request(app).post('/api/auth/register').send(userData).expect(201);

      const startTime = Date.now();

      // Act
      await request(app)
        .post('/api/auth/login')
        .send({
          email: userData.email,
          password: userData.password,
        })
        .expect(200);

      const duration = Date.now() - startTime;

      // Assert - Should complete within 1 second
      expect(duration).toBeLessThan(1000);
    });

    it('should handle concurrent registrations', async () => {
      // Arrange
      const users = Array(5)
        .fill(null)
        .map(() => createTestUser());

      // Act
      const registrations = users.map((userData) =>
        request(app).post('/api/auth/register').send(userData)
      );

      const responses = await Promise.all(registrations);

      // Assert - All should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(201);
      });

      // Verify all users in database
      const dbUsers = await prisma.user.findMany({
        where: {
          email: { in: users.map((u) => u.email) },
        },
      });

      expect(dbUsers).toHaveLength(5);
    });
  });

  // 🔄 Edge Cases
  describe('🔄 Edge Case Scenarios', () => {
    it('should handle very long email addresses', async () => {
      // Arrange
      const longEmail = `${'a'.repeat(50)}@${'b'.repeat(50)}.com`;
      const userData = createTestUser({ email: longEmail });

      // Act
      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // Assert
      expect(response.body.user.email).toBe(longEmail);
    });

    it('should handle very long names', async () => {
      // Arrange
      const longName = 'A'.repeat(200);
      const userData = createTestUser({ name: longName });

      // Act
      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // Assert
      expect(response.body.user.name).toBe(longName);
    });

    it('should handle special characters in name', async () => {
      // Arrange
      const specialName = "O'Brien-Smith (Jr.) & Co.";
      const userData = createTestUser({ name: specialName });

      // Act
      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // Assert
      expect(response.body.user.name).toBe(specialName);
    });

    it('should handle unicode characters in name', async () => {
      // Arrange
      const unicodeName = '张伟 José María';
      const userData = createTestUser({ name: unicodeName });

      // Act
      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // Assert
      expect(response.body.user.name).toBe(unicodeName);
    });

    it('should handle email with plus addressing', async () => {
      // Arrange
      const emailWithPlus = 'user+test@example.com';
      const userData = createTestUser({ email: emailWithPlus });

      // Act
      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // Assert
      expect(response.body.user.email).toBe(emailWithPlus);
    });
  });
});