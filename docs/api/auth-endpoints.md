# Authentication API

Complete API documentation for user authentication endpoints including registration, login, token refresh, logout, and user profile retrieval.

## Overview

The Authentication API provides secure user account management with JWT-based authentication. It supports:

- User registration with email/password
- Secure login with credential validation
- JWT access tokens (15-minute expiry)
- Refresh tokens (7-day expiry) with rotation
- Token-based logout
- Current user profile retrieval

## Authentication

Most endpoints require authentication using JWT Bearer tokens in the Authorization header: