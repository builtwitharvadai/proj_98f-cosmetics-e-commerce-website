/**
 * Payment type definitions for Stripe payment gateway integration
 * Provides type-safe interfaces for payment operations, intents, and webhook events
 */

/**
 * Input for creating a payment intent
 * Used when initiating a new payment transaction
 */
export interface CreatePaymentIntentInput {
  /** Amount in smallest currency unit (e.g., cents for USD) */
  amount: number;
  /** ISO 4217 currency code (e.g., 'usd', 'eur') */
  currency: string;
  /** Associated cart identifier */
  cartId: string;
}

/**
 * Response from payment intent creation
 * Contains client secret for frontend payment confirmation
 */
export interface PaymentIntentResponse {
  /** Client secret for Stripe.js payment confirmation */
  clientSecret: string;
  /** Unique payment intent identifier from Stripe */
  paymentIntentId: string;
  /** Amount in smallest currency unit */
  amount: number;
  /** ISO 4217 currency code */
  currency: string;
}

/**
 * Payment method details
 * Represents the payment instrument used for transaction
 */
export interface PaymentMethod {
  /** Type of payment method */
  type: 'card' | 'apple_pay' | 'google_pay';
  /** Last 4 digits of card (if applicable) */
  last4?: string;
  /** Card brand (e.g., 'visa', 'mastercard', 'amex') */
  brand?: string;
}

/**
 * Payment status information
 * Tracks the current state of a payment intent
 */
export interface PaymentStatus {
  /** Current status of the payment intent */
  status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'succeeded'
    | 'canceled';
  /** Unique payment intent identifier from Stripe */
  paymentIntentId: string;
  /** Amount in smallest currency unit */
  amount: number;
  /** ISO 4217 currency code */
  currency: string;
}

/**
 * Webhook event from Stripe
 * Represents incoming webhook notifications for payment events
 */
export interface WebhookEvent {
  /** Event type (e.g., 'payment_intent.succeeded', 'charge.refunded') */
  type: string;
  /** Event data payload containing relevant information */
  data: any;
}