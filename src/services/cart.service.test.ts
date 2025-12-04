import { cartService } from './cart.service';
import { prisma } from '../lib/prisma';
import { Cart, CartItem, Product, Inventory } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

// Mock Prisma client
jest.mock('../lib/prisma', () => ({
  prisma: {
    cart: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    cartItem: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// Type helpers for mocked Prisma
type MockedPrisma = typeof prisma;
const mockPrisma = prisma as jest.Mocked<MockedPrisma>;

describe('CartService', () => {
  // Test data factories
  const createMockCart = (overrides?: Partial<Cart>): Cart => ({
    id: 'cart-123',
    sessionId: 'session-123',
    userId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  });

  const createMockProduct = (overrides?: Partial<Product>): Product => ({
    id: 'product-123',
    name: 'Test Product',
    description: 'Test Description',
    price: new Decimal('29.99'),
    imageUrl: 'https://example.com/image.jpg',
    categoryId: 'category-123',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  });

  const createMockInventory = (overrides?: Partial<Inventory>): Inventory => ({
    id: 'inventory-123',
    productId: 'product-123',
    quantity: 100,
    reserved: 0,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  });

  const createMockCartItem = (overrides?: Partial<CartItem>): CartItem => ({
    id: 'item-123',
    cartId: 'cart-123',
    productId: 'product-123',
    quantity: 1,
    priceSnapshot: new Decimal('29.99'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getOrCreateCart', () => {
    describe('Happy Path - Cart Creation', () => {
      it('should create new cart for guest session', async () => {
        const sessionId = 'session-123';
        const mockCart = createMockCart({ sessionId, userId: null });

        mockPrisma.cart.findUnique.mockResolvedValue(null);
        mockPrisma.cart.create.mockResolvedValue(mockCart);

        const result = await cartService.getOrCreateCart(sessionId);

        expect(mockPrisma.cart.findUnique).toHaveBeenCalledWith({
          where: { sessionId },
        });
        expect(mockPrisma.cart.create).toHaveBeenCalledWith({
          data: {
            sessionId,
            userId: null,
          },
        });
        expect(result).toEqual(mockCart);
        expect(result.userId).toBeNull();
      });

      it('should create new cart with userId for authenticated user', async () => {
        const sessionId = 'session-123';
        const userId = 'user-123';
        const mockCart = createMockCart({ sessionId, userId });

        mockPrisma.cart.findUnique.mockResolvedValue(null);
        mockPrisma.cart.create.mockResolvedValue(mockCart);

        const result = await cartService.getOrCreateCart(sessionId, userId);

        expect(mockPrisma.cart.create).toHaveBeenCalledWith({
          data: {
            sessionId,
            userId,
          },
        });
        expect(result.userId).toBe(userId);
      });
    });

    describe('Happy Path - Cart Retrieval', () => {
      it('should return existing cart for session', async () => {
        const sessionId = 'session-123';
        const mockCart = createMockCart({ sessionId });

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart);

        const result = await cartService.getOrCreateCart(sessionId);

        expect(mockPrisma.cart.findUnique).toHaveBeenCalledWith({
          where: { sessionId },
        });
        expect(mockPrisma.cart.create).not.toHaveBeenCalled();
        expect(result).toEqual(mockCart);
      });

      it('should update cart with userId when user logs in', async () => {
        const sessionId = 'session-123';
        const userId = 'user-123';
        const existingCart = createMockCart({ sessionId, userId: null });
        const updatedCart = createMockCart({ sessionId, userId });

        mockPrisma.cart.findUnique.mockResolvedValue(existingCart);
        mockPrisma.cart.update.mockResolvedValue(updatedCart);

        const result = await cartService.getOrCreateCart(sessionId, userId);

        expect(mockPrisma.cart.update).toHaveBeenCalledWith({
          where: { id: existingCart.id },
          data: { userId },
        });
        expect(result.userId).toBe(userId);
      });

      it('should not update cart if userId already set', async () => {
        const sessionId = 'session-123';
        const userId = 'user-123';
        const existingCart = createMockCart({ sessionId, userId });

        mockPrisma.cart.findUnique.mockResolvedValue(existingCart);

        const result = await cartService.getOrCreateCart(sessionId, userId);

        expect(mockPrisma.cart.update).not.toHaveBeenCalled();
        expect(result).toEqual(existingCart);
      });
    });

    describe('Error Handling', () => {
      it('should propagate database errors', async () => {
        const sessionId = 'session-123';
        const dbError = new Error('Database connection failed');

        mockPrisma.cart.findUnique.mockRejectedValue(dbError);

        await expect(cartService.getOrCreateCart(sessionId)).rejects.toThrow(
          'Database connection failed'
        );
      });

      it('should log error details on failure', async () => {
        const sessionId = 'session-123';
        const dbError = new Error('Database error');

        mockPrisma.cart.findUnique.mockRejectedValue(dbError);

        await expect(cartService.getOrCreateCart(sessionId)).rejects.toThrow();
        expect(console.error).toHaveBeenCalledWith(
          '[CartService] Error getting or creating cart',
          expect.objectContaining({
            error: 'Database error',
            sessionId,
          })
        );
      });
    });
  });

  describe('addItem', () => {
    describe('Happy Path - New Item', () => {
      it('should add new product to cart with price snapshot', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';
        const quantity = 2;
        const mockProduct = createMockProduct({ id: productId, price: new Decimal('29.99') });
        const mockInventory = createMockInventory({ productId, quantity: 100, reserved: 0 });
        const mockCartItem = createMockCartItem({
          cartId,
          productId,
          quantity,
          priceSnapshot: new Decimal('29.99'),
        });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockProduct,
                inventory: mockInventory,
              }),
            },
            cartItem: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue(mockCartItem),
            },
          };
          return callback(tx as any);
        });

        const result = await cartService.addItem(cartId, { productId, quantity });

        expect(result).toEqual(mockCartItem);
        expect(result.priceSnapshot).toEqual(new Decimal('29.99'));
        expect(result.quantity).toBe(quantity);
      });

      it('should handle decimal prices correctly', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';
        const quantity = 1;
        const mockProduct = createMockProduct({ id: productId, price: new Decimal('19.95') });
        const mockInventory = createMockInventory({ productId, quantity: 50 });
        const mockCartItem = createMockCartItem({
          cartId,
          productId,
          quantity,
          priceSnapshot: new Decimal('19.95'),
        });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockProduct,
                inventory: mockInventory,
              }),
            },
            cartItem: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue(mockCartItem),
            },
          };
          return callback(tx as any);
        });

        const result = await cartService.addItem(cartId, { productId, quantity });

        expect(result.priceSnapshot).toEqual(new Decimal('19.95'));
      });
    });

    describe('Happy Path - Update Existing Item', () => {
      it('should update quantity when item already exists in cart', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';
        const quantity = 2;
        const existingItem = createMockCartItem({ cartId, productId, quantity: 3 });
        const mockProduct = createMockProduct({ id: productId });
        const mockInventory = createMockInventory({ productId, quantity: 100, reserved: 0 });
        const updatedItem = createMockCartItem({ ...existingItem, quantity: 5 });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockProduct,
                inventory: mockInventory,
              }),
            },
            cartItem: {
              findFirst: jest.fn().mockResolvedValue(existingItem),
              update: jest.fn().mockResolvedValue(updatedItem),
            },
          };
          return callback(tx as any);
        });

        const result = await cartService.addItem(cartId, { productId, quantity });

        expect(result.quantity).toBe(5);
      });

      it('should validate inventory for updated quantity', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';
        const quantity = 10;
        const existingItem = createMockCartItem({ cartId, productId, quantity: 5 });
        const mockProduct = createMockProduct({ id: productId });
        const mockInventory = createMockInventory({ productId, quantity: 20, reserved: 7 });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockProduct,
                inventory: mockInventory,
              }),
            },
            cartItem: {
              findFirst: jest.fn().mockResolvedValue(existingItem),
            },
          };
          return callback(tx as any);
        });

        await expect(cartService.addItem(cartId, { productId, quantity })).rejects.toThrow(
          'Insufficient inventory'
        );
      });
    });

    describe('Validation - Invalid Quantity', () => {
      it('should reject zero quantity', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';

        await expect(cartService.addItem(cartId, { productId, quantity: 0 })).rejects.toThrow(
          'Invalid quantity: 0'
        );
      });

      it('should reject negative quantity', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';

        await expect(cartService.addItem(cartId, { productId, quantity: -5 })).rejects.toThrow(
          'Invalid quantity: -5'
        );
      });
    });

    describe('Validation - Product Not Found', () => {
      it('should throw error when product does not exist', async () => {
        const cartId = 'cart-123';
        const productId = 'nonexistent-product';
        const quantity = 1;

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          };
          return callback(tx as any);
        });

        await expect(cartService.addItem(cartId, { productId, quantity })).rejects.toThrow(
          `Product not found: ${productId}`
        );
      });
    });

    describe('Validation - Insufficient Inventory', () => {
      it('should throw error when inventory is insufficient', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';
        const quantity = 10;
        const mockProduct = createMockProduct({ id: productId });
        const mockInventory = createMockInventory({ productId, quantity: 5, reserved: 0 });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockProduct,
                inventory: mockInventory,
              }),
            },
            cartItem: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          };
          return callback(tx as any);
        });

        await expect(cartService.addItem(cartId, { productId, quantity })).rejects.toThrow(
          'Insufficient inventory'
        );
      });

      it('should account for reserved inventory', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';
        const quantity = 10;
        const mockProduct = createMockProduct({ id: productId });
        const mockInventory = createMockInventory({ productId, quantity: 15, reserved: 10 });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockProduct,
                inventory: mockInventory,
              }),
            },
            cartItem: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          };
          return callback(tx as any);
        });

        await expect(cartService.addItem(cartId, { productId, quantity })).rejects.toThrow(
          'Insufficient inventory'
        );
      });

      it('should throw error when product has no inventory record', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';
        const quantity = 1;
        const mockProduct = createMockProduct({ id: productId });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockProduct,
                inventory: null,
              }),
            },
            cartItem: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          };
          return callback(tx as any);
        });

        await expect(cartService.addItem(cartId, { productId, quantity })).rejects.toThrow(
          'Insufficient inventory'
        );
      });
    });

    describe('Edge Cases', () => {
      it('should handle maximum safe integer quantity', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';
        const quantity = Number.MAX_SAFE_INTEGER;
        const mockProduct = createMockProduct({ id: productId });
        const mockInventory = createMockInventory({
          productId,
          quantity: Number.MAX_SAFE_INTEGER,
          reserved: 0,
        });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockProduct,
                inventory: mockInventory,
              }),
            },
            cartItem: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
          };
          return callback(tx as any);
        });

        await expect(cartService.addItem(cartId, { productId, quantity })).rejects.toThrow(
          'Insufficient inventory'
        );
      });
    });

    describe('Transaction Rollback', () => {
      it('should rollback transaction on error', async () => {
        const cartId = 'cart-123';
        const productId = 'product-123';
        const quantity = 1;

        mockPrisma.$transaction.mockRejectedValue(new Error('Transaction failed'));

        await expect(cartService.addItem(cartId, { productId, quantity })).rejects.toThrow(
          'Transaction failed'
        );
      });
    });
  });

  describe('updateItemQuantity', () => {
    describe('Happy Path', () => {
      it('should update cart item quantity', async () => {
        const itemId = 'item-123';
        const newQuantity = 5;
        const mockCartItem = createMockCartItem({ id: itemId, quantity: 2 });
        const mockProduct = createMockProduct();
        const mockInventory = createMockInventory({ quantity: 100, reserved: 0 });
        const updatedItem = createMockCartItem({ ...mockCartItem, quantity: newQuantity });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            cartItem: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockCartItem,
                product: {
                  ...mockProduct,
                  inventory: mockInventory,
                },
              }),
              update: jest.fn().mockResolvedValue(updatedItem),
            },
          };
          return callback(tx as any);
        });

        const result = await cartService.updateItemQuantity(itemId, newQuantity);

        expect(result.quantity).toBe(newQuantity);
      });

      it('should allow decreasing quantity', async () => {
        const itemId = 'item-123';
        const newQuantity = 1;
        const mockCartItem = createMockCartItem({ id: itemId, quantity: 5 });
        const mockProduct = createMockProduct();
        const mockInventory = createMockInventory({ quantity: 100, reserved: 0 });
        const updatedItem = createMockCartItem({ ...mockCartItem, quantity: newQuantity });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            cartItem: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockCartItem,
                product: {
                  ...mockProduct,
                  inventory: mockInventory,
                },
              }),
              update: jest.fn().mockResolvedValue(updatedItem),
            },
          };
          return callback(tx as any);
        });

        const result = await cartService.updateItemQuantity(itemId, newQuantity);

        expect(result.quantity).toBe(newQuantity);
      });
    });

    describe('Validation - Invalid Quantity', () => {
      it('should reject zero quantity', async () => {
        const itemId = 'item-123';

        await expect(cartService.updateItemQuantity(itemId, 0)).rejects.toThrow(
          'Invalid quantity: 0'
        );
      });

      it('should reject negative quantity', async () => {
        const itemId = 'item-123';

        await expect(cartService.updateItemQuantity(itemId, -3)).rejects.toThrow(
          'Invalid quantity: -3'
        );
      });
    });

    describe('Validation - Item Not Found', () => {
      it('should throw error when cart item does not exist', async () => {
        const itemId = 'nonexistent-item';
        const quantity = 5;

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            cartItem: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          };
          return callback(tx as any);
        });

        await expect(cartService.updateItemQuantity(itemId, quantity)).rejects.toThrow(
          `Cart item not found: ${itemId}`
        );
      });
    });

    describe('Validation - Insufficient Inventory', () => {
      it('should throw error when new quantity exceeds inventory', async () => {
        const itemId = 'item-123';
        const newQuantity = 20;
        const mockCartItem = createMockCartItem({ id: itemId, quantity: 2 });
        const mockProduct = createMockProduct();
        const mockInventory = createMockInventory({ quantity: 15, reserved: 0 });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            cartItem: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockCartItem,
                product: {
                  ...mockProduct,
                  inventory: mockInventory,
                },
              }),
            },
          };
          return callback(tx as any);
        });

        await expect(cartService.updateItemQuantity(itemId, newQuantity)).rejects.toThrow(
          'Insufficient inventory'
        );
      });

      it('should account for reserved inventory when updating', async () => {
        const itemId = 'item-123';
        const newQuantity = 10;
        const mockCartItem = createMockCartItem({ id: itemId, quantity: 2 });
        const mockProduct = createMockProduct();
        const mockInventory = createMockInventory({ quantity: 15, reserved: 10 });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            cartItem: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockCartItem,
                product: {
                  ...mockProduct,
                  inventory: mockInventory,
                },
              }),
            },
          };
          return callback(tx as any);
        });

        await expect(cartService.updateItemQuantity(itemId, newQuantity)).rejects.toThrow(
          'Insufficient inventory'
        );
      });

      it('should throw error when product has no inventory', async () => {
        const itemId = 'item-123';
        const newQuantity = 5;
        const mockCartItem = createMockCartItem({ id: itemId, quantity: 2 });
        const mockProduct = createMockProduct();

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            cartItem: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockCartItem,
                product: {
                  ...mockProduct,
                  inventory: null,
                },
              }),
            },
          };
          return callback(tx as any);
        });

        await expect(cartService.updateItemQuantity(itemId, newQuantity)).rejects.toThrow(
          'Insufficient inventory'
        );
      });
    });
  });

  describe('removeItem', () => {
    describe('Happy Path', () => {
      it('should remove cart item successfully', async () => {
        const itemId = 'item-123';
        const mockCartItem = createMockCartItem({ id: itemId });

        mockPrisma.cartItem.delete.mockResolvedValue(mockCartItem);

        await cartService.removeItem(itemId);

        expect(mockPrisma.cartItem.delete).toHaveBeenCalledWith({
          where: { id: itemId },
        });
      });

      it('should log removal details', async () => {
        const itemId = 'item-123';
        const mockCartItem = createMockCartItem({ id: itemId, productId: 'product-123' });

        mockPrisma.cartItem.delete.mockResolvedValue(mockCartItem);

        await cartService.removeItem(itemId);

        expect(console.log).toHaveBeenCalledWith('[CartService] Removed cart item', {
          itemId,
          productId: 'product-123',
        });
      });
    });

    describe('Error Handling', () => {
      it('should throw error when item does not exist', async () => {
        const itemId = 'nonexistent-item';
        const error = new Error('Record to delete does not exist');

        mockPrisma.cartItem.delete.mockRejectedValue(error);

        await expect(cartService.removeItem(itemId)).rejects.toThrow(
          `Cart item not found: ${itemId}`
        );
      });

      it('should propagate other database errors', async () => {
        const itemId = 'item-123';
        const error = new Error('Database connection failed');

        mockPrisma.cartItem.delete.mockRejectedValue(error);

        await expect(cartService.removeItem(itemId)).rejects.toThrow('Database connection failed');
      });
    });
  });

  describe('getCart', () => {
    describe('Happy Path', () => {
      it('should return cart with items and calculated totals', async () => {
        const cartId = 'cart-123';
        const mockProduct1 = createMockProduct({
          id: 'product-1',
          name: 'Product 1',
          price: new Decimal('10.00'),
        });
        const mockProduct2 = createMockProduct({
          id: 'product-2',
          name: 'Product 2',
          price: new Decimal('20.00'),
        });
        const mockCart = {
          ...createMockCart({ id: cartId }),
          items: [
            {
              ...createMockCartItem({
                id: 'item-1',
                productId: 'product-1',
                quantity: 2,
                priceSnapshot: new Decimal('10.00'),
              }),
              product: mockProduct1,
            },
            {
              ...createMockCartItem({
                id: 'item-2',
                productId: 'product-2',
                quantity: 1,
                priceSnapshot: new Decimal('20.00'),
              }),
              product: mockProduct2,
            },
          ],
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart);

        const result = await cartService.getCart(cartId);

        expect(result.id).toBe(cartId);
        expect(result.items).toHaveLength(2);
        expect(result.subtotal).toBe(40.0); // (10 * 2) + (20 * 1)
        expect(result.tax).toBe(3.2); // 40 * 0.08
        expect(result.total).toBe(43.2); // 40 + 3.2
        expect(result.itemCount).toBe(3); // 2 + 1
      });

      it('should format cart items correctly', async () => {
        const cartId = 'cart-123';
        const mockProduct = createMockProduct({
          id: 'product-1',
          name: 'Test Product',
          imageUrl: 'https://example.com/image.jpg',
          price: new Decimal('29.99'),
        });
        const mockCart = {
          ...createMockCart({ id: cartId }),
          items: [
            {
              ...createMockCartItem({
                id: 'item-1',
                productId: 'product-1',
                quantity: 2,
                priceSnapshot: new Decimal('29.99'),
              }),
              product: mockProduct,
            },
          ],
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart);

        const result = await cartService.getCart(cartId);

        expect(result.items[0]).toEqual({
          id: 'item-1',
          productId: 'product-1',
          productName: 'Test Product',
          productImage: 'https://example.com/image.jpg',
          quantity: 2,
          priceSnapshot: 29.99,
          subtotal: 59.98,
        });
      });

      it('should handle empty product image', async () => {
        const cartId = 'cart-123';
        const mockProduct = createMockProduct({
          id: 'product-1',
          imageUrl: null,
        });
        const mockCart = {
          ...createMockCart({ id: cartId }),
          items: [
            {
              ...createMockCartItem({ id: 'item-1', productId: 'product-1' }),
              product: mockProduct,
            },
          ],
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart);

        const result = await cartService.getCart(cartId);

        expect(result.items[0].productImage).toBe('');
      });
    });

    describe('Empty Cart', () => {
      it('should return empty cart response when cart does not exist', async () => {
        const cartId = 'nonexistent-cart';

        mockPrisma.cart.findUnique.mockResolvedValue(null);

        const result = await cartService.getCart(cartId);

        expect(result).toEqual({
          id: cartId,
          items: [],
          subtotal: 0,
          tax: 0,
          total: 0,
          itemCount: 0,
        });
      });

      it('should return zero totals for cart with no items', async () => {
        const cartId = 'cart-123';
        const mockCart = {
          ...createMockCart({ id: cartId }),
          items: [],
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart);

        const result = await cartService.getCart(cartId);

        expect(result.subtotal).toBe(0);
        expect(result.tax).toBe(0);
        expect(result.total).toBe(0);
        expect(result.itemCount).toBe(0);
      });
    });

    describe('Tax Calculation', () => {
      it('should calculate tax correctly with default rate', async () => {
        const cartId = 'cart-123';
        const mockProduct = createMockProduct({ price: new Decimal('100.00') });
        const mockCart = {
          ...createMockCart({ id: cartId }),
          items: [
            {
              ...createMockCartItem({
                quantity: 1,
                priceSnapshot: new Decimal('100.00'),
              }),
              product: mockProduct,
            },
          ],
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart);

        const result = await cartService.getCart(cartId);

        expect(result.subtotal).toBe(100.0);
        expect(result.tax).toBe(8.0); // 100 * 0.08
        expect(result.total).toBe(108.0);
      });

      it('should round tax to 2 decimal places', async () => {
        const cartId = 'cart-123';
        const mockProduct = createMockProduct({ price: new Decimal('10.33') });
        const mockCart = {
          ...createMockCart({ id: cartId }),
          items: [
            {
              ...createMockCartItem({
                quantity: 1,
                priceSnapshot: new Decimal('10.33'),
              }),
              product: mockProduct,
            },
          ],
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart);

        const result = await cartService.getCart(cartId);

        expect(result.subtotal).toBe(10.33);
        expect(result.tax).toBe(0.83); // 10.33 * 0.08 = 0.8264, rounded to 0.83
        expect(result.total).toBe(11.16);
      });
    });

    describe('Edge Cases', () => {
      it('should handle very large quantities', async () => {
        const cartId = 'cart-123';
        const mockProduct = createMockProduct({ price: new Decimal('1.00') });
        const mockCart = {
          ...createMockCart({ id: cartId }),
          items: [
            {
              ...createMockCartItem({
                quantity: 1000000,
                priceSnapshot: new Decimal('1.00'),
              }),
              product: mockProduct,
            },
          ],
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart);

        const result = await cartService.getCart(cartId);

        expect(result.subtotal).toBe(1000000.0);
        expect(result.tax).toBe(80000.0);
        expect(result.total).toBe(1080000.0);
      });

      it('should handle decimal prices correctly', async () => {
        const cartId = 'cart-123';
        const mockProduct = createMockProduct({ price: new Decimal('19.99') });
        const mockCart = {
          ...createMockCart({ id: cartId }),
          items: [
            {
              ...createMockCartItem({
                quantity: 3,
                priceSnapshot: new Decimal('19.99'),
              }),
              product: mockProduct,
            },
          ],
        };

        mockPrisma.cart.findUnique.mockResolvedValue(mockCart);

        const result = await cartService.getCart(cartId);

        expect(result.subtotal).toBe(59.97);
        expect(result.tax).toBe(4.8); // 59.97 * 0.08 = 4.7976, rounded to 4.8
        expect(result.total).toBe(64.77);
      });
    });

    describe('Error Handling', () => {
      it('should propagate database errors', async () => {
        const cartId = 'cart-123';
        const error = new Error('Database connection failed');

        mockPrisma.cart.findUnique.mockRejectedValue(error);

        await expect(cartService.getCart(cartId)).rejects.toThrow('Database connection failed');
      });
    });
  });

  describe('clearCart', () => {
    describe('Happy Path', () => {
      it('should remove all items from cart', async () => {
        const cartId = 'cart-123';

        mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 3 });

        await cartService.clearCart(cartId);

        expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
          where: { cartId },
        });
      });

      it('should log deletion count', async () => {
        const cartId = 'cart-123';

        mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 5 });

        await cartService.clearCart(cartId);

        expect(console.log).toHaveBeenCalledWith('[CartService] Cleared cart', {
          cartId,
          deletedCount: 5,
        });
      });

      it('should handle empty cart gracefully', async () => {
        const cartId = 'cart-123';

        mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });

        await cartService.clearCart(cartId);

        expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
          where: { cartId },
        });
      });
    });

    describe('Error Handling', () => {
      it('should propagate database errors', async () => {
        const cartId = 'cart-123';
        const error = new Error('Database connection failed');

        mockPrisma.cartItem.deleteMany.mockRejectedValue(error);

        await expect(cartService.clearCart(cartId)).rejects.toThrow('Database connection failed');
      });

      it('should log error details on failure', async () => {
        const cartId = 'cart-123';
        const error = new Error('Database error');

        mockPrisma.cartItem.deleteMany.mockRejectedValue(error);

        await expect(cartService.clearCart(cartId)).rejects.toThrow();
        expect(console.error).toHaveBeenCalledWith(
          '[CartService] Error clearing cart',
          expect.objectContaining({
            error: 'Database error',
            cartId,
          })
        );
      });
    });
  });

  describe('Error Classes', () => {
    describe('ProductNotFoundError', () => {
      it('should create error with correct properties', () => {
        const productId = 'product-123';
        const error = new (require('./cart.service').ProductNotFoundError)(productId);

        expect(error.message).toBe(`Product not found: ${productId}`);
        expect(error.code).toBe('PRODUCT_NOT_FOUND');
        expect(error.statusCode).toBe(404);
        expect(error.name).toBe('CartError');
      });
    });

    describe('InsufficientInventoryError', () => {
      it('should create error with correct properties', () => {
        const productId = 'product-123';
        const available = 5;
        const requested = 10;
        const error = new (require('./cart.service').InsufficientInventoryError)(
          productId,
          available,
          requested
        );

        expect(error.message).toContain('Insufficient inventory');
        expect(error.message).toContain(productId);
        expect(error.message).toContain('5');
        expect(error.message).toContain('10');
        expect(error.code).toBe('INSUFFICIENT_INVENTORY');
        expect(error.statusCode).toBe(400);
      });
    });

    describe('InvalidQuantityError', () => {
      it('should create error with correct properties', () => {
        const quantity = -5;
        const error = new (require('./cart.service').InvalidQuantityError)(quantity);

        expect(error.message).toContain('Invalid quantity');
        expect(error.message).toContain('-5');
        expect(error.code).toBe('INVALID_QUANTITY');
        expect(error.statusCode).toBe(400);
      });
    });

    describe('CartItemNotFoundError', () => {
      it('should create error with correct properties', () => {
        const itemId = 'item-123';
        const error = new (require('./cart.service').CartItemNotFoundError)(itemId);

        expect(error.message).toBe(`Cart item not found: ${itemId}`);
        expect(error.code).toBe('CART_ITEM_NOT_FOUND');
        expect(error.statusCode).toBe(404);
      });
    });
  });

  describe('Integration Scenarios', () => {
    describe('Complete Shopping Flow', () => {
      it('should handle complete cart lifecycle', async () => {
        const sessionId = 'session-123';
        const productId = 'product-123';
        const mockCart = createMockCart({ sessionId });
        const mockProduct = createMockProduct({ id: productId, price: new Decimal('29.99') });
        const mockInventory = createMockInventory({ productId, quantity: 100 });
        const mockCartItem = createMockCartItem({
          cartId: mockCart.id,
          productId,
          quantity: 2,
          priceSnapshot: new Decimal('29.99'),
        });

        // Create cart
        mockPrisma.cart.findUnique.mockResolvedValue(null);
        mockPrisma.cart.create.mockResolvedValue(mockCart);

        const cart = await cartService.getOrCreateCart(sessionId);
        expect(cart.id).toBe(mockCart.id);

        // Add item
        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn().mockResolvedValue({
                ...mockProduct,
                inventory: mockInventory,
              }),
            },
            cartItem: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue(mockCartItem),
            },
          };
          return callback(tx as any);
        });

        const item = await cartService.addItem(cart.id, { productId, quantity: 2 });
        expect(item.quantity).toBe(2);

        // Get cart with totals
        mockPrisma.cart.findUnique.mockResolvedValue({
          ...mockCart,
          items: [{ ...mockCartItem, product: mockProduct }],
        });

        const cartWithItems = await cartService.getCart(cart.id);
        expect(cartWithItems.items).toHaveLength(1);
        expect(cartWithItems.total).toBeGreaterThan(0);

        // Clear cart
        mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });
        await cartService.clearCart(cart.id);

        expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
          where: { cartId: cart.id },
        });
      });
    });

    describe('Concurrent Operations', () => {
      it('should handle multiple items being added simultaneously', async () => {
        const cartId = 'cart-123';
        const product1 = createMockProduct({ id: 'product-1', price: new Decimal('10.00') });
        const product2 = createMockProduct({ id: 'product-2', price: new Decimal('20.00') });
        const inventory1 = createMockInventory({ productId: 'product-1', quantity: 100 });
        const inventory2 = createMockInventory({ productId: 'product-2', quantity: 100 });

        mockPrisma.$transaction.mockImplementation(async (callback) => {
          const tx = {
            product: {
              findUnique: jest.fn((args) => {
                if (args.where.id === 'product-1') {
                  return Promise.resolve({ ...product1, inventory: inventory1 });
                }
                return Promise.resolve({ ...product2, inventory: inventory2 });
              }),
            },
            cartItem: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn((args) =>
                Promise.resolve(
                  createMockCartItem({
                    cartId,
                    productId: args.data.productId,
                    quantity: args.data.quantity,
                    priceSnapshot: args.data.priceSnapshot,
                  })
                )
              ),
            },
          };
          return callback(tx as any);
        });

        const [item1, item2] = await Promise.all([
          cartService.addItem(cartId, { productId: 'product-1', quantity: 1 }),
          cartService.addItem(cartId, { productId: 'product-2', quantity: 2 }),
        ]);

        expect(item1.productId).toBe('product-1');
        expect(item2.productId).toBe('product-2');
      });
    });
  });

  describe('Performance Tests', () => {
    it('should handle large cart efficiently', async () => {
      const cartId = 'cart-123';
      const items = Array.from({ length: 100 }, (_, i) => ({
        ...createMockCartItem({
          id: `item-${i}`,
          productId: `product-${i}`,
          quantity: 1,
          priceSnapshot: new Decimal('10.00'),
        }),
        product: createMockProduct({
          id: `product-${i}`,
          name: `Product ${i}`,
          price: new Decimal('10.00'),
        }),
      }));

      const mockCart = {
        ...createMockCart({ id: cartId }),
        items,
      };

      mockPrisma.cart.findUnique.mockResolvedValue(mockCart);

      const startTime = Date.now();
      const result = await cartService.getCart(cartId);
      const endTime = Date.now();

      expect(result.items).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in < 1 second
    });
  });
});