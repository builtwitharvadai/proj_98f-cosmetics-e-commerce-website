/**
 * Integration Tests for Payment API Endpoints
 * 
 * Test Coverage:
 * - Payment intent creation with Stripe integration
 * - Payment status retrieval
 * - Webhook event processing
 * - Authentication and authorization
 * - Input validation and error handling
 * - Database transaction integrity
 * 
 * @requires supertest - HTTP assertions
 * @requires jest - Test framework
 * @requires @prisma/client - Database client
 * @requires stripe - Payment gateway
 */

import request from 'supertest';
import app from '../../src/index';
import { prisma } from '../../src/lib/prisma';
import { stripe } from '../../src/lib/stripe';
import type { User, Cart, Product, Category, Payment } from '@prisma/client';

// ============================================================================
// Test Data Factories
// ============================================================================

interface TestUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  token: string;
}

interface TestCart {
  id: string;
  userId: string;
  sessionId: string;
}

interface TestProduct {
  id: string;
  name: string;
  price: number;
  categoryId: string;
}

/**
 * Factory for creating test users with authentication tokens
 */
class UserFactory {
  static async create(overrides: Partial<User> = {}): Promise<TestUser> {
    const user = await prisma.user.create({
      data: {
        email: overrides.email || `test-${Date.now()}@example.com`,
        passwordHash: overrides.passwordHash || 'hashed_password_123',
        name: overrides.name || 'Test User',
        ...overrides,
      },
    });

    // Generate mock JWT token for testing
    const token = `Bearer test_token_${user.id}`;

    return {
      ...user,
      token,
    };
  }
}

/**
 * Factory for creating test carts with items
 */
class CartFactory {
  static async create(
    userId: string,
    products: TestProduct[],
    overrides: Partial<Cart> = {}
  ): Promise<TestCart> {
    const cart = await prisma.cart.create({
      data: {
        userId,
        sessionId: overrides.sessionId || `session_${Date.now()}`,
        ...overrides,
      },
    });

    // Add products to cart
    for (const product of products) {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          quantity: 2,
          priceSnapshot: product.price,
        },
      });
    }

    return cart;
  }
}

/**
 * Factory for creating test products
 */
class ProductFactory {
  static async create(
    categoryId: string,
    overrides: Partial<Product> = {}
  ): Promise<TestProduct> {
    const product = await prisma.product.create({
      data: {
        name: overrides.name || `Test Product ${Date.now()}`,
        description: overrides.description || 'Test product description',
        price: overrides.price || 25.99,
        categoryId,
        imageUrl: overrides.imageUrl || 'https://example.com/image.jpg',
        ...overrides,
      },
    });

    // Create inventory
    await prisma.inventory.create({
      data: {
        productId: product.id,
        quantity: 100,
        reserved: 0,
        available: 100,
      },
    });

    return {
      id: product.id,
      name: product.name,
      price: Number(product.price),
      categoryId: product.categoryId,
    };
  }
}

// ============================================================================
// Test Suite Setup and Teardown
// ============================================================================

