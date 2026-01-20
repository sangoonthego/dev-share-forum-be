/\*\*

- ═══════════════════════════════════════════════════════════════════════════════
- OAuth2 AUTHENTICATION IMPLEMENTATION - SETUP & USAGE GUIDE
- ═══════════════════════════════════════════════════════════════════════════════
-
- This document provides a complete guide for the OAuth2 implementation for
- DevShare Forum supporting Google and GitHub authentication.
-
- CREATED FILES:
- - src/auth/strategies/google.strategy.ts (Google OAuth2 strategy)
- - src/auth/strategies/github.strategy.ts (GitHub OAuth2 strategy)
- - src/common/guards/google-auth.guard.ts (Google Passport guard)
- - src/common/guards/github-auth.guard.ts (GitHub Passport guard)
-
- MODIFIED FILES:
- - src/auth/services/auth.service.ts (validateOAuthUser method)
- - src/auth/services/user.service.ts (OAuth helper methods)
- - src/auth/auth.controller.ts (OAuth endpoints)
- - src/auth/auth.module.ts (Strategy registration)
- - src/auth/dto/auth.dto.ts (OAuth DTOs)
-
- ═══════════════════════════════════════════════════════════════════════════════
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 1. INSTALLATION
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- Install required packages:
-
- npm install passport passport-google-oauth20 passport-github2 @nestjs/passport
-
- Or with pnpm:
- pnpm add passport passport-google-oauth20 passport-github2 @nestjs/passport
-
- Type definitions:
- npm install -D @types/passport-google-oauth20 @types/passport-github2
-
- pnpm add -D @types/passport-google-oauth20 @types/passport-github2
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ENVIRONMENT VARIABLES (.env)
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- GOOGLE OAUTH2 CONFIG:
-
- GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
- GOOGLE_CLIENT_SECRET=your_google_client_secret
- GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
-
- In production:
- GOOGLE_CALLBACK_URL=https://api.yourapp.com/auth/google/callback
-
- ─────────────────────────────────────────────────────────────────────────────
-
- GITHUB OAUTH2 CONFIG:
-
- GITHUB_CLIENT_ID=your_github_client_id
- GITHUB_CLIENT_SECRET=your_github_client_secret
- GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
-
- In production:
- GITHUB_CALLBACK_URL=https://api.yourapp.com/auth/github/callback
-
- ─────────────────────────────────────────────────────────────────────────────
-
- FRONTEND CONFIG:
-
- FRONTEND_URL=http://localhost:3001
- NODE_ENV=development
-
- In production:
- FRONTEND_URL=https://yourapp.com
- NODE_ENV=production
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GOOGLE OAUTH2 SETUP
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- Step 1: Create OAuth App in Google Cloud Console
-
- 1.  Go to https://console.cloud.google.com/
- 2.  Create a new project or select existing
- 3.  Go to "APIs & Services" > "Credentials"
- 4.  Click "Create Credentials" > "OAuth client ID"
- 5.  Choose "Web application"
- 6.  Add Authorized JavaScript origins:
- - http://localhost:3000 (development)
- - https://api.yourapp.com (production)
- 7.  Add Authorized redirect URIs:
- - http://localhost:3000/auth/google/callback (development)
- - https://api.yourapp.com/auth/google/callback (production)
- 8.  Copy Client ID and Client Secret
- 9.  Add to .env file
-
- Step 2: Enable Google+ API
- 1.  Go to "APIs & Services" > "Library"
- 2.  Search for "Google+ API"
- 3.  Click "Enable"
      \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GITHUB OAUTH2 SETUP
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- Step 1: Create OAuth App in GitHub
-
- 1.  Go to https://github.com/settings/developers
- 2.  Click "New OAuth App"
- 3.  Fill in application details:
- - Application name: "DevShare Forum"
- - Homepage URL: http://localhost:3000
- - Authorization callback URL: http://localhost:3000/auth/github/callback
- 4.  For production, update URLs:
- - Homepage URL: https://yourapp.com
- - Authorization callback URL: https://api.yourapp.com/auth/github/callback
- 5.  Copy Client ID and generate Client Secret
- 6.  Add to .env file
-
- Scopes requested: user:email
- - Allows reading email address
- - Does NOT grant write access
    \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ARCHITECTURE OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- OAuth2 Authentication Flow (High Level):
-
- ┌─────────────┐ ┌─────────────┐ ┌──────────────┐
- │ Frontend │ │ Backend │ │ Google/GitHub│
- └──────┬──────┘ └──────┬──────┘ └──────┬───────┘
-        │                                  │                                  │
-        │  1. User clicks "Sign in with Google"                              │
-        │  Redirects to /auth/google                                         │
-        ├─────────────────────────────────→                                  │
-        │                                  │                                  │
-        │                                  │  2. GoogleAuthGuard triggered    │
-        │                                  │  Passport redirects to Google    │
-        │                                  ├─────────────────────────────────→
-        │                                  │                                  │
-        │                                  │                                  │  3. User logs in
-        │                                  │                                  │     and consents
-        │                                  │                                  │
-        │  4. Google redirects with auth code                                │
-        │  to /auth/google/callback                                          │
-        │←───────────────────────────────────────────────────────────────────
-        │                                  │                                  │
-        │                                  │  5. GoogleAuthGuard validates    │
-        │                                  │  Exchanges code for tokens       │
-        │                                  │  Calls GoogleStrategy.validate() │
-        │                                  │                                  │
-        │                                  │  6. GoogleStrategy.validate()    │
-        │                                  │  calls AuthService.validateOAuthUser()
-        │                                  │                                  │
-        │                                  │  7. AuthService checks if user   │
-        │                                  │  exists by email                 │
-        │                                  │                                  │
-        │                                  │  If exists: Update OAuth ID      │
-        │                                  │  If new: Create user account     │
-        │                                  │                                  │
-        │                                  │  8. Generate JWT + Refresh Token │
-        │                                  │                                  │
-        │  9. Controller sets httpOnly cookie                                │
-        │  with Refresh Token                                                │
-        │  Redirects to frontend with access_token in URL                    │
-        │←───────────────────────────────────────────────────────────────────
-        │                                  │                                  │
-        │  10. Frontend extracts access_token from URL                       │
-        │  Stores in memory (not localStorage)                               │
-        │  Uses Authorization: Bearer <token> for API calls                   │
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 6. KEY FEATURES
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- ACCOUNT LINKING:
- ────────────────
- When a user logs in via OAuth:
-
- 1.  Check if email already exists
- 2.  If yes: Update google_id or github_id in user.meta + avatar
- 3.  If no: Create new user with random secure password
-
- Benefits:
- - Users can link multiple OAuth providers to same email
- - Users can switch between local auth and OAuth
- - Existing users can add OAuth to their account
-
- Implementation:
- - OAuth provider IDs stored in user.meta JSON field
- - Format: { google_id: "...", github_id: "...", ... }
- - Profile avatar synced from provider
- - Full name synced if not already set
-
- ─────────────────────────────────────────────────────────────────────────────
-
- SECURE PASSWORD GENERATION:
- ──────────────────────────
- For OAuth-only users, password is:
- - 32 random bytes (crypto-secure)
- - Hashed with bcrypt
- - Never shown to user
- - Cannot be used for login (OAuth only)
-
- This prevents:
- - Password guessing attacks
- - OAuth users accidentally getting password login
- - Account compromise if password is exposed
-
- ─────────────────────────────────────────────────────────────────────────────
-
- TOKEN INTEGRATION:
- ─────────────────
- After OAuth validation:
-
- 1.  Generate JWT Access Token (15 minutes)
- - Contains user sub, email, role, jti (for blacklist)
- - Signed with JWT_AT_SECRET
- 2.  Generate Refresh Token (7 days)
- - Stored hashed in Redis
- - Can be revoked immediately
- 3.  Set httpOnly cookie with Refresh Token
- - Automatic cookie sending for refresh endpoint
-
- Benefits:
- - Unified token system with local auth
- - Token reuse detection
- - Immediate token revocation
- - XSS protection via httpOnly cookie
-
- ─────────────────────────────────────────────────────────────────────────────
-
- UNIFIED GUARDS:
- ──────────────
- Existing AtGuard works for all auth methods:
- - Local login (JWT in Authorization header)
- - OAuth2 (JWT in Authorization header)
- - Refresh endpoint (Refresh Token in cookie)
-
- No code changes needed for route protection!
-
- Example:
- @UseGuards(AtGuard)
- async createPost(@User('sub') userId: number) {
- // Works for both local and OAuth users
- }
-
- ─────────────────────────────────────────────────────────────────────────────
-
- PROFILE SYNC:
- ────────────
- From OAuth providers:
- - full_name: Updated if not already set
- - profile_avatar: Always updated from provider
- - email: Primary identifier (not changed)
-
- Rationale:
- - Preserve user customizations
- - Keep avatar in sync
- - Auto-populate for first-time OAuth users
    \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 7. API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- GOOGLE OAUTH2 ENDPOINTS:
- ───────────────────────
-
- 1.  GET /auth/google
- Description: Initiate Google OAuth2 flow
- Access: Public (no authentication needed)
- Behavior: Redirects to Google consent screen
-
- 2.  GET /auth/google/callback
- Description: Google OAuth2 callback
- Access: Public (Google redirects here)
- Behavior: Validates user, sets cookie, redirects to frontend
-
- ─────────────────────────────────────────────────────────────────────────────
-
- GITHUB OAUTH2 ENDPOINTS:
- ───────────────────────
-
- 1.  GET /auth/github
- Description: Initiate GitHub OAuth2 flow
- Access: Public (no authentication needed)
- Behavior: Redirects to GitHub authorization screen
-
- 2.  GET /auth/github/callback
- Description: GitHub OAuth2 callback
- Access: Public (GitHub redirects here)
- Behavior: Validates user, sets cookie, redirects to frontend
-
- ─────────────────────────────────────────────────────────────────────────────
-
- FRONTEND REDIRECT AFTER OAUTH:
- ──────────────────────────────
-
- Callback redirects to:
- https://frontend.com/auth/oauth-callback?access_token=...&provider=google&email=...
-
- Frontend should:
- 1.  Extract access_token from URL
- 2.  Store in memory (not localStorage for XSS protection)
- 3.  Save in React Context or State Management
- 4.  Use in Authorization header for API calls
      \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 8. FRONTEND IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- REACT EXAMPLE:
- ──────────────
-
- import { useNavigate } from 'react-router-dom';
-
- function LoginPage() {
- const navigate = useNavigate();
-
- const handleGoogleLogin = () => {
-     window.location.href = 'http://localhost:3000/auth/google';
- };
-
- const handleGitHubLogin = () => {
-     window.location.href = 'http://localhost:3000/auth/github';
- };
-
- return (
-     <div>
-       <button onClick={handleGoogleLogin}>Sign in with Google</button>
-       <button onClick={handleGitHubLogin}>Sign in with GitHub</button>
-     </div>
- );
- }
-
- ─────────────────────────────────────────────────────────────────────────────
-
- OAUTH CALLBACK HANDLING:
- ──────────────────────
-
- function OAuthCallback() {
- const navigate = useNavigate();
- const { login } = useAuth(); // Your auth context
-
- useEffect(() => {
-     // Extract from URL
-     const params = new URLSearchParams(window.location.search);
-     const accessToken = params.get('access_token');
-     const provider = params.get('provider');
-     const email = params.get('email');
-
-     if (accessToken) {
-       // Store token in context/state (not localStorage)
-       login({
-         accessToken,
-         provider,
-         email,
-       });
-
-       // Redirect to dashboard
-       navigate('/dashboard');
-     } else {
-       navigate('/login?error=oauth_failed');
-     }
- }, []);
-
- return <div>Authenticating...</div>;
- }
-
- ─────────────────────────────────────────────────────────────────────────────
-
- API CALL EXAMPLE:
- ────────────────
-
- const response = await fetch('http://localhost:3000/api/posts', {
- headers: {
-     'Authorization': `Bearer ${accessToken}`,
-     'Content-Type': 'application/json',
- },
- });
-
- Refresh Token is automatically sent in httpOnly cookie by browser
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 9. TESTING
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- TEST CHECKLIST:
- ──────────────
-
- [ ] Google OAuth flow works
-     - User redirected to Google
-     - Returns with valid token
-     - User created/linked in database
-
- [ ] GitHub OAuth flow works
-     - User redirected to GitHub
-     - Returns with valid token
-     - User created/linked in database
-
- [ ] Account linking
-     - First OAuth login creates new user
-     - Second OAuth login links to existing user
-     - avatar is updated
-     - OAuth ID is stored in meta
-
- [ ] Token security
-     - Access Token works for API calls
-     - Refresh Token is in httpOnly cookie
-     - Token reuse is detected
-     - Revoked tokens are rejected
-
- [ ] Unified authentication
-     - Local login + OAuth access same endpoints
-     - Same guards work for both
-     - Same token validation logic
-
- [ ] Error handling
-     - Invalid OAuth request fails gracefully
-     - Missing email is rejected
-     - Redirect on error works
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 10. TROUBLESHOOTING
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- "Invalid client id" error
- → Check GOOGLE_CLIENT_ID and GITHUB_CLIENT_ID in .env
- → Verify credentials in Google Cloud Console / GitHub Settings
-
- ─────────────────────────────────────────────────────────────────────────────
-
- "Redirect URI mismatch" error
- → Callback URL must match exactly in provider settings
- → Include protocol: http:// or https://
- → Include port if not standard (3000, etc.)
- → Check for trailing slashes
-
- Example:
- ✅ http://localhost:3000/auth/google/callback
- ❌ http://localhost:3000/auth/google/callback/
- ❌ http://localhost/auth/google/callback
-
- ─────────────────────────────────────────────────────────────────────────────
-
- "Email not provided" error from GitHub
- → User's GitHub email is private
- → Set as public in GitHub settings: https://github.com/settings/emails
-
- ─────────────────────────────────────────────────────────────────────────────
-
- Token validation fails after OAuth
- → Verify AtGuard is working
- → Check JWT_AT_SECRET matches signing secret
- → Check Redis is running for token blacklist
-
- ─────────────────────────────────────────────────────────────────────────────
-
- Cookie not being set
- → Check secure flag in production (HTTPS required)
- → Check sameSite setting (use 'lax' for OAuth callback)
- → Check COOKIE_DOMAIN matches frontend domain
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 11. SECURITY CONSIDERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- ✅ IMPLEMENTED SECURITY:
-
- 1.  Secure Token Storage
- - Access Token: In memory only (no localStorage)
- - Refresh Token: httpOnly cookie (XSS proof)
-
- 2.  Token Expiration
- - Access Token: 15 minutes
- - Refresh Token: 7 days
-
- 3.  Token Validation
- - JTI blacklist for immediate revocation
- - Redis for fast token checks
- - Signature verification on every request
-
- 4.  Account Security
- - OAuth-only users have random password
- - Password never shown to user
- - Account linking by email verification (implicit)
-
- 5.  CSRF Protection
- - sameSite: 'lax' cookie flag
- - Prevents cross-site token sending
-
- 6.  Input Validation
- - Email validated
- - OAuth profile validated
- - Profile avatar URL validated
-
- ─────────────────────────────────────────────────────────────────────────────
-
- ⚠️ ADDITIONAL RECOMMENDATIONS:
-
- 1.  Rate Limiting
- - Apply rate limiting to /auth/google and /auth/github
- - Prevent token refresh spam
- - Use ThrottleModule from @nestjs/throttler
-
- 2.  Account Takeover Protection
- - Log OAuth logins with IP and user agent
- - Send email confirmation for new OAuth devices
- - Implement suspicious activity alerts
-
- 3.  Token Rotation
- - Consider rotating refresh tokens on each use
- - Detect token reuse more aggressively
-
- 4.  Audit Logging
- - Log all OAuth login attempts
- - Log account linking events
- - Log token refresh events
-
- 5.  Data Privacy
- - Don't store OAuth access tokens (only provider ID)
- - Use user:email scope only for GitHub
- - Minimize requested scopes
    \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 12. FILE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- src/auth/
- ├── auth.controller.ts ✏️ Updated with OAuth endpoints
- ├── auth.module.ts ✏️ Updated with strategy registration
- ├── dto/
- │ └── auth.dto.ts ✏️ Updated with OAuthProfile
- ├── services/
- │ ├── auth.service.ts ✏️ Added validateOAuthUser()
- │ ├── user.service.ts ✏️ Added OAuth methods
- │ ├── token.service.ts (unchanged)
- │ ├── login.service.ts (unchanged)
- │ └── ...
- └── strategies/
-     ├── at.strategy.ts                 (existing JWT strategy)
-     ├── rt.strategy.ts                 (existing refresh token strategy)
-     ├── google.strategy.ts             ✨ NEW
-     └── github.strategy.ts             ✨ NEW
-
- src/common/guards/
- ├── at.guard.ts (existing)
- ├── rt.guard.ts (existing)
- ├── google-auth.guard.ts ✨ NEW
- └── github-auth.guard.ts ✨ NEW
  \*/

export {};
