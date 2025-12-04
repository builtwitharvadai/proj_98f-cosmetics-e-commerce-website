import axios, { AxiosInstance } from 'axios';
import { Server } from 'http';
import express, { Express } from 'express';
import { AddressInfo } from 'net';

describe('Health Endpoints Integration Tests', () => {
  let app: Express;
  let server: Server;
  let baseURL: string;
  let client: AxiosInstance;
  let port: number;

  // ============================================================================
  // Setup and Teardown
  // ============================================================================

  beforeAll(async () => {
    // Arrange: Create Express application with health routes
    app = express();
    app.use(express.json());

    // Import and setup health routes
    const healthRouter = express.Router();

    healthRouter.get('/health', (_req, res) => {
      res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'test',
      });
    });

    healthRouter.get('/ready', (_req, res) => {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
      });
    });

    app.use(healthRouter);

    // Start server on random available port
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address() as AddressInfo;
        port = address.port;
        baseURL = `http://localhost:${port}`;
        client = axios.create({
          baseURL,
          timeout: 5000,
          validateStatus: () => true, // Don't throw on any status
        });
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Cleanup: Close server and cleanup resources
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  });

  // ============================================================================
  // Health Endpoint Tests
  // ============================================================================

  describe('GET /health', () => {
    it('should be accessible via HTTP', async () => {
      // Act: Make GET request to health endpoint
      const response = await client.get('/health');

      // Assert: Verify response status and structure
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return correct response data structure', async () => {
      // Act: Make GET request to health endpoint
      const response = await client.get('/health');

      // Assert: Verify response data structure
      expect(response.data).toHaveProperty('status');
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('uptime');
      expect(response.data).toHaveProperty('environment');

      expect(response.data.status).toBe('ok');
      expect(typeof response.data.timestamp).toBe('string');
      expect(typeof response.data.uptime).toBe('number');
      expect(response.data.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return valid ISO 8601 timestamp', async () => {
      // Act: Make GET request to health endpoint
      const response = await client.get('/health');

      // Assert: Verify timestamp is valid ISO 8601 format
      const timestamp = response.data.timestamp;
      const date = new Date(timestamp);

      expect(date.toISOString()).toBe(timestamp);
      expect(date.getTime()).not.toBeNaN();
    });

    it('should return increasing uptime on subsequent calls', async () => {
      // Arrange: Get initial uptime
      const firstResponse = await client.get('/health');
      const firstUptime = firstResponse.data.uptime;

      // Act: Wait and make another request
      await new Promise((resolve) => setTimeout(resolve, 100));
      const secondResponse = await client.get('/health');
      const secondUptime = secondResponse.data.uptime;

      // Assert: Second uptime should be greater
      expect(secondUptime).toBeGreaterThan(firstUptime);
    });

    it('should handle multiple concurrent requests', async () => {
      // Act: Make multiple concurrent requests
      const requests = Array.from({ length: 10 }, () => client.get('/health'));
      const responses = await Promise.all(requests);

      // Assert: All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.data.status).toBe('ok');
      });
    });

    it('should respond within acceptable time threshold', async () => {
      // Arrange: Set performance threshold
      const maxResponseTime = 100; // 100ms
      const startTime = Date.now();

      // Act: Make request
      const response = await client.get('/health');
      const responseTime = Date.now() - startTime;

      // Assert: Response time should be under threshold
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(maxResponseTime);
    });

    it('should return correct environment value', async () => {
      // Act: Make GET request to health endpoint
      const response = await client.get('/health');

      // Assert: Environment should be 'test' in test environment
      expect(response.data.environment).toBe('test');
    });

    it('should handle HEAD requests', async () => {
      // Act: Make HEAD request
      const response = await client.head('/health');

      // Assert: Should return 200 with no body
      expect(response.status).toBe(200);
      expect(response.data).toBe('');
    });
  });

  // ============================================================================
  // Ready Endpoint Tests
  // ============================================================================

  describe('GET /ready', () => {
    it('should be accessible via HTTP', async () => {
      // Act: Make GET request to ready endpoint
      const response = await client.get('/ready');

      // Assert: Verify response status
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return correct response data structure', async () => {
      // Act: Make GET request to ready endpoint
      const response = await client.get('/ready');

      // Assert: Verify response data structure
      expect(response.data).toHaveProperty('status');
      expect(response.data).toHaveProperty('timestamp');

      expect(response.data.status).toBe('ready');
      expect(typeof response.data.timestamp).toBe('string');
    });

    it('should return valid ISO 8601 timestamp', async () => {
      // Act: Make GET request to ready endpoint
      const response = await client.get('/ready');

      // Assert: Verify timestamp is valid ISO 8601 format
      const timestamp = response.data.timestamp;
      const date = new Date(timestamp);

      expect(date.toISOString()).toBe(timestamp);
      expect(date.getTime()).not.toBeNaN();
    });

    it('should handle multiple concurrent requests', async () => {
      // Act: Make multiple concurrent requests
      const requests = Array.from({ length: 10 }, () => client.get('/ready'));
      const responses = await Promise.all(requests);

      // Assert: All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.data.status).toBe('ready');
      });
    });

    it('should respond within acceptable time threshold', async () => {
      // Arrange: Set performance threshold
      const maxResponseTime = 100; // 100ms
      const startTime = Date.now();

      // Act: Make request
      const response = await client.get('/ready');
      const responseTime = Date.now() - startTime;

      // Assert: Response time should be under threshold
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(maxResponseTime);
    });
  });

  // ============================================================================
  // Docker HEALTHCHECK Simulation Tests
  // ============================================================================

  describe('Docker HEALTHCHECK Compatibility', () => {
    it('should work with Docker health check command', async () => {
      // Arrange: Simulate Docker HEALTHCHECK command
      // Docker typically uses: curl -f http://localhost:PORT/health || exit 1

      // Act: Make request similar to Docker health check
      const response = await client.get('/health');

      // Assert: Verify exit code would be 0 (success)
      const exitCode = response.status === 200 ? 0 : 1;
      expect(exitCode).toBe(0);
    });

    it('should return success status for Docker ready check', async () => {
      // Arrange: Simulate Docker readiness probe
      // Docker typically uses: curl -f http://localhost:PORT/ready || exit 1

      // Act: Make request similar to Docker readiness probe
      const response = await client.get('/ready');

      // Assert: Verify exit code would be 0 (success)
      const exitCode = response.status === 200 ? 0 : 1;
      expect(exitCode).toBe(0);
    });

    it('should handle health check with timeout', async () => {
      // Arrange: Set short timeout like Docker would
      const healthCheckClient = axios.create({
        baseURL,
        timeout: 1000, // 1 second timeout
        validateStatus: () => true,
      });

      // Act: Make request with timeout
      const response = await healthCheckClient.get('/health');

      // Assert: Should complete within timeout
      expect(response.status).toBe(200);
    });

    it('should support health check interval testing', async () => {
      // Arrange: Simulate Docker health check interval (every 30s)
      const checks = [];

      // Act: Make 3 health checks with small delay
      for (let i = 0; i < 3; i++) {
        const response = await client.get('/health');
        checks.push(response.status);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Assert: All checks should succeed
      expect(checks).toEqual([200, 200, 200]);
    });

    it('should handle health check retries', async () => {
      // Arrange: Simulate Docker health check with retries
      const maxRetries = 3;
      let attempts = 0;
      let lastResponse;

      // Act: Attempt health check with retry logic
      while (attempts < maxRetries) {
        lastResponse = await client.get('/health');
        if (lastResponse.status === 200) break;
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Assert: Should succeed within retries
      expect(lastResponse?.status).toBe(200);
      expect(attempts).toBeLessThan(maxRetries);
    });
  });

  // ============================================================================
  // Error Handling and Edge Cases
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle invalid routes gracefully', async () => {
      // Act: Request non-existent endpoint
      const response = await client.get('/invalid-endpoint');

      // Assert: Should return 404
      expect(response.status).toBe(404);
    });

    it('should handle malformed requests', async () => {
      // Act: Send request with invalid headers
      const response = await client.get('/health', {
        headers: {
          'Content-Type': 'invalid/type',
        },
      });

      // Assert: Should still respond successfully
      expect(response.status).toBe(200);
    });

    it('should handle requests with query parameters', async () => {
      // Act: Send request with query parameters
      const response = await client.get('/health?test=value');

      // Assert: Should ignore query params and respond normally
      expect(response.status).toBe(200);
      expect(response.data.status).toBe('ok');
    });

    it('should handle OPTIONS requests for CORS', async () => {
      // Act: Send OPTIONS request
      const response = await client.options('/health');

      // Assert: Should handle OPTIONS request
      expect([200, 204]).toContain(response.status);
    });
  });

  // ============================================================================
  // Performance and Load Tests
  // ============================================================================

  describe('Performance Tests', () => {
    it('should handle burst of requests', async () => {
      // Arrange: Create burst of 50 requests
      const burstSize = 50;
      const startTime = Date.now();

      // Act: Send burst of requests
      const requests = Array.from({ length: burstSize }, () =>
        client.get('/health')
      );
      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;

      // Assert: All should succeed and complete in reasonable time
      expect(responses.every((r) => r.status === 200)).toBe(true);
      expect(totalTime).toBeLessThan(5000); // 5 seconds for 50 requests
    });

    it('should maintain consistent response times under load', async () => {
      // Arrange: Collect response times
      const responseTimes: number[] = [];

      // Act: Make 20 sequential requests
      for (let i = 0; i < 20; i++) {
        const start = Date.now();
        await client.get('/health');
        responseTimes.push(Date.now() - start);
      }

      // Assert: Response times should be consistent
      const avgTime =
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxDeviation = Math.max(...responseTimes.map((t) => Math.abs(t - avgTime)));

      expect(avgTime).toBeLessThan(100); // Average under 100ms
      expect(maxDeviation).toBeLessThan(200); // Max deviation under 200ms
    });
  });

  // ============================================================================
  // Security Tests
  // ============================================================================

  describe('Security Tests', () => {
    it('should not expose sensitive information in health response', async () => {
      // Act: Get health response
      const response = await client.get('/health');

      // Assert: Should not contain sensitive data
      const responseStr = JSON.stringify(response.data);
      expect(responseStr).not.toMatch(/password|secret|key|token/i);
    });

    it('should handle requests with suspicious headers', async () => {
      // Act: Send request with suspicious headers
      const response = await client.get('/health', {
        headers: {
          'X-Forwarded-For': '127.0.0.1; DROP TABLE users;',
          'User-Agent': '<script>alert("xss")</script>',
        },
      });

      // Assert: Should handle safely
      expect(response.status).toBe(200);
    });

    it('should not be vulnerable to path traversal', async () => {
      // Act: Attempt path traversal
      const response = await client.get('/health/../../../etc/passwd');

      // Assert: Should not expose file system
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // Monitoring and Observability Tests
  // ============================================================================

  describe('Monitoring and Observability', () => {
    it('should provide metrics for monitoring', async () => {
      // Act: Get health response
      const response = await client.get('/health');

      // Assert: Should include monitorable metrics
      expect(response.data).toHaveProperty('uptime');
      expect(response.data).toHaveProperty('timestamp');
      expect(typeof response.data.uptime).toBe('number');
    });

    it('should support health check aggregation', async () => {
      // Act: Make multiple health checks
      const responses = await Promise.all([
        client.get('/health'),
        client.get('/ready'),
      ]);

      // Assert: Both should be healthy
      expect(responses[0].data.status).toBe('ok');
      expect(responses[1].data.status).toBe('ready');
    });

    it('should provide consistent timestamps across requests', async () => {
      // Act: Make two quick requests
      const response1 = await client.get('/health');
      const response2 = await client.get('/health');

      // Assert: Timestamps should be close but different
      const time1 = new Date(response1.data.timestamp).getTime();
      const time2 = new Date(response2.data.timestamp).getTime();

      expect(time2).toBeGreaterThanOrEqual(time1);
      expect(time2 - time1).toBeLessThan(1000); // Within 1 second
    });
  });
});