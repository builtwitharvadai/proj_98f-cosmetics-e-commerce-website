/**
 * Cart Type Definitions
 * 
 * TypeScript interfaces for shopping cart operations including cart items,
 * cart responses, and calculation types. These types ensure type safety
 * across cart service, routes, and API responses.
 */

/**
 * Input type for adding a new item to the cart
 */
export interface CartItemInput {
  productId: string;
  quantity: number;
}

/**
 * Input type for updating an existing cart item
 */
export interface CartItemUpdate {
  quantity: number;
}

/**
 * Response type for a single cart item with product details
 */
export interface CartItemResponse {
  id: string;
  productId: string;
  productName: string;
  productImage: string;
  quantity: number;
  priceSnapshot: number;
  subtotal: number;
}

/**
 * Complete cart response with items and calculated totals
 */
export interface CartResponse {
  id: string;
  items: CartItemResponse[];
  subtotal: number;
  tax: number;
  total: number;
  itemCount: number;
}

/**
 * Cart calculation breakdown for subtotal, tax, and total
 */
export interface CartCalculation {
  subtotal: number;
  tax: number;
  total: number;
}