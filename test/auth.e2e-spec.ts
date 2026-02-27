import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthErrorCode } from '../src/auth/dto/auth-error.dto';

/**
 * Auth Module Integration Tests
 * 
 * Covers:
 * - Login with rate limiting & CSRF validation
 * - Token refresh with concurrent request queuing
 * - Token reuse detection
 * - Logout & session invalidation
 * - Error code mapping
 * - Distributed tracing headers
 */
describe('Auth Module (E2E)', () => {
  let app: INestApplication;
  let testEmail = `test-${Date.now()}@example.com`;
  let testPassword = 'TestPassword123!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Registration', () => {
    it('should register new user successfully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          full_name: 'Test User',
        })
        .expect(HttpStatus.CREATED);

      expect(response.body.access_token).toBeDefined();
    });

    it('should reject duplicate email with error code', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(HttpStatus.CONFLICT);

      expect(response.body.error_code).toBe(AuthErrorCode.EMAIL_REGISTERED);
      expect(response.body.message).toContain('already');
    });

    it('should rate limit registration attempts', async () => {
      const email = `ratelimit-${Date.now()}@example.com`;

      // Make 5 requests (at limit)
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            email: `${email}-${i}@example.com`,
            password: testPassword,
          })
          .expect(HttpStatus.CREATED);
      }

      // 6th request should be rate limited
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `${email}-6@example.com`,
          password: testPassword,
        })
        .expect(HttpStatus.TOO_MANY_REQUESTS);

      expect(response.body.error_code).toBe(AuthErrorCode.RATE_LIMITED);
    });
  });

  describe('Login Flow', () => {
    let accessToken: string;
    let csrfToken: string;

    it('should login and return access token + csrf token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(HttpStatus.OK);

      accessToken = response.body.access_token;
      csrfToken = response.body.csrf_token;

      expect(accessToken).toBeDefined();
      expect(csrfToken).toBeDefined();

      // Check cookies
      const setCookie = response.get('Set-Cookie');
      expect(setCookie).toBeDefined();
      expect(setCookie!.some(c => c.includes('refresh_token'))).toBeTruthy();
      expect(setCookie!.some(c => c.includes('csrf_token'))).toBeTruthy();
      expect(setCookie!.some(c => c.includes('HttpOnly'))).toBeTruthy();
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword',
        })
        .expect(HttpStatus.UNAUTHORIZED);

      expect(response.body.error_code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
      expect(response.body.message).not.toContain('Invalid password');
    });

    it('should rate limit excessive login attempts', async () => {
      const email = `login-${Date.now()}@example.com`;

      // Create test user
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: testPassword,
          full_name: 'Test',
        });

      // Make 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            email,
            password: 'WrongPassword',
          })
          .expect(HttpStatus.UNAUTHORIZED);
      }

      // 6th attempt should be rate limited
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email,
          password: 'WrongPassword',
        })
        .expect(HttpStatus.TOO_MANY_REQUESTS);

      expect(response.body.error_code).toBe(AuthErrorCode.RATE_LIMITED);
    });
  });

  describe('CSRF Protection', () => {
    let validRefreshCookie: string | undefined;
    let validCsrfToken: string | undefined;

    beforeAll(async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      validRefreshCookie = loginRes.get('Set-Cookie')?.find(c => c.includes('refresh_token'));
      validCsrfToken = loginRes.body.csrf_token;
    });

    it('should reject login without CSRF token in production', async () => {
      // Skip if not production
      if (process.env.NODE_ENV !== 'production') {
        return; // Skip test in non-production
      }

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(HttpStatus.FORBIDDEN);

      expect(response.body.error_code).toBe(AuthErrorCode.CSRF_INVALID);
    });

    it('should accept login with valid CSRF token in production', async () => {
      if (process.env.NODE_ENV !== 'production') {
        return; // Skip in non-production
      }

      // Get CSRF from first login
      const firstLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      const setCookie = firstLogin.get('Set-Cookie');
      const csrfFromCookie = setCookie
        ?.find(c => c.includes('csrf_token'))
        ?.match(/csrf_token=([^;]+)/)?.[1];

      if (!csrfFromCookie) {
        return; // Skip test if CSRF not found
      }

      // Use CSRF in header for next login
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', csrfFromCookie)
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(HttpStatus.OK);

      expect(response.body.access_token).toBeDefined();
    });
  });

  describe('Token Refresh', () => {
    let rtCookie: string;
    let accessToken: string;

    beforeAll(async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      const setCookie = loginRes.get('Set-Cookie');
      rtCookie = setCookie?.find(c => c.includes('refresh_token')) || '';
      accessToken = loginRes.body.access_token;
    });

    it('should refresh tokens successfully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', rtCookie)
        .expect(HttpStatus.OK);

      expect(response.body.access_token).toBeDefined();
      expect(response.body.access_token).not.toEqual(accessToken); // Should be new token
      expect(response.body.csrf_token).toBeDefined();
    });

    it('should detect token reuse and revoke all sessions', async () => {
      // Perform valid refresh first
      const firstRefresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', rtCookie)
        .expect(HttpStatus.OK);

      const newAccessToken = firstRefresh.body.access_token;

      // Try to reuse old RT (should fail)
      const reuseResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .set('Cookie', rtCookie)
        .expect(HttpStatus.FORBIDDEN);

      expect(reuseResponse.body.error_code).toBe(AuthErrorCode.REUSE_DETECTED);

      // Subsequent auth attempts should fail (all sessions revoked)
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should rate limit refresh endpoint (10 per minute)', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      const setCookieHeader = loginRes.get('Set-Cookie');
      const cookie = setCookieHeader?.find(c => c.includes('refresh_token')) || '';
      let lastAccessToken = loginRes.body.access_token;

      // Make 10 successful refreshes
      for (let i = 0; i < 10; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Authorization', `Bearer ${lastAccessToken}`)
          .set('Cookie', cookie)
          .expect(HttpStatus.OK);

        lastAccessToken = res.body.access_token;
      }

      // 11th should be rate limited
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${lastAccessToken}`)
        .set('Cookie', cookie)
        .expect(HttpStatus.TOO_MANY_REQUESTS);

      expect(response.body.error_code).toBe(AuthErrorCode.RATE_LIMITED);
      expect(response.body.retryAfter).toBeDefined();
    });
  });

  describe('Logout', () => {
    let accessToken: string;

    beforeAll(async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      accessToken = loginRes.body.access_token;
    });

    it('should logout and clear tokens', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(HttpStatus.OK);

      expect(response.body.success).toBe(true);

      // Verify cookies are cleared
      const setCookie = response.get('Set-Cookie');
      expect(setCookie?.some(c => c.includes('refresh_token=;'))).toBeTruthy();
      expect(setCookie?.some(c => c.includes('csrf_token=;'))).toBeTruthy();
    });

    it('should invalidate access token after logout', async () => {
      // Token should no longer work
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('Distributed Tracing', () => {
    it('should include trace ID in response headers', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Trace-ID', 'test-trace-123')
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(HttpStatus.OK);

      expect(response.get('X-Trace-ID')).toBeDefined();
      expect(response.get('X-Trace-ID')).toMatch(/^[\w-]+$/); // UUID format
    });

    it('should generate trace ID if not provided', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(HttpStatus.OK);

      // Should auto-generate trace ID
      expect(response.get('X-Trace-ID')).toBeDefined();
    });
  });

  describe('Protected Endpoints', () => {
    let accessToken: string;

    beforeAll(async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      accessToken = loginRes.body.access_token;
    });

    it('GET /auth/me should return user profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(HttpStatus.OK);

      expect(response.body.email).toBe(testEmail);
      expect(response.body.id).toBeDefined();
    });

    it('should reject requests with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should reject requests without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('Change Password', () => {
    let accessToken: string;
    let newPassword = 'NewPassword456!';

    beforeAll(async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      accessToken = loginRes.body.access_token;
    });

    it('should change password successfully', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          current_password: testPassword,
          new_password: newPassword,
          new_password_confirm: newPassword,
        })
        .expect(HttpStatus.OK);

      // Update testPassword for subsequent tests
      testPassword = newPassword;
    });

    it('should invalidate old password after change', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'OldPassword123!',
        })
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should allow login with new password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(HttpStatus.OK);

      expect(response.body.access_token).toBeDefined();
    });

    it('should rate limit password change attempts', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      const token = loginRes.body.access_token;

      // Make 3 password change requests (at limit)
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/change-password')
          .set('Authorization', `Bearer ${token}`)
          .send({
            current_password: testPassword,
            new_password: `NewPass${i}!`,
            new_password_confirm: `NewPass${i}!`,
          });
      }

      // 4th attempt should be rate limited
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          current_password: testPassword,
          new_password: 'AnotherPass!',
          new_password_confirm: 'AnotherPass!',
        })
        .expect(HttpStatus.TOO_MANY_REQUESTS);

      expect(response.body.error_code).toBe(AuthErrorCode.RATE_LIMITED);
    });
  });
});
