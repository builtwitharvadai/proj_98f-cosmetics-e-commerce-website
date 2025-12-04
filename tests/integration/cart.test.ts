import request from 'supertest';
import app from '../../src/index';
import { prisma } from '../../src/lib/prisma';
import { Cart, CartItem, Product, Category, Inventory } from '@prisma/client';

/**
 * Integration Test Suite for Cart API
 * 
 * Tests all cart operations including:
 * - Adding items to cart
 * - Retrieving cart with calculations
 * - Updating item quantities
 * - Removing items
 * - Clearing cart
 * - Session management
 * - Inventory validation
 * - Error handling
 */

describe('Cart API Integration Tests', () => {
  let testCategory: Category;
  let testProducts: Product[];
  let testInventory: Inventory[];
  let sessionCookie: string;

  /**
   * Setup: Create test data before all tests
   */
  beforeAll(async () => {
    // Create test category
    testCategory = await prisma.category.create({
      data: {
        name: 'Test Cosmetics',
        description: 'Test category for integration tests',
        slug: 'test-cosmetics',
      },
    });

    // Create test products with inventory
    const productData = [
      {
        name: 'Test Lipstick',
        description: 'Premium test lipstick',
        price: 29.99,
        imageUrl: 'https://example.com/lipstick.jpg',
        categoryId: testCategory.id,
      },
      {
        name: 'Test Foundation',
        description: 'Long-lasting test foundation',
        price: 49.99,
        imageUrl: 'https://example.com/foundation.jpg',
        categoryId: testCategory.id,
      },
      {
        name: 'Test Mascara',
        description: 'Volumizing test mascara',
        price: 19.99,
        imageUrl: 'https://example.com/mascara.jpg',
        categoryId: testCategory.id,
      },
    ];

    testProducts = await Promise.all(
      productData.map((data) => prisma.product.create({ data }))
    );

    // Create inventory for test products
    testInventory = await Promise.all(
      testProducts.map((product, index) =>
        prisma.inventory.create({
          data: {
            productId: product.id,
            quantity: 100 + index * 50, // 100, 150, 200
            reserved: 0,
            available: 100 + index * 50,
          },
        })
      )
    );

    // Initialize session by making a request
    const response = await request(app).get('/api/cart');
    sessionCookie = response.headers['set-cookie']?.[0] || '';
  });

  /**
   * Cleanup: Remove test data after all tests
   */
  afterAll(async () => {
    // Delete in correct order due to foreign key constraints
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({});
    await prisma.inventory.deleteMany({
      where: { productId: { in: testProducts.map((p) => p.id) } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: testProducts.map((p) => p.id) } },
    });
    await prisma.category.delete({
      where: { id: testCategory.id },
    });

    await prisma.$disconnect();
  });

  /**
   * Reset cart between tests for isolation
   */
  afterEach(async () => {
    const carts = await prisma.cart.findMany({});
    for (const cart of carts) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }
  });

  describe('POST /api/cart/items - Add Item to Cart', () => {
    it('should add item to cart with valid data', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        })
        .expect(201);

      expect(response.body).toMatchObject({
        productId: testProducts[0].id,
        quantity: 2,
        priceSnapshot: 29.99,
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.cartId).toBeDefined();
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();

      // Verify item exists in database
      const cartItem = await prisma.cartItem.findUnique({
        where: { id: response.body.id },
      });
      expect(cartItem).toBeDefined();
      expect(cartItem?.quantity).toBe(2);
    });

    it('should update quantity when adding existing item', async () => {
      // Add item first time
      const firstResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        })
        .expect(201);

      // Add same item again
      const secondResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 3,
        })
        .expect(201);

      // Should return same item with updated quantity
      expect(secondResponse.body.id).toBe(firstResponse.body.id);
      expect(secondResponse.body.quantity).toBe(5); // 2 + 3

      // Verify in database
      const cartItem = await prisma.cartItem.findUnique({
        where: { id: firstResponse.body.id },
      });
      expect(cartItem?.quantity).toBe(5);
    });

    it('should validate inventory availability', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 200, // Exceeds available inventory (100)
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'INSUFFICIENT_INVENTORY',
        message: expect.stringContaining('Insufficient inventory'),
      });
    });

    it('should reject invalid quantity (zero)', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 0,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'INVALID_QUANTITY',
        message: expect.stringContaining('Must be greater than 0'),
      });
    });

    it('should reject invalid quantity (negative)', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: -5,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'INVALID_QUANTITY',
        message: expect.stringContaining('Must be greater than 0'),
      });
    });

    it('should reject non-integer quantity', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2.5,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'INVALID_INPUT',
        message: expect.stringContaining('quantity (integer)'),
      });
    });

    it('should reject non-existent product', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: 'non-existent-id',
          quantity: 1,
        })
        .expect(404);

      expect(response.body).toMatchObject({
        error: 'PRODUCT_NOT_FOUND',
        message: expect.stringContaining('Product not found'),
      });
    });

    it('should reject missing productId', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          quantity: 1,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'INVALID_INPUT',
        message: expect.stringContaining('productId'),
      });
    });

    it('should reject missing quantity', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'INVALID_INPUT',
        message: expect.stringContaining('quantity'),
      });
    });

    it('should reject empty request body', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({})
        .expect(400);

      expect(response.body.error).toBe('INVALID_INPUT');
    });

    it('should capture price snapshot at time of adding', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 1,
        })
        .expect(201);

      expect(response.body.priceSnapshot).toBe(29.99);

      // Verify price snapshot in database
      const cartItem = await prisma.cartItem.findUnique({
        where: { id: response.body.id },
      });
      expect(Number(cartItem?.priceSnapshot)).toBe(29.99);
    });
  });

  describe('GET /api/cart - Get Cart with Calculations', () => {
    it('should return empty cart initially', async () => {
      const response = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(response.body).toMatchObject({
        items: [],
        subtotal: 0,
        tax: 0,
        total: 0,
        itemCount: 0,
      });
      expect(response.body.id).toBeDefined();
    });

    it('should return cart with single item and calculations', async () => {
      // Add item
      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      // Get cart
      const response = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({
        productId: testProducts[0].id,
        productName: 'Test Lipstick',
        quantity: 2,
        priceSnapshot: 29.99,
        subtotal: 59.98, // 29.99 * 2
      });

      // Verify calculations (8% tax rate)
      expect(response.body.subtotal).toBe(59.98);
      expect(response.body.tax).toBeCloseTo(4.8, 2); // 59.98 * 0.08
      expect(response.body.total).toBeCloseTo(64.78, 2); // 59.98 + 4.8
      expect(response.body.itemCount).toBe(2);
    });

    it('should return cart with multiple items and correct calculations', async () => {
      // Add multiple items
      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[1].id,
          quantity: 1,
        });

      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[2].id,
          quantity: 3,
        });

      // Get cart
      const response = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(response.body.items).toHaveLength(3);

      // Verify subtotal: (29.99 * 2) + (49.99 * 1) + (19.99 * 3) = 169.93
      expect(response.body.subtotal).toBeCloseTo(169.93, 2);

      // Verify tax: 169.93 * 0.08 = 13.59
      expect(response.body.tax).toBeCloseTo(13.59, 2);

      // Verify total: 169.93 + 13.59 = 183.52
      expect(response.body.total).toBeCloseTo(183.52, 2);

      // Verify item count: 2 + 1 + 3 = 6
      expect(response.body.itemCount).toBe(6);
    });

    it('should include product details in cart items', async () => {
      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 1,
        });

      const response = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(response.body.items[0]).toMatchObject({
        productId: testProducts[0].id,
        productName: 'Test Lipstick',
        productImage: 'https://example.com/lipstick.jpg',
        quantity: 1,
        priceSnapshot: 29.99,
        subtotal: 29.99,
      });
      expect(response.body.items[0].id).toBeDefined();
    });
  });

  describe('PUT /api/cart/items/:id - Update Item Quantity', () => {
    it('should update item quantity successfully', async () => {
      // Add item
      const addResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      const itemId = addResponse.body.id;

      // Update quantity
      const updateResponse = await request(app)
        .put(`/api/cart/items/${itemId}`)
        .set('Cookie', sessionCookie)
        .send({
          quantity: 5,
        })
        .expect(200);

      expect(updateResponse.body).toMatchObject({
        id: itemId,
        quantity: 5,
        productId: testProducts[0].id,
      });

      // Verify in database
      const cartItem = await prisma.cartItem.findUnique({
        where: { id: itemId },
      });
      expect(cartItem?.quantity).toBe(5);
    });

    it('should validate inventory when updating quantity', async () => {
      // Add item
      const addResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      const itemId = addResponse.body.id;

      // Try to update to quantity exceeding inventory
      const updateResponse = await request(app)
        .put(`/api/cart/items/${itemId}`)
        .set('Cookie', sessionCookie)
        .send({
          quantity: 200, // Exceeds available inventory (100)
        })
        .expect(400);

      expect(updateResponse.body).toMatchObject({
        error: 'INSUFFICIENT_INVENTORY',
        message: expect.stringContaining('Insufficient inventory'),
      });

      // Verify quantity unchanged in database
      const cartItem = await prisma.cartItem.findUnique({
        where: { id: itemId },
      });
      expect(cartItem?.quantity).toBe(2);
    });

    it('should reject invalid quantity (zero)', async () => {
      const addResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      const itemId = addResponse.body.id;

      const updateResponse = await request(app)
        .put(`/api/cart/items/${itemId}`)
        .set('Cookie', sessionCookie)
        .send({
          quantity: 0,
        })
        .expect(400);

      expect(updateResponse.body).toMatchObject({
        error: 'INVALID_QUANTITY',
        message: expect.stringContaining('Must be greater than 0'),
      });
    });

    it('should reject invalid quantity (negative)', async () => {
      const addResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      const itemId = addResponse.body.id;

      const updateResponse = await request(app)
        .put(`/api/cart/items/${itemId}`)
        .set('Cookie', sessionCookie)
        .send({
          quantity: -3,
        })
        .expect(400);

      expect(updateResponse.body).toMatchObject({
        error: 'INVALID_QUANTITY',
        message: expect.stringContaining('Must be greater than 0'),
      });
    });

    it('should reject non-integer quantity', async () => {
      const addResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      const itemId = addResponse.body.id;

      const updateResponse = await request(app)
        .put(`/api/cart/items/${itemId}`)
        .set('Cookie', sessionCookie)
        .send({
          quantity: 3.5,
        })
        .expect(400);

      expect(updateResponse.body).toMatchObject({
        error: 'INVALID_INPUT',
        message: expect.stringContaining('quantity (integer)'),
      });
    });

    it('should reject non-existent item', async () => {
      const response = await request(app)
        .put('/api/cart/items/non-existent-id')
        .set('Cookie', sessionCookie)
        .send({
          quantity: 5,
        })
        .expect(404);

      expect(response.body).toMatchObject({
        error: 'CART_ITEM_NOT_FOUND',
        message: expect.stringContaining('Cart item not found'),
      });
    });

    it('should reject missing quantity', async () => {
      const addResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      const itemId = addResponse.body.id;

      const updateResponse = await request(app)
        .put(`/api/cart/items/${itemId}`)
        .set('Cookie', sessionCookie)
        .send({})
        .expect(400);

      expect(updateResponse.body.error).toBe('INVALID_INPUT');
    });

    it('should reject invalid item ID format', async () => {
      const response = await request(app)
        .put('/api/cart/items/')
        .set('Cookie', sessionCookie)
        .send({
          quantity: 5,
        })
        .expect(404); // Express returns 404 for missing route parameter
    });
  });

  describe('DELETE /api/cart/items/:id - Remove Item', () => {
    it('should remove item from cart successfully', async () => {
      // Add item
      const addResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      const itemId = addResponse.body.id;

      // Remove item
      await request(app)
        .delete(`/api/cart/items/${itemId}`)
        .set('Cookie', sessionCookie)
        .expect(204);

      // Verify item removed from database
      const cartItem = await prisma.cartItem.findUnique({
        where: { id: itemId },
      });
      expect(cartItem).toBeNull();
    });

    it('should remove item without affecting other items', async () => {
      // Add multiple items
      const item1Response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      const item2Response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[1].id,
          quantity: 1,
        });

      // Remove first item
      await request(app)
        .delete(`/api/cart/items/${item1Response.body.id}`)
        .set('Cookie', sessionCookie)
        .expect(204);

      // Verify first item removed
      const item1 = await prisma.cartItem.findUnique({
        where: { id: item1Response.body.id },
      });
      expect(item1).toBeNull();

      // Verify second item still exists
      const item2 = await prisma.cartItem.findUnique({
        where: { id: item2Response.body.id },
      });
      expect(item2).toBeDefined();
      expect(item2?.quantity).toBe(1);
    });

    it('should reject non-existent item', async () => {
      const response = await request(app)
        .delete('/api/cart/items/non-existent-id')
        .set('Cookie', sessionCookie)
        .expect(404);

      expect(response.body).toMatchObject({
        error: 'CART_ITEM_NOT_FOUND',
        message: expect.stringContaining('Cart item not found'),
      });
    });

    it('should reject empty item ID', async () => {
      const response = await request(app)
        .delete('/api/cart/items/')
        .set('Cookie', sessionCookie)
        .expect(404); // Express returns 404 for missing route parameter
    });
  });

  describe('DELETE /api/cart - Clear Cart', () => {
    it('should clear all items from cart', async () => {
      // Add multiple items
      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[1].id,
          quantity: 1,
        });

      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[2].id,
          quantity: 3,
        });

      // Clear cart
      await request(app)
        .delete('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(204);

      // Verify cart is empty
      const cartResponse = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(cartResponse.body.items).toHaveLength(0);
      expect(cartResponse.body.itemCount).toBe(0);
      expect(cartResponse.body.total).toBe(0);
    });

    it('should handle clearing empty cart', async () => {
      await request(app)
        .delete('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(204);

      // Verify cart is still empty
      const cartResponse = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(cartResponse.body.items).toHaveLength(0);
    });
  });

  describe('Session Management', () => {
    it('should persist cart across requests with same session', async () => {
      // Add item
      const addResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      // Get cart with same session
      const cartResponse = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(cartResponse.body.items).toHaveLength(1);
      expect(cartResponse.body.items[0].id).toBe(addResponse.body.id);
    });

    it('should create separate carts for different sessions', async () => {
      // First session - add item
      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      // Second session - get cart (should be empty)
      const newSessionResponse = await request(app).get('/api/cart');

      const newSessionCookie = newSessionResponse.headers['set-cookie']?.[0] || '';

      expect(newSessionResponse.body.items).toHaveLength(0);

      // Verify first session cart still has item
      const firstSessionCart = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(firstSessionCart.body.items).toHaveLength(1);
    });

    it('should handle missing session gracefully', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .send({
          productId: testProducts[0].id,
          quantity: 2,
        });

      // Should create new session automatically
      expect(response.status).toBe(201);
      expect(response.headers['set-cookie']).toBeDefined();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle concurrent add operations', async () => {
      const promises = Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/cart/items')
          .set('Cookie', sessionCookie)
          .send({
            productId: testProducts[0].id,
            quantity: 1,
          })
      );

      const responses = await Promise.all(promises);

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(201);
      });

      // Verify final quantity is correct
      const cartResponse = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie);

      expect(cartResponse.body.items[0].quantity).toBe(5);
    });

    it('should handle database connection errors gracefully', async () => {
      // Disconnect prisma temporarily
      await prisma.$disconnect();

      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 1,
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('INTERNAL_SERVER_ERROR');

      // Reconnect for other tests
      await prisma.$connect();
    });

    it('should validate request content-type', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .set('Content-Type', 'text/plain')
        .send('invalid data');

      expect(response.status).toBe(400);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}');

      expect(response.status).toBe(400);
    });

    it('should handle very large quantities', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: Number.MAX_SAFE_INTEGER,
        })
        .expect(400);

      expect(response.body.error).toBe('INSUFFICIENT_INVENTORY');
    });

    it('should handle special characters in product IDs', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: "'; DROP TABLE products; --",
          quantity: 1,
        })
        .expect(404);

      expect(response.body.error).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('Performance and Load Tests', () => {
    it('should handle adding multiple items efficiently', async () => {
      const startTime = Date.now();

      const promises = testProducts.map((product) =>
        request(app)
          .post('/api/cart/items')
          .set('Cookie', sessionCookie)
          .send({
            productId: product.id,
            quantity: 1,
          })
      );

      await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (2 seconds for 3 items)
      expect(duration).toBeLessThan(2000);
    });

    it('should retrieve cart with many items efficiently', async () => {
      // Add multiple items
      await Promise.all(
        testProducts.map((product) =>
          request(app)
            .post('/api/cart/items')
            .set('Cookie', sessionCookie)
            .send({
              productId: product.id,
              quantity: 5,
            })
        )
      );

      const startTime = Date.now();

      const response = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should retrieve within reasonable time (500ms)
      expect(duration).toBeLessThan(500);
      expect(response.body.items).toHaveLength(3);
    });
  });

  describe('Security Tests', () => {
    it('should prevent SQL injection in product ID', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: "1' OR '1'='1",
          quantity: 1,
        })
        .expect(404);

      expect(response.body.error).toBe('PRODUCT_NOT_FOUND');
    });

    it('should prevent XSS in product data', async () => {
      const response = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie)
        .expect(200);

      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toContain('<script>');
      expect(responseText).not.toContain('javascript:');
    });

    it('should sanitize error messages', async () => {
      const response = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: '<script>alert("xss")</script>',
          quantity: 1,
        })
        .expect(404);

      expect(response.body.message).not.toContain('<script>');
    });

    it('should prevent session hijacking', async () => {
      // Add item with valid session
      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 1,
        });

      // Try to access with modified session
      const tamperedCookie = sessionCookie.replace(/s:/, 's:tampered');

      const response = await request(app)
        .get('/api/cart')
        .set('Cookie', tamperedCookie);

      // Should create new session, not access existing cart
      expect(response.body.items).toHaveLength(0);
    });
  });

  describe('Business Logic Validation', () => {
    it('should calculate tax correctly for different amounts', async () => {
      const testCases = [
        { quantity: 1, expectedSubtotal: 29.99, expectedTax: 2.4 },
        { quantity: 5, expectedSubtotal: 149.95, expectedTax: 12.0 },
        { quantity: 10, expectedSubtotal: 299.9, expectedTax: 24.0 },
      ];

      for (const testCase of testCases) {
        // Clear cart
        await request(app).delete('/api/cart').set('Cookie', sessionCookie);

        // Add item
        await request(app)
          .post('/api/cart/items')
          .set('Cookie', sessionCookie)
          .send({
            productId: testProducts[0].id,
            quantity: testCase.quantity,
          });

        // Get cart
        const response = await request(app)
          .get('/api/cart')
          .set('Cookie', sessionCookie);

        expect(response.body.subtotal).toBeCloseTo(testCase.expectedSubtotal, 2);
        expect(response.body.tax).toBeCloseTo(testCase.expectedTax, 1);
      }
    });

    it('should maintain price snapshot even if product price changes', async () => {
      // Add item
      const addResponse = await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[0].id,
          quantity: 1,
        });

      const originalPrice = addResponse.body.priceSnapshot;

      // Update product price
      await prisma.product.update({
        where: { id: testProducts[0].id },
        data: { price: 39.99 },
      });

      // Get cart - should still use original price
      const cartResponse = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie);

      expect(cartResponse.body.items[0].priceSnapshot).toBe(originalPrice);
      expect(cartResponse.body.items[0].priceSnapshot).not.toBe(39.99);

      // Restore original price
      await prisma.product.update({
        where: { id: testProducts[0].id },
        data: { price: 29.99 },
      });
    });

    it('should round monetary values correctly', async () => {
      // Add items that create rounding scenarios
      await request(app)
        .post('/api/cart/items')
        .set('Cookie', sessionCookie)
        .send({
          productId: testProducts[2].id, // $19.99
          quantity: 3, // $59.97
        });

      const response = await request(app)
        .get('/api/cart')
        .set('Cookie', sessionCookie);

      // Verify no floating point errors
      expect(response.body.subtotal).toBe(59.97);
      expect(response.body.tax).toBeCloseTo(4.8, 2);
      expect(response.body.total).toBeCloseTo(64.77, 2);

      // Verify values are properly rounded to 2 decimal places
      expect(response.body.subtotal.toString()).toMatch(/^\d+\.\d{2}$/);
      expect(response.body.tax.toString()).toMatch(/^\d+\.\d{1,2}$/);
      expect(response.body.total.toString()).toMatch(/^\d+\.\d{1,2}$/);
    });
  });
});