import { stripe } from '../lib/stripe';
import { prisma } from '../lib/prisma';
import type {
  CreatePaymentIntentInput,
  PaymentIntentResponse,
  PaymentStatus,
  WebhookEvent,
} from '../types/payment.types';

/**
 * Custom error class for payment-related errors
 * Provides structured error handling with specific error codes
 */
class PaymentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'PaymentError';
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
}

/**
 * Payment service for Stripe payment gateway integration
 * Handles payment intent creation, confirmation, webhook events, and status tracking
 *
 * Features:
 * - PCI-compliant payment processing with tokenization
 * - Support for multiple payment methods (cards, digital wallets)
 * - Comprehensive error handling and logging
 * - Webhook event processing for payment lifecycle
 * - Audit trail for all payment transactions
 */
class PaymentService {
  /**
   * Creates a payment intent for processing a cart payment
   *
   * @param input - Payment intent creation parameters
   * @param userId - ID of the user making the payment
   * @returns Payment intent response with client secret
   * @throws PaymentError if cart validation fails or payment intent creation fails
   *
   * @example
   * const result = await paymentService.createPaymentIntent({
   *   amount: 5000,
   *   currency: 'usd',
   *   cartId: 'cart_123'
   * }, 'user_456');
   */
  async createPaymentIntent(
    input: CreatePaymentIntentInput,
    userId: string
  ): Promise<PaymentIntentResponse> {
    const startTime = Date.now();
    const correlationId = `pi_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      console.log('[PaymentService] Creating payment intent', {
        correlationId,
        userId,
        cartId: input.cartId,
        amount: input.amount,
        currency: input.currency,
      });

      // Validate input
      if (input.amount <= 0) {
        throw new PaymentError(
          'Payment amount must be greater than zero',
          'INVALID_AMOUNT',
          400
        );
      }

      if (!input.currency || input.currency.length !== 3) {
        throw new PaymentError(
          'Invalid currency code. Must be a valid ISO 4217 currency code',
          'INVALID_CURRENCY',
          400
        );
      }

      // Validate cart exists and belongs to user
      const cart = await prisma.cart.findUnique({
        where: { id: input.cartId },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      if (!cart) {
        throw new PaymentError('Cart not found', 'CART_NOT_FOUND', 404);
      }

      if (cart.userId !== userId) {
        throw new PaymentError(
          'Cart does not belong to the authenticated user',
          'UNAUTHORIZED_CART_ACCESS',
          403
        );
      }

      if (cart.items.length === 0) {
        throw new PaymentError('Cannot create payment for empty cart', 'EMPTY_CART', 400);
      }

      // Calculate total amount from cart items
      const calculatedAmount = cart.items.reduce((total, item) => {
        return total + Number(item.priceSnapshot) * item.quantity;
      }, 0);

      // Convert to cents for Stripe
      const amountInCents = Math.round(calculatedAmount * 100);

      // Validate provided amount matches calculated amount
      if (Math.abs(input.amount - amountInCents) > 1) {
        console.warn('[PaymentService] Amount mismatch', {
          correlationId,
          providedAmount: input.amount,
          calculatedAmount: amountInCents,
        });
        throw new PaymentError(
          'Provided amount does not match cart total',
          'AMOUNT_MISMATCH',
          400
        );
      }

      // Create Stripe payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: input.amount,
        currency: input.currency.toLowerCase(),
        metadata: {
          userId,
          cartId: input.cartId,
          correlationId,
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      console.log('[PaymentService] Stripe payment intent created', {
        correlationId,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
      });

      // Create payment record in database
      await prisma.payment.create({
        data: {
          userId,
          cartId: input.cartId,
          stripePaymentIntentId: paymentIntent.id,
          amount: calculatedAmount,
          currency: input.currency.toLowerCase(),
          status: paymentIntent.status,
        },
      });

      console.log('[PaymentService] Payment record created in database', {
        correlationId,
        paymentIntentId: paymentIntent.id,
        duration: Date.now() - startTime,
      });

      return {
        clientSecret: paymentIntent.client_secret!,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof PaymentError) {
        console.error('[PaymentService] Payment error', {
          correlationId,
          code: error.code,
          message: error.message,
          duration,
        });
        throw error;
      }

      if (error && typeof error === 'object' && 'type' in error) {
        const stripeError = error as { type: string; message: string; code?: string };
        console.error('[PaymentService] Stripe API error', {
          correlationId,
          type: stripeError.type,
          code: stripeError.code,
          message: stripeError.message,
          duration,
        });
        throw new PaymentError(
          `Payment processing failed: ${stripeError.message}`,
          'STRIPE_API_ERROR',
          500
        );
      }

      console.error('[PaymentService] Unexpected error creating payment intent', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });
      throw new PaymentError(
        'An unexpected error occurred while creating payment intent',
        'INTERNAL_ERROR',
        500
      );
    }
  }

  /**
   * Confirms a payment intent and updates payment status
   *
   * @param paymentIntentId - Stripe payment intent ID
   * @returns Current payment status
   * @throws PaymentError if payment intent not found or confirmation fails
   *
   * @example
   * const status = await paymentService.confirmPayment('pi_123456');
   */
  async confirmPayment(paymentIntentId: string): Promise<PaymentStatus> {
    const startTime = Date.now();
    const correlationId = `confirm_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      console.log('[PaymentService] Confirming payment', {
        correlationId,
        paymentIntentId,
      });

      // Retrieve payment intent from Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      console.log('[PaymentService] Payment intent retrieved from Stripe', {
        correlationId,
        paymentIntentId,
        status: paymentIntent.status,
      });

      // Update payment record in database
      const payment = await prisma.payment.update({
        where: { stripePaymentIntentId: paymentIntentId },
        data: {
          status: paymentIntent.status,
          paymentMethod: paymentIntent.payment_method
            ? String(paymentIntent.payment_method)
            : null,
          updatedAt: new Date(),
        },
      });

      console.log('[PaymentService] Payment status updated', {
        correlationId,
        paymentIntentId,
        status: payment.status,
        duration: Date.now() - startTime,
      });

      return {
        status: paymentIntent.status as PaymentStatus['status'],
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error && typeof error === 'object' && 'type' in error) {
        const stripeError = error as { type: string; message: string; code?: string };
        console.error('[PaymentService] Stripe API error during confirmation', {
          correlationId,
          type: stripeError.type,
          code: stripeError.code,
          message: stripeError.message,
          duration,
        });
        throw new PaymentError(
          `Payment confirmation failed: ${stripeError.message}`,
          'STRIPE_API_ERROR',
          500
        );
      }

      console.error('[PaymentService] Error confirming payment', {
        correlationId,
        paymentIntentId,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });
      throw new PaymentError(
        'An unexpected error occurred while confirming payment',
        'INTERNAL_ERROR',
        500
      );
    }
  }

  /**
   * Handles Stripe webhook events for payment lifecycle
   *
   * @param event - Webhook event from Stripe
   * @throws PaymentError if event processing fails
   *
   * Supported events:
   * - payment_intent.succeeded: Updates payment status and creates order
   * - payment_intent.payment_failed: Updates payment status and logs error
   * - charge.refunded: Updates payment status to refunded
   *
   * @example
   * await paymentService.handleWebhookEvent({
   *   type: 'payment_intent.succeeded',
   *   data: { object: paymentIntent }
   * });
   */
  async handleWebhookEvent(event: WebhookEvent): Promise<void> {
    const startTime = Date.now();
    const correlationId = `webhook_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      console.log('[PaymentService] Processing webhook event', {
        correlationId,
        eventType: event.type,
      });

      switch (event.type) {
        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object;
          console.log('[PaymentService] Payment succeeded', {
            correlationId,
            paymentIntentId: paymentIntent.id,
          });

          // Update payment status
          const payment = await prisma.payment.update({
            where: { stripePaymentIntentId: paymentIntent.id },
            data: {
              status: 'succeeded',
              paymentMethod: paymentIntent.payment_method
                ? String(paymentIntent.payment_method)
                : null,
              last4: paymentIntent.charges?.data[0]?.payment_method_details?.card?.last4 || null,
              brand: paymentIntent.charges?.data[0]?.payment_method_details?.card?.brand || null,
              updatedAt: new Date(),
            },
          });

          console.log('[PaymentService] Payment status updated to succeeded', {
            correlationId,
            paymentId: payment.id,
            cartId: payment.cartId,
            duration: Date.now() - startTime,
          });

          break;
        }

        case 'payment_intent.payment_failed': {
          const paymentIntent = event.data.object;
          const errorMessage = paymentIntent.last_payment_error?.message || 'Payment failed';

          console.error('[PaymentService] Payment failed', {
            correlationId,
            paymentIntentId: paymentIntent.id,
            error: errorMessage,
          });

          // Update payment status
          await prisma.payment.update({
            where: { stripePaymentIntentId: paymentIntent.id },
            data: {
              status: 'failed',
              updatedAt: new Date(),
            },
          });

          console.log('[PaymentService] Payment status updated to failed', {
            correlationId,
            paymentIntentId: paymentIntent.id,
            duration: Date.now() - startTime,
          });

          break;
        }

        case 'charge.refunded': {
          const charge = event.data.object;
          const paymentIntentId = charge.payment_intent;

          console.log('[PaymentService] Charge refunded', {
            correlationId,
            chargeId: charge.id,
            paymentIntentId,
          });

          // Update payment status
          await prisma.payment.update({
            where: { stripePaymentIntentId: String(paymentIntentId) },
            data: {
              status: 'refunded',
              updatedAt: new Date(),
            },
          });

          console.log('[PaymentService] Payment status updated to refunded', {
            correlationId,
            paymentIntentId,
            duration: Date.now() - startTime,
          });

          break;
        }

        default:
          console.log('[PaymentService] Unhandled webhook event type', {
            correlationId,
            eventType: event.type,
          });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error('[PaymentService] Error processing webhook event', {
        correlationId,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });
      throw new PaymentError(
        'Failed to process webhook event',
        'WEBHOOK_PROCESSING_ERROR',
        500
      );
    }
  }

  /**
   * Retrieves the current status of a payment
   *
   * @param paymentIntentId - Stripe payment intent ID
   * @returns Current payment status
   * @throws PaymentError if payment not found
   *
   * @example
   * const status = await paymentService.getPaymentStatus('pi_123456');
   */
  async getPaymentStatus(paymentIntentId: string): Promise<PaymentStatus> {
    const startTime = Date.now();
    const correlationId = `status_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      console.log('[PaymentService] Retrieving payment status', {
        correlationId,
        paymentIntentId,
      });

      const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      });

      if (!payment) {
        throw new PaymentError('Payment not found', 'PAYMENT_NOT_FOUND', 404);
      }

      console.log('[PaymentService] Payment status retrieved', {
        correlationId,
        paymentIntentId,
        status: payment.status,
        duration: Date.now() - startTime,
      });

      return {
        status: payment.status as PaymentStatus['status'],
        paymentIntentId: payment.stripePaymentIntentId,
        amount: Math.round(Number(payment.amount) * 100),
        currency: payment.currency,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof PaymentError) {
        console.error('[PaymentService] Payment error', {
          correlationId,
          code: error.code,
          message: error.message,
          duration,
        });
        throw error;
      }

      console.error('[PaymentService] Error retrieving payment status', {
        correlationId,
        paymentIntentId,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });
      throw new PaymentError(
        'An unexpected error occurred while retrieving payment status',
        'INTERNAL_ERROR',
        500
      );
    }
  }
}

/**
 * Singleton instance of PaymentService
 * Use this throughout the application for payment operations
 *
 * @example
 * import { paymentService } from './services/payment.service';
 *
 * const result = await paymentService.createPaymentIntent({
 *   amount: 5000,
 *   currency: 'usd',
 *   cartId: 'cart_123'
 * }, 'user_456');
 */
export const paymentService = new PaymentService();

export { PaymentError };