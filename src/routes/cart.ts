import { Router, Request, Response, NextFunction } from 'express';
import {
  cartService,
  CartError,
  ProductNotFoundError,
  InsufficientInventoryError,
  InvalidQuantityError,
  CartItemNotFoundError,
} from '../services/cart.service';
import { CartItemInput, CartItemUpdate } from '../types/cart.types';

const router = Router();

/**
 * Error handler middleware for cart operations
 */
const handleCartError = (error: unknown, res: Response): void => {
  if (error instanceof CartError) {
    console.warn('[CartRoutes] Cart operation error', {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    });
    res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
    return;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('[CartRoutes] Unexpected error in cart operation', {
    error: errorMessage,
    stack: error instanceof Error ? error.stack : undefined,
  });

  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
  });
};

/**
 * Validates request body for adding cart item
 */
const validateCartItemInput = (body: unknown): body is CartItemInput => {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const input = body as Record<string, unknown>;

  if (typeof input.productId !== 'string' || !input.productId.trim()) {
    return false;
  }

  if (typeof input.quantity !== 'number' || !Number.isInteger(input.quantity)) {
    return false;
  }

  return true;
};

/**
 * Validates request body for updating cart item
 */
const validateCartItemUpdate = (body: unknown): body is CartItemUpdate => {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const input = body as Record<string, unknown>;

  if (typeof input.quantity !== 'number' || !Number.isInteger(input.quantity)) {
    return false;
  }

  return true;
};

/**
 * POST /api/cart/items
 * Add item to cart
 */
router.post('/items', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = req.session.id;
    if (!sessionId) {
      res.status(400).json({
        error: 'INVALID_SESSION',
        message: 'Session ID is required',
      });
      return;
    }

    if (!validateCartItemInput(req.body)) {
      res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'Invalid request body. Required: productId (string), quantity (integer)',
      });
      return;
    }

    const { productId, quantity } = req.body;

    console.log('[CartRoutes] Adding item to cart', {
      sessionId,
      userId: req.session.userId || 'guest',
      productId,
      quantity,
    });

    const cart = await cartService.getOrCreateCart(sessionId, req.session.userId);
    const cartItem = await cartService.addItem(cart.id, { productId, quantity });

    console.log('[CartRoutes] Item added to cart successfully', {
      cartId: cart.id,
      itemId: cartItem.id,
      productId,
      quantity,
    });

    res.status(201).json({
      id: cartItem.id,
      cartId: cartItem.cartId,
      productId: cartItem.productId,
      quantity: cartItem.quantity,
      priceSnapshot: Number(cartItem.priceSnapshot),
      createdAt: cartItem.createdAt,
      updatedAt: cartItem.updatedAt,
    });
  } catch (error) {
    handleCartError(error, res);
  }
});

/**
 * GET /api/cart
 * Get cart with items and totals
 */
router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = req.session.id;
    if (!sessionId) {
      res.status(400).json({
        error: 'INVALID_SESSION',
        message: 'Session ID is required',
      });
      return;
    }

    console.log('[CartRoutes] Getting cart', {
      sessionId,
      userId: req.session.userId || 'guest',
    });

    const cart = await cartService.getOrCreateCart(sessionId, req.session.userId);
    const cartResponse = await cartService.getCart(cart.id);

    console.log('[CartRoutes] Cart retrieved successfully', {
      cartId: cart.id,
      itemCount: cartResponse.itemCount,
      total: cartResponse.total,
    });

    res.status(200).json(cartResponse);
  } catch (error) {
    handleCartError(error, res);
  }
});

/**
 * PUT /api/cart/items/:id
 * Update cart item quantity
 */
router.put(
  '/items/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string' || !id.trim()) {
        res.status(400).json({
          error: 'INVALID_ITEM_ID',
          message: 'Valid item ID is required',
        });
        return;
      }

      if (!validateCartItemUpdate(req.body)) {
        res.status(400).json({
          error: 'INVALID_INPUT',
          message: 'Invalid request body. Required: quantity (integer)',
        });
        return;
      }

      const { quantity } = req.body;

      console.log('[CartRoutes] Updating cart item quantity', {
        itemId: id,
        quantity,
        sessionId: req.session.id,
      });

      const updatedItem = await cartService.updateItemQuantity(id, quantity);

      console.log('[CartRoutes] Cart item updated successfully', {
        itemId: id,
        newQuantity: quantity,
      });

      res.status(200).json({
        id: updatedItem.id,
        cartId: updatedItem.cartId,
        productId: updatedItem.productId,
        quantity: updatedItem.quantity,
        priceSnapshot: Number(updatedItem.priceSnapshot),
        createdAt: updatedItem.createdAt,
        updatedAt: updatedItem.updatedAt,
      });
    } catch (error) {
      handleCartError(error, res);
    }
  }
);

/**
 * DELETE /api/cart/items/:id
 * Remove item from cart
 */
router.delete(
  '/items/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string' || !id.trim()) {
        res.status(400).json({
          error: 'INVALID_ITEM_ID',
          message: 'Valid item ID is required',
        });
        return;
      }

      console.log('[CartRoutes] Removing cart item', {
        itemId: id,
        sessionId: req.session.id,
      });

      await cartService.removeItem(id);

      console.log('[CartRoutes] Cart item removed successfully', {
        itemId: id,
      });

      res.status(204).send();
    } catch (error) {
      handleCartError(error, res);
    }
  }
);

/**
 * DELETE /api/cart
 * Clear entire cart
 */
router.delete('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = req.session.id;
    if (!sessionId) {
      res.status(400).json({
        error: 'INVALID_SESSION',
        message: 'Session ID is required',
      });
      return;
    }

    console.log('[CartRoutes] Clearing cart', {
      sessionId,
      userId: req.session.userId || 'guest',
    });

    const cart = await cartService.getOrCreateCart(sessionId, req.session.userId);
    await cartService.clearCart(cart.id);

    console.log('[CartRoutes] Cart cleared successfully', {
      cartId: cart.id,
    });

    res.status(204).send();
  } catch (error) {
    handleCartError(error, res);
  }
});

export default router;