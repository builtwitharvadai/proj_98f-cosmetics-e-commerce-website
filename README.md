# Cosmetics E-commerce Website

A full-stack e-commerce platform for cosmetics built with modern web technologies, featuring a React frontend and Express.js backend with TypeScript throughout.

## Overview

This platform provides a complete e-commerce solution for cosmetics retailers, including product catalog management, shopping cart functionality, user authentication, order processing, and payment integration. The application is built as a monorepo with separate frontend and backend workspaces, ensuring clean separation of concerns and independent scalability.

## Features

- **Shopping Cart** - Add products to cart, manage quantities, and view totals with automatic tax calculation
- **Product Catalog** - Browse and search cosmetics products
- **User Authentication** - Secure user registration and login
- **Order Processing** - Complete checkout and order management
- **Payment Integration** - Secure payment processing
- **Session Management** - Persistent shopping experience across sessions

## Tech Stack

### Frontend
- **React 18.2** - Modern UI library with hooks and concurrent features
- **TypeScript 5.3** - Type-safe JavaScript with strict mode enabled
- **Vite 5.0** - Fast build tool and development server
- **ESLint 9.0** - Code quality and consistency enforcement
- **Prettier 3.1** - Automated code formatting

### Backend
- **Express.js 4.18** - Minimal and flexible Node.js web framework
- **TypeScript 5.3** - Type-safe server-side code
- **PostgreSQL** - Relational database for structured data
- **Redis** - In-memory cache for session management and performance

### Development Tools
- **ESLint** with TypeScript and React plugins
- **Prettier** for consistent code formatting
- **TypeScript** compiler with strict type checking
- **npm workspaces** for monorepo management

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **PostgreSQL** (for database)
- **Redis** >= 7.0 (for session storage and caching)

Verify your installations:

## Shopping Cart

The shopping cart system provides a seamless shopping experience for both guest and authenticated users.

### Cart Features

- **Add/Remove Items** - Add products to cart and remove unwanted items
- **Quantity Management** - Update item quantities with real-time inventory validation
- **Price Snapshots** - Preserve product prices at the time of adding to cart
- **Tax Calculation** - Automatic tax calculation based on configurable rate
- **Session-Based Cart** - Guest users can shop without creating an account
- **Persistent Cart** - Authenticated users' carts persist across sessions
- **Inventory Validation** - Prevents adding more items than available stock

### API Endpoints

For detailed API documentation, see [Cart API Endpoints](docs/api/cart-endpoints.md).

**Cart Operations:**
- `POST /api/cart/items` - Add product to cart
- `GET /api/cart` - Retrieve cart with items and totals
- `PUT /api/cart/items/:id` - Update item quantity
- `DELETE /api/cart/items/:id` - Remove item from cart
- `DELETE /api/cart` - Clear entire cart

### Configuration

**Tax Rate Configuration:**
Set the `TAX_RATE` environment variable to configure the tax rate (as decimal):