# Health Check Endpoints

This document describes the health check endpoints available in the Cosmetics E-commerce API. These endpoints are designed for monitoring, container orchestration (Docker HEALTHCHECK), and Kubernetes liveness/readiness probes.

## Overview

Health check endpoints provide lightweight status verification without checking external dependencies. They enable automated monitoring systems to detect and respond to application failures quickly.

**Key Characteristics:**
- Lightweight and fast (< 100ms response time)
- No external dependency checks (database, cache, etc.)
- Suitable for high-frequency polling
- Returns JSON responses with timestamps

---

## GET /health

Returns the current health status of the application.

### Description

The `/health` endpoint performs minimal internal checks to verify the application is running and responsive. This endpoint is designed for Docker HEALTHCHECK instructions and Kubernetes liveness probes.

**Use Cases:**
- Docker container health monitoring
- Kubernetes liveness probe
- Load balancer health checks
- Uptime monitoring services

### Request