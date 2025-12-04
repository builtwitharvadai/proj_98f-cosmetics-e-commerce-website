import { Router, Request, Response, NextFunction } from 'express';
import { paymentService } from '../services/payment.service';
import { authenticate } from '../middleware/auth';
import { stripe } from '../lib/stripe';
import type {
  CreatePaymentIntentInput,
  PaymentIntentResponse,
  PaymentStatus,
} from '../types/payment.types';

const router = Router();

/**
 * Validation error class for request validation failures
 */
class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Validates payment intent creation input
 * @param body - Request body to validate
 * @throws ValidationError if validation fails
 */
function validateCreatePaymentIntentInput(body: any): CreatePaymentIntentInput {
  if (!body.amount || typeof body.amount !== 'number') {
    throw new ValidationError('Amount is required and must be a number', 'amount');
  }

  if (body.amount <= 0) {
    throw new ValidationError('Amount must be greater than zero', 'amount');
  }

  if (!Number.isInteger(body.amount)) {
    throw new ValidationError('Amount must be an integer (smallest currency unit)', 'amount');
  }

  if (!body.currency || typeof body.currency !== 'string') {
    throw new ValidationError('Currency is required and must be a string', 'currency');
  }

  if (body.currency.length !== 3) {
    throw new ValidationError('Currency must be a valid ISO 4217 currency code', 'currency');
  }

  if (!body.cartId || typeof body.cartId !== 'string') {
    throw new ValidationError('Cart ID is required and must be a string', 'cartId');
  }

  return {
    amount: body.amount,
    currency: body.currency.toLowerCase(),
    cartId: body.cartId,
  };
}

/**
 * POST /api/payment/create-intent
 * Creates a payment intent for processing cart payment
 *
 * @requires Authentication - User must be authenticated
 * @body amount - Payment amount in smallest currency unit (e.g., cents)
 * @body currency - ISO 4217 currency code (e.g., 'usd', 'eur')
 * @body cartId - Cart identifier to process payment for
 * @returns 201 - Payment intent created successfully with client secret
 * @returns 400 - Validation error or invalid request
 * @returns 401 - Authentication required
 * @returns 403 - Unauthorized cart access
 * @returns 404 - Cart not found
 * @returns 500 - Internal server error
 */
