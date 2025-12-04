import { PrismaClient } from '@prisma/client';

/**
 * Database seeding script for cosmetics e-commerce platform
 * Populates initial categories and products for development and testing
 *
 * Usage: npx prisma db seed
 */

const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

/**
 * Seed data structure for categories with nested products
 */
interface SeedCategory {
  name: string;
  description: string;
  slug: string;
  products: Array<{
    name: string;
    description: string;
    price: number;
    imageUrl: string;
    inventory: {
      quantity: number;
      reserved: number;
    };
  }>;
}

/**
 * Seed data for cosmetics categories and products
 */
const seedData: SeedCategory[] = [
  {
    name: 'Skincare',
    description: 'Premium skincare products for all skin types',
    slug: 'skincare',
    products: [
      {
        name: 'Hydrating Facial Serum',
        description:
          'Intensive hydration serum with hyaluronic acid and vitamin E. Suitable for all skin types.',
        price: 45.99,
        imageUrl: '/images/products/hydrating-serum.jpg',
        inventory: {
          quantity: 150,
          reserved: 0,
        },
      },
      {
        name: 'Anti-Aging Night Cream',
        description:
          'Rich night cream with retinol and peptides to reduce fine lines and wrinkles.',
        price: 68.5,
        imageUrl: '/images/products/night-cream.jpg',
        inventory: {
          quantity: 120,
          reserved: 5,
        },
      },
      {
        name: 'Gentle Cleansing Foam',
        description:
          'pH-balanced cleansing foam that removes impurities without stripping natural oils.',
        price: 28.0,
        imageUrl: '/images/products/cleansing-foam.jpg',
        inventory: {
          quantity: 200,
          reserved: 10,
        },
      },
    ],
  },
  {
    name: 'Makeup',
    description: 'High-quality makeup products for every occasion',
    slug: 'makeup',
    products: [
      {
        name: 'Long-Lasting Foundation',
        description:
          '24-hour wear foundation with buildable coverage and SPF 30 protection.',
        price: 42.0,
        imageUrl: '/images/products/foundation.jpg',
        inventory: {
          quantity: 180,
          reserved: 15,
        },
      },
      {
        name: 'Volumizing Mascara',
        description:
          'Waterproof mascara that adds dramatic volume and length without clumping.',
        price: 24.99,
        imageUrl: '/images/products/mascara.jpg',
        inventory: {
          quantity: 250,
          reserved: 20,
        },
      },
      {
        name: 'Matte Lipstick Collection',
        description:
          'Set of 5 highly pigmented matte lipsticks in versatile shades.',
        price: 55.0,
        imageUrl: '/images/products/lipstick-set.jpg',
        inventory: {
          quantity: 100,
          reserved: 8,
        },
      },
    ],
  },
  {
    name: 'Haircare',
    description: 'Professional haircare solutions for healthy, beautiful hair',
    slug: 'haircare',
    products: [
      {
        name: 'Repairing Shampoo',
        description:
          'Sulfate-free shampoo enriched with keratin and argan oil for damaged hair.',
        price: 32.5,
        imageUrl: '/images/products/shampoo.jpg',
        inventory: {
          quantity: 175,
          reserved: 12,
        },
      },
      {
        name: 'Deep Conditioning Mask',
        description:
          'Intensive treatment mask that restores moisture and shine to dry, brittle hair.',
        price: 38.0,
        imageUrl: '/images/products/hair-mask.jpg',
        inventory: {
          quantity: 140,
          reserved: 7,
        },
      },
    ],
  },
  {
    name: 'Fragrance',
    description: 'Luxurious fragrances for every personality',
    slug: 'fragrance',
    products: [
      {
        name: 'Floral Eau de Parfum',
        description:
          'Elegant floral fragrance with notes of jasmine, rose, and vanilla. 50ml bottle.',
        price: 89.99,
        imageUrl: '/images/products/floral-perfume.jpg',
        inventory: {
          quantity: 80,
          reserved: 5,
        },
      },
      {
        name: 'Citrus Fresh Cologne',
        description:
          'Refreshing citrus scent with bergamot, lemon, and cedarwood. Perfect for daily wear.',
        price: 65.0,
        imageUrl: '/images/products/citrus-cologne.jpg',
        inventory: {
          quantity: 95,
          reserved: 3,
        },
      },
      {
        name: 'Oriental Spice Perfume',
        description:
          'Warm and exotic fragrance with amber, sandalwood, and spices. Long-lasting formula.',
        price: 95.0,
        imageUrl: '/images/products/oriental-perfume.jpg',
        inventory: {
          quantity: 60,
          reserved: 2,
        },
      },
    ],
  },
  {
    name: 'Tools',
    description: 'Professional beauty tools and accessories',
    slug: 'tools',
    products: [
      {
        name: 'Makeup Brush Set',
        description:
          'Professional 12-piece brush set with synthetic bristles and ergonomic handles.',
        price: 78.0,
        imageUrl: '/images/products/brush-set.jpg',
        inventory: {
          quantity: 110,
          reserved: 6,
        },
      },
      {
        name: 'Facial Cleansing Device',
        description:
          'Sonic cleansing brush with 3 speed settings and waterproof design.',
        price: 125.0,
        imageUrl: '/images/products/cleansing-device.jpg',
        inventory: {
          quantity: 50,
          reserved: 4,
        },
      },
    ],
  },
];

