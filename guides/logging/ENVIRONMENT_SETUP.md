# Winston & Sentry Environment Configuration

## Overview

This guide explains how to configure Winston logging and Sentry error tracking in your `.env` file.

## Environment Variables

### Winston Logging

```env
# Log Level: error, warn, info, http, debug
# (Default: info)
#
# error - Only errors
# warn  - Warnings and errors
# info  - Info, warnings and errors
# http  - HTTP requests, info, warnings and errors
# debug - All including debug messages
LOG_LEVEL=info
```

**Log Output Locations:**

- **Console**: Pretty-printed logs (development)
- **logs/error.log**: Error-level logs only
- **logs/combined.log**: All logs for debugging
- **Sentry**: Critical errors and exceptions (when DSN is configured)

---

### Sentry Error Tracking & Performance Monitoring

#### 1. Create a Sentry Account

- Go to https://sentry.io
- Sign up for free account
- Create a new project (select NestJS runtime)

#### 2. Get Your DSN (Data Source Name)

- In Sentry: Settings → Projects → {Your Project} → Client Keys (DSN)
- Format: `https://<public_key>@<host>.ingest.sentry.io/<project_id>`

#### 3. Configure in `.env`

```env
# Sentry DSN (Data Source Name)
# Leave empty to disable Sentry
# Example: https://examplePublicKey@o0.ingest.sentry.io/0
SENTRY_DSN=https://your-public-key@o0.ingest.sentry.io/project-id

# Sentry tracing sample rate (0.0 - 1.0)
# 0.0  = No performance data collected
# 0.1  = 10% of requests traced (recommended for production)
# 1.0  = 100% of requests traced (for debugging, expensive)
SENTRY_TRACE_RATE=0.1

# Sentry environment
# Options: development, staging, production
# Helps organize and filter issues in Sentry dashboard
SENTRY_ENV=development

# Node.js environment
# Options: development, production
NODE_ENV=development
```

---

## Setup Steps

### Development Environment

1. **Copy the template:**

   ```bash
   # .env file already exists with defaults
   # Edit the following lines:
   ```

2. **Update `.env` with your values:**

   ```env
   # Keep default for local development
   LOG_LEVEL=debug

   # Optional: Setup Sentry for error tracking
   SENTRY_DSN=
   SENTRY_ENV=development
   NODE_ENV=development
   ```

3. **Verify logs are created:**
   ```bash
   # After starting the app, check:
   ls -la logs/
   # Should show: combined.log, error.log
   ```

### Production Environment

1. **Use Railway/Docker environment variables (do NOT commit .env to git):**

   ```bash
   # In Railway dashboard or docker-compose, set:
   LOG_LEVEL=warn
   SENTRY_DSN=https://your-prod-key@o0.ingest.sentry.io/prod-project-id
   SENTRY_ENV=production
   NODE_ENV=production
   ```

2. **Recommended production values:**
   ```env
   LOG_LEVEL=warn           # Only warnings and errors
   SENTRY_TRACE_RATE=0.05   # 5% of requests (cost-effective)
   SENTRY_ENV=production
   NODE_ENV=production
   ```

---

## Log Levels Explained

| Level     | Output                                   | Use Case                   |
| --------- | ---------------------------------------- | -------------------------- |
| **error** | Only errors                              | Production - minimal logs  |
| **warn**  | Warnings + errors                        | Recommended for production |
| **info**  | Info + warnings + errors                 | Standard development       |
| **http**  | HTTP requests + info + warnings + errors | API debugging              |
| **debug** | All including debug messages             | Intensive debugging        |

---

## Sensitive Data Masking

The logger automatically masks sensitive fields:

- `password`, `passwordHash`
- `token`, `accessToken`, `refreshToken`
- `email`, `apiKey`, `secretKey`
- `creditCard`, `cvv`, `ssn`
- `authorization`, `cookie`

**Example:**

```javascript
// Input
{ password: "secret123", email: "user@example.com", role: "admin" }

// Output in logs
{ password: "***MASKED***", email: "***MASKED***", role: "admin" }
```

---

## Sentry Features

### Error Tracking

- Automatic exception capture
- Stack trace with source maps
- Release tracking

### Performance Monitoring

- Request latency tracking
- Database query performance
- Cache hit rates

### Alerting

- Email notifications for critical errors
- Slack/Teams integration
- Custom thresholds

---

## Troubleshooting

### Logs not appearing in files

```bash
# Check logs directory exists
mkdir -p logs

# Check file permissions
ls -la logs/

# Restart application
pnpm start:dev
```

### Sentry not capturing errors

1. Verify DSN is correctly set: `echo $SENTRY_DSN`
2. Check internet connection (needs to reach sentry.io)
3. Verify project is active in Sentry dashboard
4. Check Sentry sampling rate isn't 0

### High Sentry costs

- Reduce `SENTRY_TRACE_RATE` to 0.05 or lower
- Set `LOG_LEVEL=warn` to reduce noise
- Use error budgeting in Sentry dashboard

---

## File Locations

```
dev-share-lite-be/
├── .env                          # Development environment (DO NOT COMMIT)
├── .env.example                  # Template (safe to commit)
├── logs/                         # Created by Winston
│   ├── error.log               # Errors only
│   ├── combined.log            # All logs
│   ├── error.log.1             # Rotated files
│   └── combined.log.1
└── src/
    └── common/
        └── logger/
            ├── logger.service.ts      # Winston + Sentry setup
            ├── logger.module.ts       # NestJS module
            └── logging.interceptor.ts # HTTP request logging
```

---

## Quick Start Commands

```bash
# Start with debug logging
LOG_LEVEL=debug pnpm start:dev

# Start with production logging
NODE_ENV=production LOG_LEVEL=warn pnpm start:prod

# View error logs in real-time
tail -f logs/error.log

# View all logs in real-time
tail -f logs/combined.log

# Clear old logs
rm -f logs/*.log*
```

---

## Example .env Setup

### For Development

```env
LOG_LEVEL=debug
SENTRY_DSN=
NODE_ENV=development
```

### For Staging

```env
LOG_LEVEL=info
SENTRY_DSN=https://your-staging-key@o0.ingest.sentry.io/staging-id
SENTRY_TRACE_RATE=0.1
SENTRY_ENV=staging
NODE_ENV=production
```

### For Production

```env
LOG_LEVEL=warn
SENTRY_DSN=https://your-prod-key@o0.ingest.sentry.io/prod-id
SENTRY_TRACE_RATE=0.05
SENTRY_ENV=production
NODE_ENV=production
```

---

## Next Steps

1. ✅ Environment variables configured in `.env`
2. ⏳ Test Winston logging: `curl http://localhost:3000/api/posts`
3. ⏳ Verify logs created: `ls -la logs/`
4. ⏳ Setup Sentry project (optional but recommended)
5. ⏳ Configure Sentry alerts and integrations

---

For more details see:

- [Winston Documentation](https://github.com/winstonjs/winston)
- [Sentry Documentation](https://docs.sentry.io/platforms/javascript/guides/nestjs/)
- Implementation Guide: `guides/optimization/IMPLEMENTATION_GUIDE.md`
