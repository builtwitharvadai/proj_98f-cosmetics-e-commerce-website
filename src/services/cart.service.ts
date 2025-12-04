import { prisma } from '../lib/prisma';
import {
  CartItemInput,
  CartResponse,
  CartItemResponse,
  CartCalculation,
} from '../types/cart.types';
import { Cart, CartItem, Product, Inventory } from '@prisma/client';

/**
 * Tax rate for cart calculations
 * Configurable via environment variable, defaults to 8%
 */
const TAX_RATE = parseFloat(process.env.TAX_RATE || '0.08');

/**
 * Custom error classes for cart operations
 */
class CartError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'CartError';
  }
}

class ProductNotFoundError extends CartError {
  constructor(productId: string) {
    super(`Product not found: ${productId}`, 'PRODUCT_NOT_FOUND', 404);
  }
}

class InsufficientInventoryError extends CartError {
  constructor(productId: string, available: number, requested: number) {
    super(
      `Insufficient inventory for product ${productId}. Available: ${available}, Requested: ${requested}`,
      'INSUFFICIENT_INVENTORY',
      400
    );
  }
}

class InvalidQuantityError extends CartError {
  constructor(quantity: number) {
    super(`Invalid quantity: ${quantity}. Must be greater than 0`, 'INVALID_QUANTITY', 400);
  }
}

class CartItemNotFoundError extends CartError {
  constructor(itemId: string) {
    super(`Cart item not found: ${itemId}`, 'CART_ITEM_NOT_FOUND', 404);
  }
}

/**
 * Type for cart with items and product details
 */
type CartWithItems = Cart & {
  items: (CartItem & {
    product: Product;
  })[];
};

/**
 * CartService
 *
 * Provides business logic for shopping cart operations including:
 * - Cart creation and retrieval
 * - Adding/updating/removing items
 * - Cart calculations (subtotal, tax, total)
 * - Inventory validation
 *
 * All operations use database transactions for atomicity
 */
class CartService {
  /**
   * Gets existing cart or creates new one for session/user
   *
   * @param sessionId - Session identifier for guest carts
   * @param userId - Optional user identifier for authenticated users
   * @returns Cart instance
   */
  async getOrCreateCart(sessionId: string, userId?: string): Promise<Cart> {
    try {
      console.log('[CartService] Getting or creating cart', {
        sessionId,
        userId: userId || 'guest',
      });

      // Try to find existing cart
      let cart = await prisma.cart.findUnique({
        where: { sessionId },
      });

      if (cart) {
        // Update userId if user logged in after creating guest cart
        if (userId && !cart.userId) {
          cart = await prisma.cart.update({
            where: { id: cart.id },
            data: { userId },
          });
          console.log('[CartService] Updated cart with userId', { cartId: cart.id, userId });
        }
        return cart;
      }

      // Create new cart
      cart = await prisma.cart.create({
        data: {
          sessionId,
          userId: userId || null,
        },
      });

      console.log('[CartService] Created new cart', {
        cartId: cart.id,
        sessionId,
        userId: userId || 'guest',
      });

      return cart;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[CartService] Error getting or creating cart', {
        error: errorMessage,
        sessionId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Adds item to cart with inventory validation
   *
   * @param cartId - Cart identifier
   * @param input - Product ID and quantity to add
   * @returns Created cart item
   * @throws ProductNotFoundError if product doesn't exist
   * @throws InsufficientInventoryError if not enough inventory
   * @throws InvalidQuantityError if quantity is invalid
   */
  async addItem(cartId: string, input: CartItemInput): Promise<CartItem> {
    const { productId, quantity } = input;

    if (quantity <= 0) {
      throw new InvalidQuantityError(quantity);
    }

    try {
      console.log('[CartService] Adding item to cart', { cartId, productId, quantity });

      return await prisma.$transaction(async (tx) => {
        // Validate product exists
        const product = await tx.product.findUnique({
          where: { id: productId },
          include: { inventory: true },
        });

        if (!product) {
          throw new ProductNotFoundError(productId);
        }

        // Check inventory availability
        const inventory = product.inventory;
        if (!inventory) {
          throw new InsufficientInventoryError(productId, 0, quantity);
        }

        const available = inventory.quantity - inventory.reserved;
        if (available < quantity) {
          throw new InsufficientInventoryError(productId, available, quantity);
        }

        // Check if item already exists in cart
        const existingItem = await tx.cartItem.findFirst({
          where: {
            cartId,
            productId,
          },
        });

        if (existingItem) {
          // Update existing item quantity
          const newQuantity = existingItem.quantity + quantity;

          if (available < newQuantity) {
            throw new InsufficientInventoryError(productId, available, newQuantity);
          }

          const updatedItem = await tx.cartItem.update({
            where: { id: existingItem.id },
            data: { quantity: newQuantity },
          });

          console.log('[CartService] Updated existing cart item', {
            itemId: updatedItem.id,
            newQuantity,
          });

          return updatedItem;
        }

        // Create new cart item with price snapshot
        const cartItem = await tx.cartItem.create({
          data: {
            cartId,
            productId,
            quantity,
            priceSnapshot: product.price,
          },
        });

        console.log('[CartService] Created new cart item', {
          itemId: cartItem.id,
          productId,
          quantity,
          priceSnapshot: product.price.toString(),
        });

        return cartItem;
      });
    } catch (error) {
      if (error instanceof CartError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[CartService] Error adding item to cart', {
        error: errorMessage,
        cartId,
        productId,
        quantity,
      });
      throw error;
    }
  }

  /**
   * Updates cart item quantity with inventory validation
   *
   * @param itemId - Cart item identifier
   * @param quantity - New quantity
   * @returns Updated cart item
   * @throws CartItemNotFoundError if item doesn't exist
   * @throws InvalidQuantityError if quantity is invalid
   * @throws InsufficientInventoryError if not enough inventory
   */
  async updateItemQuantity(itemId: string, quantity: number): Promise<CartItem> {
    if (quantity <= 0) {
      throw new InvalidQuantityError(quantity);
    }

    try {
      console.log('[CartService] Updating item quantity', { itemId, quantity });

      return await prisma.$transaction(async (tx) => {
        // Get cart item with product and inventory
        const cartItem = await tx.cartItem.findUnique({
          where: { id: itemId },
          include: {
            product: {
              include: { inventory: true },
            },
          },
        });

        if (!cartItem) {
          throw new CartItemNotFoundError(itemId);
        }

        // Check inventory availability
        const inventory = cartItem.product.inventory;
        if (!inventory) {
          throw new InsufficientInventoryError(cartItem.productId, 0, quantity);
        }

        const available = inventory.quantity - inventory.reserved;
        if (available < quantity) {
          throw new InsufficientInventoryError(cartItem.productId, available, quantity);
        }

        // Update quantity
        const updatedItem = await tx.cartItem.update({
          where: { id: itemId },
          data: { quantity },
        });

        console.log('[CartService] Updated cart item quantity', {
          itemId,
          oldQuantity: cartItem.quantity,
          newQuantity: quantity,
        });

        return updatedItem;
      });
    } catch (error) {
      if (error instanceof CartError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[CartService] Error updating item quantity', {
        error: errorMessage,
        itemId,
        quantity,
      });
      throw error;
    }
  }

