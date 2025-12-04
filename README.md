# Cosmetics E-commerce Website

A full-stack e-commerce platform for cosmetics built with modern web technologies, featuring a React frontend and Express.js backend with TypeScript throughout.

## Overview

This platform provides a complete e-commerce solution for cosmetics retailers, including product catalog management, shopping cart functionality, user authentication, order processing, and payment integration. The application is built as a monorepo with separate frontend and backend workspaces, ensuring clean separation of concerns and independent scalability.

## Features

- **User Authentication** - Secure user registration and login with JWT tokens
- **Shopping Cart** - Add products to cart, manage quantities, and view totals with automatic tax calculation
- **Product Catalog** - Browse and search cosmetics products
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

## Authentication

The authentication system provides secure user account management with JWT-based token authentication.

### Authentication Features

- **User Registration** - Create new user accounts with email and password
- **Secure Login** - Authenticate users with credential validation
- **JWT Tokens** - Stateless authentication with JSON Web Tokens
- **Refresh Token Rotation** - Automatic token refresh for extended sessions
- **Password Security** - Bcrypt hashing with 10 salt rounds
- **Token Revocation** - Logout functionality with refresh token invalidation

### Password Requirements

User passwords must meet the following criteria:
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number

### Token Expiry

- **Access Tokens** - 15 minutes (short-lived for security)
- **Refresh Tokens** - 7 days (long-lived for user convenience)

### API Endpoints

For detailed API documentation, see [Authentication API Endpoints](docs/api/auth-endpoints.md).

**Authentication Operations:**
- `POST /api/auth/register` - Register new user account
- `POST /api/auth/login` - Login and receive JWT tokens
- `POST /api/auth/refresh` - Refresh access token using refresh token
- `POST /api/auth/logout` - Logout and invalidate refresh token
- `GET /api/auth/me` - Get current authenticated user profile

### Configuration

**JWT Secrets Configuration:**
Set the following environment variables for JWT token signing: