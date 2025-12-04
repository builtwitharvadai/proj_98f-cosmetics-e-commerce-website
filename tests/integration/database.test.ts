import { PrismaClient } from '@prisma/client';
import { prisma, connectWithRetry, disconnect, healthCheck, transaction } from '../../src/lib/prisma';

/**
 * Integration Test Suite for Prisma Database Operations
 * 
 * Test Categories:
 * - Database Connection Management
 * - CRUD Operations with Relationships
 * - Cascade Delete Behavior
 * - Transaction Handling
 * - Health Check Functionality
 * - Error Scenarios
 * 
 * Coverage Target: >80%
 * Complexity: Medium (Integration Testing)
 */

describe('Prisma Database Integration Tests', () => {
  // Test data cleanup tracking
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdInventoryIds: string[] = [];

  /**
   * Setup: Connect to test database before all tests
   */
  beforeAll(async () => {
    try {
      await connectWithRetry();
      console.log('[Test] Database connection established');
    } catch (error) {
      console.error('[Test] Failed to connect to database:', error);
      throw error;
    }
  });

  /**
   * Cleanup: Remove test data after each test
   */
  afterEach(async () => {
    try {
      // Clean up in reverse order of dependencies
      if (createdInventoryIds.length > 0) {
        await prisma.inventory.deleteMany({
          where: { id: { in: createdInventoryIds } },
        });
        createdInventoryIds.length = 0;
      }

      if (createdProductIds.length > 0) {
        await prisma.product.deleteMany({
          where: { id: { in: createdProductIds } },
        });
        createdProductIds.length = 0;
      }

      if (createdCategoryIds.length > 0) {
        await prisma.category.deleteMany({
          where: { id: { in: createdCategoryIds } },
        });
        createdCategoryIds.length = 0;
      }
    } catch (error) {
      console.error('[Test] Cleanup failed:', error);
    }
  });

  /**
   * Teardown: Disconnect from database after all tests
   */
  afterAll(async () => {
    try {
      await disconnect();
      console.log('[Test] Database connection closed');
    } catch (error) {
      console.error('[Test] Failed to disconnect:', error);
    }
  });

  // ============================================================================
  // 🎯 CATEGORY CRUD OPERATIONS
  // ============================================================================

  describe('Category Operations', () => {
    it('should create a category with valid data', async () => {
      // Arrange
      const categoryData = {
        name: 'Skincare',
        description: 'Premium skincare products',
        slug: 'skincare',
      };

      // Act
      const category = await prisma.category.create({
        data: categoryData,
      });
      createdCategoryIds.push(category.id);

      // Assert
      expect(category).toBeDefined();
      expect(category.id).toBeTruthy();
      expect(category.name).toBe(categoryData.name);
      expect(category.description).toBe(categoryData.description);
      expect(category.slug).toBe(categoryData.slug);
      expect(category.createdAt).toBeInstanceOf(Date);
      expect(category.updatedAt).toBeInstanceOf(Date);

      // Verify persistence
      const retrieved = await prisma.category.findUnique({
        where: { id: category.id },
      });
      expect(retrieved).toMatchObject(categoryData);
    });

    it('should retrieve category by unique slug', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Makeup',
          description: 'Professional makeup products',
          slug: 'makeup',
        },
      });
      createdCategoryIds.push(category.id);

      // Act
      const retrieved = await prisma.category.findUnique({
        where: { slug: 'makeup' },
      });

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(category.id);
      expect(retrieved?.name).toBe('Makeup');
    });

    it('should update category data', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Haircare',
          description: 'Hair products',
          slug: 'haircare',
        },
      });
      createdCategoryIds.push(category.id);

      // Act
      const updated = await prisma.category.update({
        where: { id: category.id },
        data: {
          description: 'Premium haircare solutions',
        },
      });

      // Assert
      expect(updated.description).toBe('Premium haircare solutions');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(category.updatedAt.getTime());
    });

    it('should enforce unique constraint on category name', async () => {
      // Arrange
      await prisma.category.create({
        data: {
          name: 'Fragrance',
          slug: 'fragrance',
        },
      });

      // Act & Assert
      await expect(
        prisma.category.create({
          data: {
            name: 'Fragrance',
            slug: 'fragrance-2',
          },
        })
      ).rejects.toThrow();
    });

    it('should enforce unique constraint on category slug', async () => {
      // Arrange
      await prisma.category.create({
        data: {
          name: 'Body Care',
          slug: 'body-care',
        },
      });

      // Act & Assert
      await expect(
        prisma.category.create({
          data: {
            name: 'Body Care Premium',
            slug: 'body-care',
          },
        })
      ).rejects.toThrow();
    });
  });

  // ============================================================================
  // 🔗 PRODUCT OPERATIONS WITH RELATIONSHIPS
  // ============================================================================

  describe('Product Operations with Category Relationship', () => {
    it('should create product with category relationship', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Moisturizers',
          slug: 'moisturizers',
        },
      });
      createdCategoryIds.push(category.id);

      const productData = {
        name: 'Hydrating Cream',
        description: 'Deep hydration for all skin types',
        price: 29.99,
        imageUrl: 'https://example.com/cream.jpg',
        categoryId: category.id,
      };

      // Act
      const product = await prisma.product.create({
        data: productData,
      });
      createdProductIds.push(product.id);

      // Assert
      expect(product).toBeDefined();
      expect(product.id).toBeTruthy();
      expect(product.name).toBe(productData.name);
      expect(product.categoryId).toBe(category.id);
      expect(product.price.toString()).toBe('29.99');
      expect(product.createdAt).toBeInstanceOf(Date);

      // Verify relationship
      const productWithCategory = await prisma.product.findUnique({
        where: { id: product.id },
        include: { category: true },
      });
      expect(productWithCategory?.category.id).toBe(category.id);
      expect(productWithCategory?.category.name).toBe('Moisturizers');
    });

    it('should query products with category included', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Serums',
          slug: 'serums',
        },
      });
      createdCategoryIds.push(category.id);

      const product = await prisma.product.create({
        data: {
          name: 'Vitamin C Serum',
          description: 'Brightening serum',
          price: 45.0,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product.id);

      // Act
      const products = await prisma.product.findMany({
        where: { categoryId: category.id },
        include: { category: true },
      });

      // Assert
      expect(products).toHaveLength(1);
      expect(products[0].id).toBe(product.id);
      expect(products[0].category).toBeDefined();
      expect(products[0].category.name).toBe('Serums');
    });

    it('should handle decimal price precision correctly', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Cleansers',
          slug: 'cleansers',
        },
      });
      createdCategoryIds.push(category.id);

      // Act
      const product = await prisma.product.create({
        data: {
          name: 'Gentle Cleanser',
          description: 'pH balanced cleanser',
          price: 19.95,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product.id);

      // Assert
      expect(product.price.toString()).toBe('19.95');
    });

    it('should fail to create product with non-existent category', async () => {
      // Arrange
      const nonExistentCategoryId = 'non-existent-id';

      // Act & Assert
      await expect(
        prisma.product.create({
          data: {
            name: 'Orphan Product',
            description: 'Product without valid category',
            price: 10.0,
            categoryId: nonExistentCategoryId,
          },
        })
      ).rejects.toThrow();
    });
  });

  // ============================================================================
  // 📦 INVENTORY OPERATIONS
  // ============================================================================

  describe('Inventory Operations with Product Relationship', () => {
    it('should create inventory for product', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Toners',
          slug: 'toners',
        },
      });
      createdCategoryIds.push(category.id);

      const product = await prisma.product.create({
        data: {
          name: 'Balancing Toner',
          description: 'Alcohol-free toner',
          price: 22.0,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product.id);

      const inventoryData = {
        productId: product.id,
        quantity: 100,
        reserved: 10,
        available: 90,
      };

      // Act
      const inventory = await prisma.inventory.create({
        data: inventoryData,
      });
      createdInventoryIds.push(inventory.id);

      // Assert
      expect(inventory).toBeDefined();
      expect(inventory.id).toBeTruthy();
      expect(inventory.productId).toBe(product.id);
      expect(inventory.quantity).toBe(100);
      expect(inventory.reserved).toBe(10);
      expect(inventory.available).toBe(90);

      // Verify relationship
      const inventoryWithProduct = await prisma.inventory.findUnique({
        where: { id: inventory.id },
        include: { product: true },
      });
      expect(inventoryWithProduct?.product.id).toBe(product.id);
    });

    it('should enforce unique constraint on productId', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Masks',
          slug: 'masks',
        },
      });
      createdCategoryIds.push(category.id);

      const product = await prisma.product.create({
        data: {
          name: 'Clay Mask',
          description: 'Purifying mask',
          price: 35.0,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product.id);

      await prisma.inventory.create({
        data: {
          productId: product.id,
          quantity: 50,
          reserved: 0,
          available: 50,
        },
      });

      // Act & Assert
      await expect(
        prisma.inventory.create({
          data: {
            productId: product.id,
            quantity: 100,
            reserved: 0,
            available: 100,
          },
        })
      ).rejects.toThrow();
    });

    it('should update inventory quantities', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Exfoliants',
          slug: 'exfoliants',
        },
      });
      createdCategoryIds.push(category.id);

      const product = await prisma.product.create({
        data: {
          name: 'Gentle Scrub',
          description: 'Physical exfoliant',
          price: 28.0,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product.id);

      const inventory = await prisma.inventory.create({
        data: {
          productId: product.id,
          quantity: 100,
          reserved: 0,
          available: 100,
        },
      });
      createdInventoryIds.push(inventory.id);

      // Act
      const updated = await prisma.inventory.update({
        where: { id: inventory.id },
        data: {
          reserved: 20,
          available: 80,
        },
      });

      // Assert
      expect(updated.reserved).toBe(20);
      expect(updated.available).toBe(80);
      expect(updated.quantity).toBe(100);
    });
  });

  // ============================================================================
  // 🔄 CASCADE DELETE OPERATIONS
  // ============================================================================

  describe('Cascade Delete Behavior', () => {
    it('should cascade delete products when category is deleted', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Sunscreen',
          slug: 'sunscreen',
        },
      });
      createdCategoryIds.push(category.id);

      const product1 = await prisma.product.create({
        data: {
          name: 'SPF 50 Sunscreen',
          description: 'High protection',
          price: 32.0,
          categoryId: category.id,
        },
      });

      const product2 = await prisma.product.create({
        data: {
          name: 'SPF 30 Sunscreen',
          description: 'Daily protection',
          price: 25.0,
          categoryId: category.id,
        },
      });

      // Act
      await prisma.category.delete({
        where: { id: category.id },
      });
      createdCategoryIds.pop(); // Remove from cleanup list

      // Assert
      const deletedProduct1 = await prisma.product.findUnique({
        where: { id: product1.id },
      });
      const deletedProduct2 = await prisma.product.findUnique({
        where: { id: product2.id },
      });

      expect(deletedProduct1).toBeNull();
      expect(deletedProduct2).toBeNull();
    });

    it('should cascade delete inventory when product is deleted', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Eye Care',
          slug: 'eye-care',
        },
      });
      createdCategoryIds.push(category.id);

      const product = await prisma.product.create({
        data: {
          name: 'Eye Cream',
          description: 'Anti-aging eye cream',
          price: 55.0,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product.id);

      const inventory = await prisma.inventory.create({
        data: {
          productId: product.id,
          quantity: 75,
          reserved: 5,
          available: 70,
        },
      });

      // Act
      await prisma.product.delete({
        where: { id: product.id },
      });
      createdProductIds.pop(); // Remove from cleanup list

      // Assert
      const deletedInventory = await prisma.inventory.findUnique({
        where: { id: inventory.id },
      });

      expect(deletedInventory).toBeNull();
    });

    it('should cascade delete entire hierarchy when category is deleted', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Lip Care',
          slug: 'lip-care',
        },
      });
      createdCategoryIds.push(category.id);

      const product = await prisma.product.create({
        data: {
          name: 'Lip Balm',
          description: 'Moisturizing lip balm',
          price: 8.99,
          categoryId: category.id,
        },
      });

      const inventory = await prisma.inventory.create({
        data: {
          productId: product.id,
          quantity: 200,
          reserved: 0,
          available: 200,
        },
      });

      // Act
      await prisma.category.delete({
        where: { id: category.id },
      });
      createdCategoryIds.pop(); // Remove from cleanup list

      // Assert
      const deletedProduct = await prisma.product.findUnique({
        where: { id: product.id },
      });
      const deletedInventory = await prisma.inventory.findUnique({
        where: { id: inventory.id },
      });

      expect(deletedProduct).toBeNull();
      expect(deletedInventory).toBeNull();
    });
  });

  // ============================================================================
  // 💼 TRANSACTION HANDLING
  // ============================================================================

  describe('Transaction Operations', () => {
    it('should execute multiple operations in a transaction', async () => {
      // Arrange
      const categoryData = {
        name: 'Bath Products',
        slug: 'bath-products',
      };

      const productData = {
        name: 'Bath Bomb',
        description: 'Relaxing bath bomb',
        price: 12.5,
      };

      // Act
      const result = await transaction(async (tx) => {
        const category = await tx.category.create({
          data: categoryData,
        });

        const product = await tx.product.create({
          data: {
            ...productData,
            categoryId: category.id,
          },
        });

        const inventory = await tx.inventory.create({
          data: {
            productId: product.id,
            quantity: 150,
            reserved: 0,
            available: 150,
          },
        });

        return { category, product, inventory };
      });

      createdCategoryIds.push(result.category.id);
      createdProductIds.push(result.product.id);
      createdInventoryIds.push(result.inventory.id);

      // Assert
      expect(result.category).toBeDefined();
      expect(result.product).toBeDefined();
      expect(result.inventory).toBeDefined();
      expect(result.product.categoryId).toBe(result.category.id);
      expect(result.inventory.productId).toBe(result.product.id);
    });

    it('should rollback transaction on error', async () => {
      // Arrange
      const categoryData = {
        name: 'Nail Care',
        slug: 'nail-care',
      };

      // Act & Assert
      await expect(
        transaction(async (tx) => {
          const category = await tx.category.create({
            data: categoryData,
          });

          // This should fail due to invalid categoryId
          await tx.product.create({
            data: {
              name: 'Nail Polish',
              description: 'Long-lasting polish',
              price: 15.0,
              categoryId: 'invalid-id',
            },
          });

          return category;
        })
      ).rejects.toThrow();

      // Verify rollback - category should not exist
      const category = await prisma.category.findFirst({
        where: { name: 'Nail Care' },
      });
      expect(category).toBeNull();
    });
  });

  // ============================================================================
  // 🏥 HEALTH CHECK AND CONNECTION MANAGEMENT
  // ============================================================================

  describe('Health Check and Connection Management', () => {
    it('should return true for successful health check', async () => {
      // Act
      const isHealthy = await healthCheck();

      // Assert
      expect(isHealthy).toBe(true);
    });

    it('should verify database connectivity', async () => {
      // Act
      const result = await prisma.$queryRaw`SELECT 1 as result`;

      // Assert
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle connection retry logic', async () => {
      // This test verifies the retry mechanism exists
      // In a real scenario, you'd mock connection failures
      
      // Act
      await expect(connectWithRetry()).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // ⚠️ ERROR SCENARIOS
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle invalid data types gracefully', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Test Category',
          slug: 'test-category',
        },
      });
      createdCategoryIds.push(category.id);

      // Act & Assert - Invalid price type
      await expect(
        prisma.product.create({
          data: {
            name: 'Invalid Product',
            description: 'Test',
            price: 'not-a-number' as any,
            categoryId: category.id,
          },
        })
      ).rejects.toThrow();
    });

    it('should handle missing required fields', async () => {
      // Act & Assert
      await expect(
        prisma.category.create({
          data: {
            name: 'Incomplete Category',
            // Missing required slug field
          } as any,
        })
      ).rejects.toThrow();
    });

    it('should handle query on non-existent records', async () => {
      // Act
      const result = await prisma.category.findUnique({
        where: { id: 'non-existent-id' },
      });

      // Assert
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // 🔍 COMPLEX QUERIES
  // ============================================================================

  describe('Complex Query Operations', () => {
    it('should query products with nested category and inventory', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Premium Skincare',
          slug: 'premium-skincare',
          description: 'Luxury skincare line',
        },
      });
      createdCategoryIds.push(category.id);

      const product = await prisma.product.create({
        data: {
          name: 'Luxury Serum',
          description: 'Premium anti-aging serum',
          price: 120.0,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product.id);

      const inventory = await prisma.inventory.create({
        data: {
          productId: product.id,
          quantity: 50,
          reserved: 5,
          available: 45,
        },
      });
      createdInventoryIds.push(inventory.id);

      // Act
      const result = await prisma.product.findUnique({
        where: { id: product.id },
        include: {
          category: true,
          inventory: true,
        },
      });

      // Assert
      expect(result).toBeDefined();
      expect(result?.category).toBeDefined();
      expect(result?.category.name).toBe('Premium Skincare');
      expect(result?.inventory).toBeDefined();
      expect(result?.inventory?.quantity).toBe(50);
      expect(result?.inventory?.available).toBe(45);
    });

    it('should filter products by price range', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Budget Skincare',
          slug: 'budget-skincare',
        },
      });
      createdCategoryIds.push(category.id);

      const product1 = await prisma.product.create({
        data: {
          name: 'Affordable Cream',
          description: 'Budget-friendly',
          price: 15.0,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product1.id);

      const product2 = await prisma.product.create({
        data: {
          name: 'Premium Cream',
          description: 'High-end',
          price: 85.0,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product2.id);

      // Act
      const affordableProducts = await prisma.product.findMany({
        where: {
          price: {
            lte: 50.0,
          },
          categoryId: category.id,
        },
      });

      // Assert
      expect(affordableProducts).toHaveLength(1);
      expect(affordableProducts[0].name).toBe('Affordable Cream');
    });

    it('should count products by category', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Organic Products',
          slug: 'organic-products',
        },
      });
      createdCategoryIds.push(category.id);

      const product1 = await prisma.product.create({
        data: {
          name: 'Organic Cleanser',
          description: 'Natural cleanser',
          price: 30.0,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product1.id);

      const product2 = await prisma.product.create({
        data: {
          name: 'Organic Moisturizer',
          description: 'Natural moisturizer',
          price: 40.0,
          categoryId: category.id,
        },
      });
      createdProductIds.push(product2.id);

      // Act
      const count = await prisma.product.count({
        where: { categoryId: category.id },
      });

      // Assert
      expect(count).toBe(2);
    });
  });

  // ============================================================================
  // 📊 PERFORMANCE AND INDEXING
  // ============================================================================

  describe('Performance and Indexing', () => {
    it('should efficiently query by indexed slug field', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Performance Test',
          slug: 'performance-test',
        },
      });
      createdCategoryIds.push(category.id);

      // Act
      const startTime = Date.now();
      const result = await prisma.category.findUnique({
        where: { slug: 'performance-test' },
      });
      const endTime = Date.now();

      // Assert
      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(100); // Should be fast due to index
    });

    it('should efficiently query products by categoryId index', async () => {
      // Arrange
      const category = await prisma.category.create({
        data: {
          name: 'Index Test',
          slug: 'index-test',
        },
      });
      createdCategoryIds.push(category.id);

      // Create multiple products
      for (let i = 0; i < 5; i++) {
        const product = await prisma.product.create({
          data: {
            name: `Product ${i}`,
            description: `Test product ${i}`,
            price: 10.0 + i,
            categoryId: category.id,
          },
        });
        createdProductIds.push(product.id);
      }

      // Act
      const startTime = Date.now();
      const products = await prisma.product.findMany({
        where: { categoryId: category.id },
      });
      const endTime = Date.now();

      // Assert
      expect(products).toHaveLength(5);
      expect(endTime - startTime).toBeLessThan(100); // Should be fast due to index
    });
  });
});