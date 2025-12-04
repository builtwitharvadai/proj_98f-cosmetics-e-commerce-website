import Stripe from 'stripe';

/**
 * Global Stripe client instance for singleton pattern
 */
declare global {
  // eslint-disable-next-line no-var
  var stripe: Stripe | undefined;
}

/**
 * Retrieves or creates a singleton Stripe client instance
 * 
 * @returns Configured Stripe client instance
 * @throws Error if STRIPE_SECRET_KEY environment variable is not set
 * 
 * @example
 * const stripe = getStripeClient();
 * const paymentIntent = await stripe.paymentIntents.create({
 *   amount: 1000,
 *   currency: 'usd',
 * });
 */
function getStripeClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      'STRIPE_SECRET_KEY environment variable is required for Stripe integration. ' +
      'Please set it in your .env file or environment configuration.'
    );
  }

  if (!global.stripe) {
    global.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
      typescript: true,
      maxNetworkRetries: 3,
      timeout: 30000,
    });
  }

  return global.stripe;
}

/**
 * Singleton Stripe client instance
 * 
 * This instance is configured with:
 * - API version: 2023-10-16
 * - TypeScript support enabled
 * - Automatic retry on network failures (max 3 retries)
 * - 30 second timeout for API requests
 * 
 * @example
 * import { stripe } from './lib/stripe';
 * 
 * const customer = await stripe.customers.create({
 *   email: 'customer@example.com',
 * });
 */
export const stripe = getStripeClient();