/**
 * Main seeding function
 * Deletes existing data and creates fresh seed data
 */
async function main(): Promise<void> {
  console.log('[Seed] Starting database seeding...');

  try {
    // Delete existing data in correct order (respecting foreign key constraints)
    console.log('[Seed] Cleaning existing data...');

    const deletedInventory = await prisma.inventory.deleteMany();
    console.log(`[Seed] Deleted ${deletedInventory.count} inventory records`);

    const deletedProducts = await prisma.product.deleteMany();
    console.log(`[Seed] Deleted ${deletedProducts.count} products`);

    const deletedCategories = await prisma.category.deleteMany();
    console.log(`[Seed] Deleted ${deletedCategories.count} categories`);

    // Create categories with nested products and inventory
    console.log('[Seed] Creating categories and products...');

    let totalProducts = 0;
    let totalInventory = 0;

    for (const categoryData of seedData) {
      const category = await prisma.category.create({
        data: {
          name: categoryData.name,
          description: categoryData.description,
          slug: categoryData.slug,
          products: {
            create: categoryData.products.map((product) => ({
              name: product.name,
              description: product.description,
              price: product.price,
              imageUrl: product.imageUrl,
              inventory: {
                create: {
                  quantity: product.inventory.quantity,
                  reserved: product.inventory.reserved,
                  available:
                    product.inventory.quantity - product.inventory.reserved,
                },
              },
            })),
          },
        },
        include: {
          products: {
            include: {
              inventory: true,
            },
          },
        },
      });

      totalProducts += category.products.length;
      totalInventory += category.products.length;

      console.log(
        `[Seed] Created category "${category.name}" with ${category.products.length} products`
      );
    }

    console.log('[Seed] Database seeding completed successfully!');
    console.log(`[Seed] Summary:`);
    console.log(`  - Categories: ${seedData.length}`);
    console.log(`  - Products: ${totalProducts}`);
    console.log(`  - Inventory records: ${totalInventory}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Seed] Error during seeding:', errorMessage);

    if (error instanceof Error && error.stack) {
      console.error('[Seed] Stack trace:', error.stack);
    }

    throw error;
  }
}

/**
 * Execute seeding with proper error handling and cleanup
 */
main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('[Seed] Database connection closed');
    process.exit(0);
  })
  .catch(async (error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Seed] Fatal error:', errorMessage);

    await prisma.$disconnect();
    console.log('[Seed] Database connection closed after error');
    process.exit(1);
  });