describe('Payment API Integration Tests', () => {
  let testUser: TestUser;
  let testCart: TestCart;
  let testProducts: TestProduct[];
  let testCategory: Category;

  /**
   * Setup test environment before all tests
   * - Create test category
   * - Create test products
   * - Create test user
   * - Create test cart with items
   */
  beforeAll(async () => {
    // Create test category
    testCategory = await prisma.category.create({
      data: {
        name: `Test Category ${Date.now()}`,
        description: 'Test category for integration tests',
        slug: `test-category-${Date.now()}`,
      },
    });

    // Create test products
    testProducts = await Promise.all([
      ProductFactory.create(testCategory.id, {
        name: 'Moisturizing Cream',
        price: 29.99,
      }),
      ProductFactory.create(testCategory.id, {
        name: 'Face Serum',
        price: 45.0,
      }),
    ]);

    // Create test user
    testUser = await UserFactory.create({
      email: 'payment-test@example.com',
      name: 'Payment Test User',
    });

    // Create test cart with products
    testCart = await CartFactory.create(testUser.id, testProducts);
  });

  /**
   * Cleanup test data after all tests
   */
  afterAll(async () => {
    // Delete in correct order to respect foreign key constraints
    await prisma.payment.deleteMany({
      where: { userId: testUser.id },
    });

    await prisma.cartItem.deleteMany({
      where: { cartId: testCart.id },
    });

    await prisma.cart.deleteMany({
      where: { userId: testUser.id },
    });

    await prisma.inventory.deleteMany({
      where: {
        productId: {
          in: testProducts.map((p) => p.id),
        },
      },
    });

    await prisma.product.deleteMany({
      where: { categoryId: testCategory.id },
    });

    await prisma.category.deleteMany({
      where: { id: testCategory.id },
    });

    await prisma.refreshToken.deleteMany({
      where: { userId: testUser.id },
    });

    await prisma.user.deleteMany({
      where: { id: testUser.id },
    });

    await prisma.$disconnect();
  });

  /**
   * Reset mocks between tests
   */
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // POST /api/payment/create-intent - Payment Intent Creation
  // ==========================================================================

  describe('POST /api/payment/create-intent', () => {
    /**
     * Happy path: Successfully create payment intent
     */
    it('should create payment intent with valid data', async () => {
      // Calculate expected amount (in cents)
      const expectedAmount = testProducts.reduce((total, product) => {
        return total + product.price * 2 * 100; // 2 items per product
      }, 0);

      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: Math.round(expectedAmount),
          currency: 'usd',
          cartId: testCart.id,
        })
        .expect(201);

      // Verify response structure
      expect(response.body).toMatchObject({
        success: true,
        data: {
          clientSecret: expect.stringMatching(/^pi_.*_secret_.*/),
          paymentIntentId: expect.stringMatching(/^pi_.*/),
          amount: Math.round(expectedAmount),
          currency: 'usd',
        },
      });

      // Verify payment record created in database
      const payment = await prisma.payment.findUnique({
        where: {
          stripePaymentIntentId: response.body.data.paymentIntentId,
        },
      });

      expect(payment).toBeDefined();
      expect(payment?.userId).toBe(testUser.id);
      expect(payment?.cartId).toBe(testCart.id);
      expect(payment?.currency).toBe('usd');
      expect(payment?.status).toBe('requires_payment_method');
    });

    /**
     * Validation: Amount must be positive
     */
    it('should reject payment intent with zero amount', async () => {
      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: 0,
          currency: 'usd',
          cartId: testCart.id,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Validation error',
        message: 'Amount must be greater than zero',
        field: 'amount',
      });
    });

    /**
     * Validation: Amount must be an integer
     */
    it('should reject payment intent with decimal amount', async () => {
      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: 99.99,
          currency: 'usd',
          cartId: testCart.id,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Validation error',
        message: 'Amount must be an integer (smallest currency unit)',
        field: 'amount',
      });
    });

    /**
     * Validation: Currency must be valid ISO code
     */
    it('should reject payment intent with invalid currency', async () => {
      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: 5000,
          currency: 'INVALID',
          cartId: testCart.id,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Validation error',
        message: 'Currency must be a valid ISO 4217 currency code',
        field: 'currency',
      });
    });

    /**
     * Authorization: Cart must exist
     */
    it('should reject payment intent for non-existent cart', async () => {
      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: 5000,
          currency: 'usd',
          cartId: 'non_existent_cart_id',
        })
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: 'CART_NOT_FOUND',
        message: 'Cart not found',
      });
    });

    /**
     * Authorization: Cart must belong to authenticated user
     */
    it('should reject payment intent for unauthorized cart access', async () => {
      // Create another user
      const otherUser = await UserFactory.create({
        email: 'other-user@example.com',
      });

      // Create cart for other user
      const otherCart = await CartFactory.create(otherUser.id, testProducts);

      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: 5000,
          currency: 'usd',
          cartId: otherCart.id,
        })
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: 'UNAUTHORIZED_CART_ACCESS',
        message: 'Cart does not belong to the authenticated user',
      });

      // Cleanup
      await prisma.cartItem.deleteMany({ where: { cartId: otherCart.id } });
      await prisma.cart.deleteMany({ where: { id: otherCart.id } });
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
    });

    /**
     * Validation: Cart must not be empty
     */
    it('should reject payment intent for empty cart', async () => {
      // Create empty cart
      const emptyCart = await prisma.cart.create({
        data: {
          userId: testUser.id,
          sessionId: `empty_session_${Date.now()}`,
        },
      });

      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: 5000,
          currency: 'usd',
          cartId: emptyCart.id,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'EMPTY_CART',
        message: 'Cannot create payment for empty cart',
      });

      // Cleanup
      await prisma.cart.deleteMany({ where: { id: emptyCart.id } });
    });

    /**
     * Validation: Amount must match cart total
     */
    it('should reject payment intent with amount mismatch', async () => {
      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: 1000, // Wrong amount
          currency: 'usd',
          cartId: testCart.id,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'AMOUNT_MISMATCH',
        message: 'Provided amount does not match cart total',
      });
    });

    /**
     * Authentication: Requires valid token
     */
    it('should reject payment intent without authentication', async () => {
      const response = await request(app)
        .post('/api/payment/create-intent')
        .send({
          amount: 5000,
          currency: 'usd',
          cartId: testCart.id,
        })
        .expect(401);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.any(String),
      });
    });

    /**
     * Validation: Missing required fields
     */
    it('should reject payment intent with missing amount', async () => {
      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          currency: 'usd',
          cartId: testCart.id,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Validation error',
        field: 'amount',
      });
    });

    /**
     * Validation: Missing currency field
     */
    it('should reject payment intent with missing currency', async () => {
      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: 5000,
          cartId: testCart.id,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Validation error',
        field: 'currency',
      });
    });

    /**
     * Validation: Missing cartId field
     */
    it('should reject payment intent with missing cartId', async () => {
      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: 5000,
          currency: 'usd',
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Validation error',
        field: 'cartId',
      });
    });
  });

  // ==========================================================================
  // GET /api/payment/status/:paymentIntentId - Payment Status Retrieval
  // ==========================================================================

  describe('GET /api/payment/status/:paymentIntentId', () => {
    let paymentIntentId: string;

    /**
     * Setup: Create payment intent before status tests
     */
    beforeAll(async () => {
      const expectedAmount = testProducts.reduce((total, product) => {
        return total + product.price * 2 * 100;
      }, 0);

      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: Math.round(expectedAmount),
          currency: 'usd',
          cartId: testCart.id,
        });

      paymentIntentId = response.body.data.paymentIntentId;
    });

    /**
     * Happy path: Successfully retrieve payment status
     */
    it('should retrieve payment status with valid payment intent ID', async () => {
      const response = await request(app)
        .get(`/api/payment/status/${paymentIntentId}`)
        .set('Authorization', testUser.token)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          status: expect.stringMatching(
            /^(requires_payment_method|requires_confirmation|requires_action|processing|succeeded|canceled)$/
          ),
          paymentIntentId,
          amount: expect.any(Number),
          currency: 'usd',
        },
      });
    });

    /**
     * Error: Payment intent not found
     */
    it('should return 404 for non-existent payment intent', async () => {
      const response = await request(app)
        .get('/api/payment/status/pi_nonexistent')
        .set('Authorization', testUser.token)
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    });

    /**
     * Validation: Payment intent ID required
     */
    it('should reject request with missing payment intent ID', async () => {
      const response = await request(app)
        .get('/api/payment/status/')
        .set('Authorization', testUser.token)
        .expect(404); // Route not found
    });

    /**
     * Authentication: Requires valid token
     */
    it('should reject status request without authentication', async () => {
      const response = await request(app)
        .get(`/api/payment/status/${paymentIntentId}`)
        .expect(401);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.any(String),
      });
    });
  });

  // ==========================================================================
  // POST /api/payment/webhook - Webhook Event Processing
  // ==========================================================================

  describe('POST /api/payment/webhook', () => {
    let paymentIntentId: string;
    let webhookSecret: string;

    /**
     * Setup: Create payment intent and configure webhook secret
     */
    beforeAll(async () => {
      // Set webhook secret for testing
      webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

      const expectedAmount = testProducts.reduce((total, product) => {
        return total + product.price * 2 * 100;
      }, 0);

      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: Math.round(expectedAmount),
          currency: 'usd',
          cartId: testCart.id,
        });

      paymentIntentId = response.body.data.paymentIntentId;
    });

    /**
     * Happy path: Process payment success webhook
     */
    it('should process payment_intent.succeeded webhook event', async () => {
      // Create webhook event payload
      const webhookPayload = {
        id: `evt_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: paymentIntentId,
            object: 'payment_intent',
            amount: 15000,
            currency: 'usd',
            status: 'succeeded',
            payment_method: 'pm_card_visa',
            charges: {
              data: [
                {
                  payment_method_details: {
                    card: {
                      last4: '4242',
                      brand: 'visa',
                    },
                  },
                },
              ],
            },
          },
        },
      };

      // Generate webhook signature
      const signature = stripe.webhooks.generateTestHeaderString({
        payload: JSON.stringify(webhookPayload),
        secret: webhookSecret,
      });

      const response = await request(app)
        .post('/api/payment/webhook')
        .set('stripe-signature', signature)
        .send(webhookPayload)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Webhook processed successfully',
      });

      // Verify payment status updated in database
      const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      });

      expect(payment?.status).toBe('succeeded');
      expect(payment?.paymentMethod).toBe('pm_card_visa');
      expect(payment?.last4).toBe('4242');
      expect(payment?.brand).toBe('visa');
    });

    /**
     * Process payment failure webhook
     */
    it('should process payment_intent.payment_failed webhook event', async () => {
      const webhookPayload = {
        id: `evt_${Date.now()}`,
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: paymentIntentId,
            object: 'payment_intent',
            amount: 15000,
            currency: 'usd',
            status: 'failed',
            last_payment_error: {
              message: 'Your card was declined',
            },
          },
        },
      };

      const signature = stripe.webhooks.generateTestHeaderString({
        payload: JSON.stringify(webhookPayload),
        secret: webhookSecret,
      });

      const response = await request(app)
        .post('/api/payment/webhook')
        .set('stripe-signature', signature)
        .send(webhookPayload)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Webhook processed successfully',
      });

      // Verify payment status updated
      const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      });

      expect(payment?.status).toBe('failed');
    });

    /**
     * Process charge refunded webhook
     */
    it('should process charge.refunded webhook event', async () => {
      const webhookPayload = {
        id: `evt_${Date.now()}`,
        type: 'charge.refunded',
        data: {
          object: {
            id: `ch_${Date.now()}`,
            object: 'charge',
            payment_intent: paymentIntentId,
            amount: 15000,
            refunded: true,
          },
        },
      };

      const signature = stripe.webhooks.generateTestHeaderString({
        payload: JSON.stringify(webhookPayload),
        secret: webhookSecret,
      });

      const response = await request(app)
        .post('/api/payment/webhook')
        .set('stripe-signature', signature)
        .send(webhookPayload)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Webhook processed successfully',
      });

      // Verify payment status updated
      const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      });

      expect(payment?.status).toBe('refunded');
    });

    /**
     * Security: Reject webhook with invalid signature
     */
    it('should reject webhook with invalid signature', async () => {
      const webhookPayload = {
        id: `evt_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: paymentIntentId,
          },
        },
      };

      const response = await request(app)
        .post('/api/payment/webhook')
        .set('stripe-signature', 'invalid_signature')
        .send(webhookPayload)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Invalid signature',
        message: 'Webhook signature verification failed',
      });
    });

    /**
     * Security: Reject webhook without signature
     */
    it('should reject webhook without signature header', async () => {
      const webhookPayload = {
        id: `evt_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: paymentIntentId,
          },
        },
      };

      const response = await request(app)
        .post('/api/payment/webhook')
        .send(webhookPayload)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Missing signature',
        message: 'Stripe signature header is required',
      });
    });

    /**
     * Handle unrecognized webhook event types
     */
    it('should handle unrecognized webhook event types gracefully', async () => {
      const webhookPayload = {
        id: `evt_${Date.now()}`,
        type: 'customer.created',
        data: {
          object: {
            id: 'cus_123',
          },
        },
      };

      const signature = stripe.webhooks.generateTestHeaderString({
        payload: JSON.stringify(webhookPayload),
        secret: webhookSecret,
      });

      const response = await request(app)
        .post('/api/payment/webhook')
        .set('stripe-signature', signature)
        .send(webhookPayload)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Webhook processed successfully',
      });
    });
  });

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe('Performance Tests', () => {
    /**
     * Payment intent creation should complete within acceptable time
     */
    it('should create payment intent within 2 seconds', async () => {
      const expectedAmount = testProducts.reduce((total, product) => {
        return total + product.price * 2 * 100;
      }, 0);

      const startTime = Date.now();

      await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: Math.round(expectedAmount),
          currency: 'usd',
          cartId: testCart.id,
        })
        .expect(201);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000); // 2 seconds
    });

    /**
     * Payment status retrieval should be fast
     */
    it('should retrieve payment status within 500ms', async () => {
      // Create payment intent first
      const expectedAmount = testProducts.reduce((total, product) => {
        return total + product.price * 2 * 100;
      }, 0);

      const createResponse = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: Math.round(expectedAmount),
          currency: 'usd',
          cartId: testCart.id,
        });

      const paymentIntentId = createResponse.body.data.paymentIntentId;

      const startTime = Date.now();

      await request(app)
        .get(`/api/payment/status/${paymentIntentId}`)
        .set('Authorization', testUser.token)
        .expect(200);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500); // 500ms
    });
  });

  // ==========================================================================
  // Concurrent Request Tests
  // ==========================================================================

  describe('Concurrent Request Handling', () => {
    /**
     * Handle multiple concurrent payment intent creations
     */
    it('should handle concurrent payment intent creations', async () => {
      const expectedAmount = testProducts.reduce((total, product) => {
        return total + product.price * 2 * 100;
      }, 0);

      // Create 5 concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/payment/create-intent')
          .set('Authorization', testUser.token)
          .send({
            amount: Math.round(expectedAmount),
            currency: 'usd',
            cartId: testCart.id,
          })
      );

      const responses = await Promise.all(requests);

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      // All payment intents should be unique
      const paymentIntentIds = responses.map((r) => r.body.data.paymentIntentId);
      const uniqueIds = new Set(paymentIntentIds);
      expect(uniqueIds.size).toBe(5);
    });
  });

  // ==========================================================================
  // Edge Cases and Boundary Tests
  // ==========================================================================

  describe('Edge Cases', () => {
    /**
     * Handle very large payment amounts
     */
    it('should handle large payment amounts correctly', async () => {
      // Create cart with high-value products
      const expensiveProduct = await ProductFactory.create(testCategory.id, {
        name: 'Luxury Product',
        price: 999999.99,
      });

      const expensiveCart = await CartFactory.create(testUser.id, [expensiveProduct]);

      const expectedAmount = Math.round(999999.99 * 2 * 100); // 2 items

      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: expectedAmount,
          currency: 'usd',
          cartId: expensiveCart.id,
        })
        .expect(201);

      expect(response.body.data.amount).toBe(expectedAmount);

      // Cleanup
      await prisma.cartItem.deleteMany({ where: { cartId: expensiveCart.id } });
      await prisma.cart.deleteMany({ where: { id: expensiveCart.id } });
      await prisma.inventory.deleteMany({ where: { productId: expensiveProduct.id } });
      await prisma.product.deleteMany({ where: { id: expensiveProduct.id } });
    });

    /**
     * Handle minimum payment amount
     */
    it('should handle minimum payment amount (1 cent)', async () => {
      const cheapProduct = await ProductFactory.create(testCategory.id, {
        name: 'Sample Product',
        price: 0.01,
      });

      const cheapCart = await CartFactory.create(testUser.id, [cheapProduct]);

      const response = await request(app)
        .post('/api/payment/create-intent')
        .set('Authorization', testUser.token)
        .send({
          amount: 2, // 2 cents (2 items * 1 cent)
          currency: 'usd',
          cartId: cheapCart.id,
        })
        .expect(201);

      expect(response.body.data.amount).toBe(2);

      // Cleanup
      await prisma.cartItem.deleteMany({ where: { cartId: cheapCart.id } });
      await prisma.cart.deleteMany({ where: { id: cheapCart.id } });
      await prisma.inventory.deleteMany({ where: { productId: cheapProduct.id } });
      await prisma.product.deleteMany({ where: { id: cheapProduct.id } });
    });

    /**
     * Handle different currency codes
     */
    it('should support multiple currency codes', async () => {
      const currencies = ['usd', 'eur', 'gbp', 'jpy'];

      for (const currency of currencies) {
        const expectedAmount = testProducts.reduce((total, product) => {
          return total + product.price * 2 * 100;
        }, 0);

        const response = await request(app)
          .post('/api/payment/create-intent')
          .set('Authorization', testUser.token)
          .send({
            amount: Math.round(expectedAmount),
            currency,
            cartId: testCart.id,
          })
          .expect(201);

        expect(response.body.data.currency).toBe(currency);
      }
    });
  });
});