  /**
   * Removes item from cart
   *
   * @param itemId - Cart item identifier
   * @throws CartItemNotFoundError if item doesn't exist
   */
  async removeItem(itemId: string): Promise<void> {
    try {
      console.log('[CartService] Removing item from cart', { itemId });

      const deletedItem = await prisma.cartItem.delete({
        where: { id: itemId },
      });

      console.log('[CartService] Removed cart item', {
        itemId,
        productId: deletedItem.productId,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
        throw new CartItemNotFoundError(itemId);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[CartService] Error removing item from cart', {
        error: errorMessage,
        itemId,
      });
      throw error;
    }
  }

  /**
   * Gets cart with items and calculated totals
   *
   * @param cartId - Cart identifier
   * @returns Cart response with items and totals
   */
  async getCart(cartId: string): Promise<CartResponse> {
    try {
      console.log('[CartService] Getting cart', { cartId });

      const cart = await prisma.cart.findUnique({
        where: { id: cartId },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      if (!cart) {
        // Return empty cart response if cart doesn't exist
        return {
          id: cartId,
          items: [],
          subtotal: 0,
          tax: 0,
          total: 0,
          itemCount: 0,
        };
      }

      const response = this.formatCartResponse(cart);

      console.log('[CartService] Retrieved cart', {
        cartId,
        itemCount: response.itemCount,
        total: response.total,
      });

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[CartService] Error getting cart', {
        error: errorMessage,
        cartId,
      });
      throw error;
    }
  }

  /**
   * Clears all items from cart
   *
   * @param cartId - Cart identifier
   */
  async clearCart(cartId: string): Promise<void> {
    try {
      console.log('[CartService] Clearing cart', { cartId });

      const result = await prisma.cartItem.deleteMany({
        where: { cartId },
      });

      console.log('[CartService] Cleared cart', {
        cartId,
        deletedCount: result.count,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[CartService] Error clearing cart', {
        error: errorMessage,
        cartId,
      });
      throw error;
    }
  }

  /**
   * Calculates cart totals (subtotal, tax, total)
   *
   * @param items - Cart items with price snapshots
   * @returns Calculated totals
   */
  private calculateTotals(items: CartItem[]): CartCalculation {
    const subtotal = items.reduce((sum, item) => {
      const itemTotal = Number(item.priceSnapshot) * item.quantity;
      return sum + itemTotal;
    }, 0);

    const tax = subtotal * TAX_RATE;
    const total = subtotal + tax;

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total: Math.round(total * 100) / 100,
    };
  }

  /**
   * Formats cart with items into response structure
   *
   * @param cart - Cart with items and products
   * @returns Formatted cart response
   */
  private formatCartResponse(cart: CartWithItems): CartResponse {
    const items: CartItemResponse[] = cart.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      productImage: item.product.imageUrl || '',
      quantity: item.quantity,
      priceSnapshot: Number(item.priceSnapshot),
      subtotal: Math.round(Number(item.priceSnapshot) * item.quantity * 100) / 100,
    }));

    const calculations = this.calculateTotals(cart.items);
    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    return {
      id: cart.id,
      items,
      subtotal: calculations.subtotal,
      tax: calculations.tax,
      total: calculations.total,
      itemCount,
    };
  }
}

/**
 * Singleton cart service instance
 */
export const cartService = new CartService();

/**
 * Export error classes for use in routes
 */
export {
  CartError,
  ProductNotFoundError,
  InsufficientInventoryError,
  InvalidQuantityError,
  CartItemNotFoundError,
};