router.post(
  '/create-intent',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    const correlationId = `create_intent_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      console.log('[PaymentRoutes] Create payment intent request', {
        correlationId,
        userId: req.user?.userId,
        body: {
          amount: req.body.amount,
          currency: req.body.currency,
          cartId: req.body.cartId,
        },
      });

      // Validate request body
      const input = validateCreatePaymentIntentInput(req.body);

      // Create payment intent
      const result: PaymentIntentResponse = await paymentService.createPaymentIntent(
        input,
        req.user!.userId
      );

      console.log('[PaymentRoutes] Payment intent created successfully', {
        correlationId,
        paymentIntentId: result.paymentIntentId,
        duration: Date.now() - startTime,
      });

      res.status(201).json({
        success: true,
        data: {
          clientSecret: result.clientSecret,
          paymentIntentId: result.paymentIntentId,
          amount: result.amount,
          currency: result.currency,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof ValidationError) {
        console.warn('[PaymentRoutes] Validation error', {
          correlationId,
          field: error.field,
          message: error.message,
          duration,
        });
        res.status(400).json({
          success: false,
          error: 'Validation error',
          message: error.message,
          field: error.field,
        });
        return;
      }

      console.error('[PaymentRoutes] Error creating payment intent', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      next(error);
    }
  }
);

/**
 * GET /api/payment/status/:paymentIntentId
 * Retrieves the current status of a payment intent
 *
 * @requires Authentication - User must be authenticated
 * @param paymentIntentId - Stripe payment intent ID
 * @returns 200 - Payment status retrieved successfully
 * @returns 401 - Authentication required
 * @returns 404 - Payment not found
 * @returns 500 - Internal server error
 */
router.get(
  '/status/:paymentIntentId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    const correlationId = `status_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const { paymentIntentId } = req.params;

    try {
      console.log('[PaymentRoutes] Get payment status request', {
        correlationId,
        userId: req.user?.userId,
        paymentIntentId,
      });

      if (!paymentIntentId || typeof paymentIntentId !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          message: 'Payment intent ID is required',
        });
        return;
      }

      // Get payment status
      const status: PaymentStatus = await paymentService.getPaymentStatus(paymentIntentId);

      console.log('[PaymentRoutes] Payment status retrieved successfully', {
        correlationId,
        paymentIntentId,
        status: status.status,
        duration: Date.now() - startTime,
      });

      res.status(200).json({
        success: true,
        data: {
          status: status.status,
          paymentIntentId: status.paymentIntentId,
          amount: status.amount,
          currency: status.currency,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      console.error('[PaymentRoutes] Error retrieving payment status', {
        correlationId,
        paymentIntentId,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      next(error);
    }
  }
);

/**
 * POST /api/payment/webhook
 * Handles Stripe webhook events for payment lifecycle
 *
 * @header stripe-signature - Stripe webhook signature for verification
 * @body - Raw webhook event payload from Stripe
 * @returns 200 - Webhook processed successfully
 * @returns 400 - Invalid signature or malformed payload
 * @returns 500 - Internal server error
 *
 * Supported events:
 * - payment_intent.succeeded: Payment completed successfully
 * - payment_intent.payment_failed: Payment failed
 * - charge.refunded: Payment refunded
 */
router.post(
  '/webhook',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    const correlationId = `webhook_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      // Extract Stripe signature from headers
      const signature = req.headers['stripe-signature'];

      if (!signature || typeof signature !== 'string') {
        console.warn('[PaymentRoutes] Missing Stripe signature', {
          correlationId,
        });
        res.status(400).json({
          success: false,
          error: 'Missing signature',
          message: 'Stripe signature header is required',
        });
        return;
      }

      // Get webhook secret from environment
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error('[PaymentRoutes] STRIPE_WEBHOOK_SECRET not configured', {
          correlationId,
        });
        res.status(500).json({
          success: false,
          error: 'Configuration error',
          message: 'Webhook secret not configured',
        });
        return;
      }

      console.log('[PaymentRoutes] Processing webhook event', {
        correlationId,
        signature: signature.substring(0, 20) + '...',
      });

      // Verify webhook signature and construct event
      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
      } catch (error) {
        console.error('[PaymentRoutes] Webhook signature verification failed', {
          correlationId,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(400).json({
          success: false,
          error: 'Invalid signature',
          message: 'Webhook signature verification failed',
        });
        return;
      }

      console.log('[PaymentRoutes] Webhook signature verified', {
        correlationId,
        eventType: event.type,
        eventId: event.id,
      });

      // Handle webhook event
      await paymentService.handleWebhookEvent(event);

      console.log('[PaymentRoutes] Webhook event processed successfully', {
        correlationId,
        eventType: event.type,
        eventId: event.id,
        duration: Date.now() - startTime,
      });

      res.status(200).json({
        success: true,
        message: 'Webhook processed successfully',
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      console.error('[PaymentRoutes] Error processing webhook', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      next(error);
    }
  }
);

/**
 * Error handling middleware for payment routes
 * Handles Stripe-specific errors and generic errors
 */
router.use((error: any, req: Request, res: Response, _next: NextFunction): void => {
  const correlationId = `error_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  // Handle Stripe errors
  if (error && typeof error === 'object' && 'type' in error) {
    const stripeError = error as { type: string; message: string; code?: string };

    console.error('[PaymentRoutes] Stripe error', {
      correlationId,
      type: stripeError.type,
      code: stripeError.code,
      message: stripeError.message,
    });

    res.status(400).json({
      success: false,
      error: 'Payment processing error',
      message: stripeError.message,
      code: stripeError.code,
    });
    return;
  }

  // Handle payment service errors
  if (error && typeof error === 'object' && 'code' in error && 'statusCode' in error) {
    const paymentError = error as { code: string; message: string; statusCode: number };

    console.error('[PaymentRoutes] Payment service error', {
      correlationId,
      code: paymentError.code,
      message: paymentError.message,
      statusCode: paymentError.statusCode,
    });

    res.status(paymentError.statusCode).json({
      success: false,
      error: paymentError.code,
      message: paymentError.message,
    });
    return;
  }

  // Handle generic errors
  console.error('[PaymentRoutes] Unexpected error', {
    correlationId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'An unexpected error occurred while processing payment',
  });
});

export default router;