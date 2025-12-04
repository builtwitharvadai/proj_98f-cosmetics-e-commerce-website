import { paymentService, PaymentError } from './payment.service';
import { prisma } from '../lib/prisma';
import { stripe } from '../lib/stripe';
import type {
  CreatePaymentIntentInput,
  PaymentIntentResponse,
  PaymentStatus,
  WebhookEvent,
} from '../types/payment.types';

// Mock external dependencies
jest.mock('../lib/prisma', () => ({
  prisma: {
    cart: {
      findUnique: jest.fn(),
    },
    payment: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../lib/stripe', () => ({
  stripe: {
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  },
}));

// Type-safe mock helpers
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockStripe = stripe as jest.Mocked<typeof stripe>;

describe('PaymentService', () => {
  // Test data factories
  const createMockCart = (overrides = {}) => ({
    id: 'cart_123',
    userId: 'user_456',
    items: [
      {
        id: 'item_1',
        quantity: 2,
        priceSnapshot: 25.99,
        product: {
          id: 'prod_1',
          name: 'Lipstick',
          price: 25.99,
        },
      },
      {
        id: 'item_2',
        quantity: 1,
        priceSnapshot: 15.5,
        product: {
          id: 'prod_2',
          name: 'Mascara',
          price: 15.5,
        },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createMockPaymentIntent = (overrides = {}) => ({
    id: 'pi_123456',
    object: 'payment_intent' as const,
    amount: 6748,
    currency: 'usd',
    status: 'requires_payment_method' as const,
    client_secret: 'pi_123456_secret_abc',
    payment_method: null,
    metadata: {
      userId: 'user_456',
      cartId: 'cart_123',
      correlationId: 'pi_test_123',
    },
    automatic_payment_methods: {
      enabled: true,
    },
    charges: {
      data: [],
    },
    ...overrides,
  });

  const createMockPayment = (overrides = {}) => ({
    id: 'payment_1',
    userId: 'user_456',
    cartId: 'cart_123',
    stripePaymentIntentId: 'pi_123456',
    amount: 67.48,
    currency: 'usd',
    status: 'requires_payment_method',
    paymentMethod: null,
    last4: null,
    brand: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    jest.restoreAllMocks();

    // Suppress console logs in tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    // Restore console methods
    jest.restoreAllMocks();
  });

  describe('createPaymentIntent', () => {
    const validInput: CreatePaymentIntentInput = {
      amount: 6748, // $67.48 in cents
      currency: 'usd',
      cartId: 'cart_123',
    };

    const userId = 'user_456';

    describe('✅ Happy Path', () => {
      it('should create payment intent and database record successfully', async () => {
        // Arrange
        const mockCart = createMockCart();
        const mockPaymentIntent = createMockPaymentIntent();
        const mockPayment = createMockPayment();

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
        mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.create.mockResolvedValue(mockPayment as any);

        // Act
        const result = await paymentService.createPaymentIntent(validInput, userId);

        // Assert
        expect(result).toEqual({
          clientSecret: 'pi_123456_secret_abc',
          paymentIntentId: 'pi_123456',
          amount: 6748,
          currency: 'usd',
        });

        // Verify cart was fetched with correct parameters
        expect(mockPrisma.cart.findUnique).toHaveBeenCalledWith({
          where: { id: 'cart_123' },
          include: {
            items: {
              include: {
                product: true,
              },
            },
          },
        });

        // Verify Stripe payment intent was created
        expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
          amount: 6748,
          currency: 'usd',
          metadata: expect.objectContaining({
            userId: 'user_456',
            cartId: 'cart_123',
          }),
          automatic_payment_methods: {
            enabled: true,
          },
        });

        // Verify payment record was created
        expect(mockPrisma.payment.create).toHaveBeenCalledWith({
          data: {
            userId: 'user_456',
            cartId: 'cart_123',
            stripePaymentIntentId: 'pi_123456',
            amount: 67.48,
            currency: 'usd',
            status: 'requires_payment_method',
          },
        });
      });

      it('should handle different currencies correctly', async () => {
        // Arrange
        const eurInput = { ...validInput, currency: 'eur' };
        const mockCart = createMockCart();
        const mockPaymentIntent = createMockPaymentIntent({ currency: 'eur' });
        const mockPayment = createMockPayment({ currency: 'eur' });

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
        mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.create.mockResolvedValue(mockPayment as any);

        // Act
        const result = await paymentService.createPaymentIntent(eurInput, userId);

        // Assert
        expect(result.currency).toBe('eur');
        expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
          expect.objectContaining({
            currency: 'eur',
          })
        );
      });

      it('should include correlation ID in metadata', async () => {
        // Arrange
        const mockCart = createMockCart();
        const mockPaymentIntent = createMockPaymentIntent();
        const mockPayment = createMockPayment();

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
        mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.create.mockResolvedValue(mockPayment as any);

        // Act
        await paymentService.createPaymentIntent(validInput, userId);

        // Assert
        expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              correlationId: expect.stringMatching(/^pi_\d+_[a-z0-9]+$/),
            }),
          })
        );
      });
    });

    describe('❌ Input Validation', () => {
      it('should reject zero amount', async () => {
        // Arrange
        const invalidInput = { ...validInput, amount: 0 };

        // Act & Assert
        await expect(paymentService.createPaymentIntent(invalidInput, userId)).rejects.toThrow(
          PaymentError
        );
        await expect(
          paymentService.createPaymentIntent(invalidInput, userId)
        ).rejects.toMatchObject({
          code: 'INVALID_AMOUNT',
          statusCode: 400,
          message: 'Payment amount must be greater than zero',
        });
      });

      it('should reject negative amount', async () => {
        // Arrange
        const invalidInput = { ...validInput, amount: -100 };

        // Act & Assert
        await expect(paymentService.createPaymentIntent(invalidInput, userId)).rejects.toThrow(
          PaymentError
        );
      });

      it('should reject invalid currency code (too short)', async () => {
        // Arrange
        const invalidInput = { ...validInput, currency: 'us' };

        // Act & Assert
        await expect(paymentService.createPaymentIntent(invalidInput, userId)).rejects.toThrow(
          PaymentError
        );
        await expect(
          paymentService.createPaymentIntent(invalidInput, userId)
        ).rejects.toMatchObject({
          code: 'INVALID_CURRENCY',
          statusCode: 400,
          message: 'Invalid currency code. Must be a valid ISO 4217 currency code',
        });
      });

      it('should reject invalid currency code (too long)', async () => {
        // Arrange
        const invalidInput = { ...validInput, currency: 'usdd' };

        // Act & Assert
        await expect(paymentService.createPaymentIntent(invalidInput, userId)).rejects.toThrow(
          PaymentError
        );
      });

      it('should reject empty currency code', async () => {
        // Arrange
        const invalidInput = { ...validInput, currency: '' };

        // Act & Assert
        await expect(paymentService.createPaymentIntent(invalidInput, userId)).rejects.toThrow(
          PaymentError
        );
      });
    });

    describe('🛡️ Cart Validation', () => {
      it('should reject non-existent cart', async () => {
        // Arrange
        mockPrisma.cart.findUnique.mockResolvedValue(null);

        // Act & Assert
        await expect(paymentService.createPaymentIntent(validInput, userId)).rejects.toThrow(
          PaymentError
        );
        await expect(
          paymentService.createPaymentIntent(validInput, userId)
        ).rejects.toMatchObject({
          code: 'CART_NOT_FOUND',
          statusCode: 404,
          message: 'Cart not found',
        });
      });

      it('should reject cart belonging to different user', async () => {
        // Arrange
        const mockCart = createMockCart({ userId: 'different_user' });
        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);

        // Act & Assert
        await expect(paymentService.createPaymentIntent(validInput, userId)).rejects.toThrow(
          PaymentError
        );
        await expect(
          paymentService.createPaymentIntent(validInput, userId)
        ).rejects.toMatchObject({
          code: 'UNAUTHORIZED_CART_ACCESS',
          statusCode: 403,
          message: 'Cart does not belong to the authenticated user',
        });
      });

      it('should reject empty cart', async () => {
        // Arrange
        const mockCart = createMockCart({ items: [] });
        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);

        // Act & Assert
        await expect(paymentService.createPaymentIntent(validInput, userId)).rejects.toThrow(
          PaymentError
        );
        await expect(
          paymentService.createPaymentIntent(validInput, userId)
        ).rejects.toMatchObject({
          code: 'EMPTY_CART',
          statusCode: 400,
          message: 'Cannot create payment for empty cart',
        });
      });

      it('should reject amount mismatch with cart total', async () => {
        // Arrange
        const mockCart = createMockCart();
        const wrongInput = { ...validInput, amount: 5000 }; // Different from cart total
        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);

        // Act & Assert
        await expect(paymentService.createPaymentIntent(wrongInput, userId)).rejects.toThrow(
          PaymentError
        );
        await expect(
          paymentService.createPaymentIntent(wrongInput, userId)
        ).rejects.toMatchObject({
          code: 'AMOUNT_MISMATCH',
          statusCode: 400,
          message: 'Provided amount does not match cart total',
        });
      });

      it('should allow amount within 1 cent tolerance', async () => {
        // Arrange
        const mockCart = createMockCart();
        const slightlyOffInput = { ...validInput, amount: 6749 }; // 1 cent off
        const mockPaymentIntent = createMockPaymentIntent({ amount: 6749 });
        const mockPayment = createMockPayment();

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
        mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.create.mockResolvedValue(mockPayment as any);

        // Act
        const result = await paymentService.createPaymentIntent(slightlyOffInput, userId);

        // Assert
        expect(result).toBeDefined();
        expect(result.amount).toBe(6749);
      });
    });

    describe('💥 Stripe API Error Handling', () => {
      it('should handle Stripe API errors gracefully', async () => {
        // Arrange
        const mockCart = createMockCart();
        const stripeError = {
          type: 'StripeCardError',
          message: 'Your card was declined',
          code: 'card_declined',
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
        mockStripe.paymentIntents.create.mockRejectedValue(stripeError);

        // Act & Assert
        await expect(paymentService.createPaymentIntent(validInput, userId)).rejects.toThrow(
          PaymentError
        );
        await expect(
          paymentService.createPaymentIntent(validInput, userId)
        ).rejects.toMatchObject({
          code: 'STRIPE_API_ERROR',
          statusCode: 500,
          message: expect.stringContaining('Your card was declined'),
        });
      });

      it('should handle Stripe rate limit errors', async () => {
        // Arrange
        const mockCart = createMockCart();
        const stripeError = {
          type: 'StripeRateLimitError',
          message: 'Too many requests',
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
        mockStripe.paymentIntents.create.mockRejectedValue(stripeError);

        // Act & Assert
        await expect(paymentService.createPaymentIntent(validInput, userId)).rejects.toThrow(
          PaymentError
        );
      });

      it('should handle Stripe authentication errors', async () => {
        // Arrange
        const mockCart = createMockCart();
        const stripeError = {
          type: 'StripeAuthenticationError',
          message: 'Invalid API key',
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
        mockStripe.paymentIntents.create.mockRejectedValue(stripeError);

        // Act & Assert
        await expect(paymentService.createPaymentIntent(validInput, userId)).rejects.toThrow(
          PaymentError
        );
      });
    });

    describe('💥 Database Error Handling', () => {
      it('should handle database connection errors', async () => {
        // Arrange
        mockPrisma.cart.findUnique.mockRejectedValue(new Error('Database connection failed'));

        // Act & Assert
        await expect(paymentService.createPaymentIntent(validInput, userId)).rejects.toThrow(
          PaymentError
        );
        await expect(
          paymentService.createPaymentIntent(validInput, userId)
        ).rejects.toMatchObject({
          code: 'INTERNAL_ERROR',
          statusCode: 500,
        });
      });

      it('should handle payment record creation failure', async () => {
        // Arrange
        const mockCart = createMockCart();
        const mockPaymentIntent = createMockPaymentIntent();

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
        mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.create.mockRejectedValue(new Error('Database write failed'));

        // Act & Assert
        await expect(paymentService.createPaymentIntent(validInput, userId)).rejects.toThrow(
          PaymentError
        );
      });
    });

    describe('⚡ Performance & Edge Cases', () => {
      it('should handle large cart amounts correctly', async () => {
        // Arrange
        const largeCart = createMockCart({
          items: [
            {
              id: 'item_1',
              quantity: 100,
              priceSnapshot: 999.99,
              product: { id: 'prod_1', name: 'Expensive Item', price: 999.99 },
            },
          ],
        });
        const largeAmount = 9999900; // $99,999.00 in cents
        const largeInput = { ...validInput, amount: largeAmount };
        const mockPaymentIntent = createMockPaymentIntent({ amount: largeAmount });
        const mockPayment = createMockPayment();

        mockPrisma.cart.findUnique.mockResolvedValue(largeCart as any);
        mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.create.mockResolvedValue(mockPayment as any);

        // Act
        const result = await paymentService.createPaymentIntent(largeInput, userId);

        // Assert
        expect(result.amount).toBe(largeAmount);
      });

      it('should handle decimal precision correctly', async () => {
        // Arrange
        const precisionCart = createMockCart({
          items: [
            {
              id: 'item_1',
              quantity: 3,
              priceSnapshot: 10.33,
              product: { id: 'prod_1', name: 'Item', price: 10.33 },
            },
          ],
        });
        const preciseAmount = 3099; // $30.99 in cents
        const preciseInput = { ...validInput, amount: preciseAmount };
        const mockPaymentIntent = createMockPaymentIntent({ amount: preciseAmount });
        const mockPayment = createMockPayment();

        mockPrisma.cart.findUnique.mockResolvedValue(precisionCart as any);
        mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.create.mockResolvedValue(mockPayment as any);

        // Act
        const result = await paymentService.createPaymentIntent(preciseInput, userId);

        // Assert
        expect(result.amount).toBe(preciseAmount);
      });

      it('should complete within acceptable time limit', async () => {
        // Arrange
        const mockCart = createMockCart();
        const mockPaymentIntent = createMockPaymentIntent();
        const mockPayment = createMockPayment();

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
        mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.create.mockResolvedValue(mockPayment as any);

        // Act
        const startTime = Date.now();
        await paymentService.createPaymentIntent(validInput, userId);
        const duration = Date.now() - startTime;

        // Assert - Should complete in under 1 second
        expect(duration).toBeLessThan(1000);
      });
    });
  });

  describe('confirmPayment', () => {
    const paymentIntentId = 'pi_123456';

    describe('✅ Happy Path', () => {
      it('should confirm payment and update status successfully', async () => {
        // Arrange
        const mockPaymentIntent = createMockPaymentIntent({
          status: 'succeeded',
          payment_method: 'pm_123',
        });
        const mockPayment = createMockPayment({ status: 'succeeded' });

        mockStripe.paymentIntents.retrieve.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.update.mockResolvedValue(mockPayment as any);

        // Act
        const result = await paymentService.confirmPayment(paymentIntentId);

        // Assert
        expect(result).toEqual({
          status: 'succeeded',
          paymentIntentId: 'pi_123456',
          amount: 6748,
          currency: 'usd',
        });

        expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith(paymentIntentId);
        expect(mockPrisma.payment.update).toHaveBeenCalledWith({
          where: { stripePaymentIntentId: paymentIntentId },
          data: {
            status: 'succeeded',
            paymentMethod: 'pm_123',
            updatedAt: expect.any(Date),
          },
        });
      });

      it('should handle requires_action status', async () => {
        // Arrange
        const mockPaymentIntent = createMockPaymentIntent({
          status: 'requires_action',
        });
        const mockPayment = createMockPayment({ status: 'requires_action' });

        mockStripe.paymentIntents.retrieve.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.update.mockResolvedValue(mockPayment as any);

        // Act
        const result = await paymentService.confirmPayment(paymentIntentId);

        // Assert
        expect(result.status).toBe('requires_action');
      });

      it('should handle processing status', async () => {
        // Arrange
        const mockPaymentIntent = createMockPaymentIntent({
          status: 'processing',
        });
        const mockPayment = createMockPayment({ status: 'processing' });

        mockStripe.paymentIntents.retrieve.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.update.mockResolvedValue(mockPayment as any);

        // Act
        const result = await paymentService.confirmPayment(paymentIntentId);

        // Assert
        expect(result.status).toBe('processing');
      });
    });

    describe('❌ Error Handling', () => {
      it('should handle Stripe API errors', async () => {
        // Arrange
        const stripeError = {
          type: 'StripeInvalidRequestError',
          message: 'No such payment_intent',
        };

        mockStripe.paymentIntents.retrieve.mockRejectedValue(stripeError);

        // Act & Assert
        await expect(paymentService.confirmPayment(paymentIntentId)).rejects.toThrow(
          PaymentError
        );
        await expect(paymentService.confirmPayment(paymentIntentId)).rejects.toMatchObject({
          code: 'STRIPE_API_ERROR',
          statusCode: 500,
        });
      });

      it('should handle database update errors', async () => {
        // Arrange
        const mockPaymentIntent = createMockPaymentIntent({ status: 'succeeded' });

        mockStripe.paymentIntents.retrieve.mockResolvedValue(mockPaymentIntent as any);
        mockPrisma.payment.update.mockRejectedValue(new Error('Database update failed'));

        // Act & Assert
        await expect(paymentService.confirmPayment(paymentIntentId)).rejects.toThrow(
          PaymentError
        );
      });

      it('should handle unexpected errors', async () => {
        // Arrange
        mockStripe.paymentIntents.retrieve.mockRejectedValue(new Error('Unexpected error'));

        // Act & Assert
        await expect(paymentService.confirmPayment(paymentIntentId)).rejects.toThrow(
          PaymentError
        );
        await expect(paymentService.confirmPayment(paymentIntentId)).rejects.toMatchObject({
          code: 'INTERNAL_ERROR',
          statusCode: 500,
        });
      });
    });
  });

  describe('handleWebhookEvent', () => {
    describe('✅ payment_intent.succeeded', () => {
      it('should process successful payment webhook', async () => {
        // Arrange
        const event: WebhookEvent = {
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: 'pi_123456',
              status: 'succeeded',
              payment_method: 'pm_123',
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

        const mockPayment = createMockPayment({
          status: 'succeeded',
          last4: '4242',
          brand: 'visa',
        });

        mockPrisma.payment.update.mockResolvedValue(mockPayment as any);

        // Act
        await paymentService.handleWebhookEvent(event);

        // Assert
        expect(mockPrisma.payment.update).toHaveBeenCalledWith({
          where: { stripePaymentIntentId: 'pi_123456' },
          data: {
            status: 'succeeded',
            paymentMethod: 'pm_123',
            last4: '4242',
            brand: 'visa',
            updatedAt: expect.any(Date),
          },
        });
      });

      it('should handle missing card details gracefully', async () => {
        // Arrange
        const event: WebhookEvent = {
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: 'pi_123456',
              status: 'succeeded',
              payment_method: 'pm_123',
              charges: {
                data: [],
              },
            },
          },
        };

        const mockPayment = createMockPayment({ status: 'succeeded' });
        mockPrisma.payment.update.mockResolvedValue(mockPayment as any);

        // Act
        await paymentService.handleWebhookEvent(event);

        // Assert
        expect(mockPrisma.payment.update).toHaveBeenCalledWith({
          where: { stripePaymentIntentId: 'pi_123456' },
          data: {
            status: 'succeeded',
            paymentMethod: 'pm_123',
            last4: null,
            brand: null,
            updatedAt: expect.any(Date),
          },
        });
      });
    });

    describe('❌ payment_intent.payment_failed', () => {
      it('should process failed payment webhook', async () => {
        // Arrange
        const event: WebhookEvent = {
          type: 'payment_intent.payment_failed',
          data: {
            object: {
              id: 'pi_123456',
              status: 'failed',
              last_payment_error: {
                message: 'Your card was declined',
              },
            },
          },
        };

        const mockPayment = createMockPayment({ status: 'failed' });
        mockPrisma.payment.update.mockResolvedValue(mockPayment as any);

        // Act
        await paymentService.handleWebhookEvent(event);

        // Assert
        expect(mockPrisma.payment.update).toHaveBeenCalledWith({
          where: { stripePaymentIntentId: 'pi_123456' },
          data: {
            status: 'failed',
            updatedAt: expect.any(Date),
          },
        });
      });

      it('should handle missing error message', async () => {
        // Arrange
        const event: WebhookEvent = {
          type: 'payment_intent.payment_failed',
          data: {
            object: {
              id: 'pi_123456',
              status: 'failed',
            },
          },
        };

        const mockPayment = createMockPayment({ status: 'failed' });
        mockPrisma.payment.update.mockResolvedValue(mockPayment as any);

        // Act
        await paymentService.handleWebhookEvent(event);

        // Assert
        expect(mockPrisma.payment.update).toHaveBeenCalled();
      });
    });

    describe('🔄 charge.refunded', () => {
      it('should process refund webhook', async () => {
        // Arrange
        const event: WebhookEvent = {
          type: 'charge.refunded',
          data: {
            object: {
              id: 'ch_123456',
              payment_intent: 'pi_123456',
            },
          },
        };

        const mockPayment = createMockPayment({ status: 'refunded' });
        mockPrisma.payment.update.mockResolvedValue(mockPayment as any);

        // Act
        await paymentService.handleWebhookEvent(event);

        // Assert
        expect(mockPrisma.payment.update).toHaveBeenCalledWith({
          where: { stripePaymentIntentId: 'pi_123456' },
          data: {
            status: 'refunded',
            updatedAt: expect.any(Date),
          },
        });
      });
    });

    describe('🔇 Unhandled Events', () => {
      it('should log unhandled event types without error', async () => {
        // Arrange
        const event: WebhookEvent = {
          type: 'customer.created' as any,
          data: {
            object: {
              id: 'cus_123456',
            },
          },
        };

        // Act
        await paymentService.handleWebhookEvent(event);

        // Assert - Should not throw error
        expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      });
    });

    describe('💥 Error Handling', () => {
      it('should handle database errors during webhook processing', async () => {
        // Arrange
        const event: WebhookEvent = {
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: 'pi_123456',
              status: 'succeeded',
              payment_method: 'pm_123',
              charges: { data: [] },
            },
          },
        };

        mockPrisma.payment.update.mockRejectedValue(new Error('Database error'));

        // Act & Assert
        await expect(paymentService.handleWebhookEvent(event)).rejects.toThrow(PaymentError);
        await expect(paymentService.handleWebhookEvent(event)).rejects.toMatchObject({
          code: 'WEBHOOK_PROCESSING_ERROR',
          statusCode: 500,
        });
      });
    });
  });

  describe('getPaymentStatus', () => {
    const paymentIntentId = 'pi_123456';

    describe('✅ Happy Path', () => {
      it('should retrieve payment status successfully', async () => {
        // Arrange
        const mockPayment = createMockPayment({
          status: 'succeeded',
          amount: 67.48,
        });

        mockPrisma.payment.findUnique.mockResolvedValue(mockPayment as any);

        // Act
        const result = await paymentService.getPaymentStatus(paymentIntentId);

        // Assert
        expect(result).toEqual({
          status: 'succeeded',
          paymentIntentId: 'pi_123456',
          amount: 6748, // Converted to cents
          currency: 'usd',
        });

        expect(mockPrisma.payment.findUnique).toHaveBeenCalledWith({
          where: { stripePaymentIntentId: paymentIntentId },
        });
      });

      it('should handle different payment statuses', async () => {
        // Arrange
        const statuses = ['requires_payment_method', 'processing', 'succeeded', 'failed'];

        for (const status of statuses) {
          const mockPayment = createMockPayment({ status });
          mockPrisma.payment.findUnique.mockResolvedValue(mockPayment as any);

          // Act
          const result = await paymentService.getPaymentStatus(paymentIntentId);

          // Assert
          expect(result.status).toBe(status);
        }
      });

      it('should convert amount to cents correctly', async () => {
        // Arrange
        const mockPayment = createMockPayment({ amount: 123.45 });
        mockPrisma.payment.findUnique.mockResolvedValue(mockPayment as any);

        // Act
        const result = await paymentService.getPaymentStatus(paymentIntentId);

        // Assert
        expect(result.amount).toBe(12345);
      });
    });

    describe('❌ Error Handling', () => {
      it('should throw error when payment not found', async () => {
        // Arrange
        mockPrisma.payment.findUnique.mockResolvedValue(null);

        // Act & Assert
        await expect(paymentService.getPaymentStatus(paymentIntentId)).rejects.toThrow(
          PaymentError
        );
        await expect(paymentService.getPaymentStatus(paymentIntentId)).rejects.toMatchObject({
          code: 'PAYMENT_NOT_FOUND',
          statusCode: 404,
          message: 'Payment not found',
        });
      });

      it('should handle database errors', async () => {
        // Arrange
        mockPrisma.payment.findUnique.mockRejectedValue(new Error('Database error'));

        // Act & Assert
        await expect(paymentService.getPaymentStatus(paymentIntentId)).rejects.toThrow(
          PaymentError
        );
        await expect(paymentService.getPaymentStatus(paymentIntentId)).rejects.toMatchObject({
          code: 'INTERNAL_ERROR',
          statusCode: 500,
        });
      });
    });
  });

  describe('PaymentError', () => {
    it('should create error with correct properties', () => {
      // Act
      const error = new PaymentError('Test error', 'TEST_CODE', 400);

      // Assert
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PaymentError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('PaymentError');
    });

    it('should use default status code when not provided', () => {
      // Act
      const error = new PaymentError('Test error', 'TEST_CODE');

      // Assert
      expect(error.statusCode).toBe(400);
    });

    it('should maintain prototype chain', () => {
      // Act
      const error = new PaymentError('Test error', 'TEST_CODE');

      // Assert
      expect(Object.getPrototypeOf(error)).toBe(PaymentError.prototype);
    });
  });

  describe('🔒 Security Tests', () => {
    it('should not expose sensitive data in error messages', async () => {
      // Arrange
      const mockCart = createMockCart();
      const stripeError = {
        type: 'StripeCardError',
        message: 'Card number: 4242424242424242 was declined',
      };

      mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
      mockStripe.paymentIntents.create.mockRejectedValue(stripeError);

      // Act & Assert
      try {
        await paymentService.createPaymentIntent(
          {
            amount: 6748,
            currency: 'usd',
            cartId: 'cart_123',
          },
          'user_456'
        );
      } catch (error) {
        if (error instanceof PaymentError) {
          // Error message should not contain full card number
          expect(error.message).not.toMatch(/\d{16}/);
        }
      }
    });

    it('should validate user authorization for cart access', async () => {
      // Arrange
      const mockCart = createMockCart({ userId: 'other_user' });
      mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);

      // Act & Assert
      await expect(
        paymentService.createPaymentIntent(
          {
            amount: 6748,
            currency: 'usd',
            cartId: 'cart_123',
          },
          'user_456'
        )
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED_CART_ACCESS',
        statusCode: 403,
      });
    });
  });

  describe('📊 Logging & Observability', () => {
    it('should log correlation IDs for tracing', async () => {
      // Arrange
      const mockCart = createMockCart();
      const mockPaymentIntent = createMockPaymentIntent();
      const mockPayment = createMockPayment();
      const consoleSpy = jest.spyOn(console, 'log');

      mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
      mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent as any);
      mockPrisma.payment.create.mockResolvedValue(mockPayment as any);

      // Act
      await paymentService.createPaymentIntent(
        {
          amount: 6748,
          currency: 'usd',
          cartId: 'cart_123',
        },
        'user_456'
      );

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PaymentService]'),
        expect.objectContaining({
          correlationId: expect.any(String),
        })
      );
    });

    it('should log errors with context', async () => {
      // Arrange
      const consoleErrorSpy = jest.spyOn(console, 'error');
      mockPrisma.cart.findUnique.mockRejectedValue(new Error('Database error'));

      // Act
      try {
        await paymentService.createPaymentIntent(
          {
            amount: 6748,
            currency: 'usd',
            cartId: 'cart_123',
          },
          'user_456'
        );
      } catch {
        // Expected error
      }

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PaymentService]'),
        expect.objectContaining({
          correlationId: expect.any(String),
          duration: expect.any(Number),
        })
      );
    });
  });

  describe('⚡ Performance Tests', () => {
    it('should handle concurrent payment intent creations', async () => {
      // Arrange
      const mockCart = createMockCart();
      const mockPaymentIntent = createMockPaymentIntent();
      const mockPayment = createMockPayment();

      mockPrisma.cart.findUnique.mockResolvedValue(mockCart as any);
      mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent as any);
      mockPrisma.payment.create.mockResolvedValue(mockPayment as any);

      // Act
      const promises = Array.from({ length: 10 }, (_, i) =>
        paymentService.createPaymentIntent(
          {
            amount: 6748,
            currency: 'usd',
            cartId: `cart_${i}`,
          },
          `user_${i}`
        )
      );

      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result).toHaveProperty('clientSecret');
        expect(result).toHaveProperty('paymentIntentId');
      });
    });

    it('should complete payment status check quickly', async () => {
      // Arrange
      const mockPayment = createMockPayment();
      mockPrisma.payment.findUnique.mockResolvedValue(mockPayment as any);

      // Act
      const startTime = Date.now();
      await paymentService.getPaymentStatus('pi_123456');
      const duration = Date.now() - startTime;

      // Assert - Should complete in under 100ms
      expect(duration).toBeLessThan(100);
    });
  });
});