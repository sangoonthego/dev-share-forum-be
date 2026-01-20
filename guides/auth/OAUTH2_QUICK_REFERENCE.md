/\*\*

- ═══════════════════════════════════════════════════════════════════════════════
- OAUTH2 QUICK REFERENCE - DEVELOPER GUIDE
- ═══════════════════════════════════════════════════════════════════════════════
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 1. QUICK START
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- Step 1: Install packages
- ─────────────────────────
- pnpm add passport passport-google-oauth20 passport-github2 @nestjs/passport
- pnpm add -D @types/passport-google-oauth20 @types/passport-github2
-
-
- Step 2: Add to .env
- ───────────────────
- # Google OAuth
- GOOGLE_CLIENT_ID=your_google_client_id
- GOOGLE_CLIENT_SECRET=your_google_client_secret
- GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
-
- # GitHub OAuth
- GITHUB_CLIENT_ID=your_github_client_id
- GITHUB_CLIENT_SECRET=your_github_client_secret
- GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
-
- # Frontend
- FRONTEND_URL=http://localhost:3001
-
-
- Step 3: Done! 🚀
- ────────────────
- Endpoints are ready:
- - GET /auth/google
- - GET /auth/google/callback
- - GET /auth/github
- - GET /auth/github/callback
    \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FLOW DIAGRAM
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- FRONTEND FLOW:
- ──────────────
-
- 1.  User clicks "Sign in with Google/GitHub"
- window.location.href = 'http://localhost:3000/auth/google'
-
- 2.  Backend redirects to OAuth provider
- /auth/google → Google consent screen
-
- 3.  User authorizes
- Google/GitHub → redirects to callback URL
-
- 4.  Backend processes callback
- /auth/google/callback → Validate user → Create/Link account → Generate tokens
-
- 5.  Backend redirects to frontend
- Redirect to: http://localhost:3001/auth/oauth-callback?access_token=...
- Cookie: refresh_token (httpOnly)
-
- 6.  Frontend extracts tokens
- Get access_token from URL
- Refresh token is auto-sent in API calls (cookie)
-
- 7.  Use tokens for API calls
- Authorization: Bearer <access_token>
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 3. KEY METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- AuthService.validateOAuthUser(oauthProfile)
- ───────────────────────────────────────────
-
- Purpose:
- - Core OAuth logic
- - Account linking
- - Token generation
-
- Input:
- {
- provider: 'google' | 'github',
- providerId: 'oauth_user_id',
- email: 'user@example.com',
- full_name: 'John Doe',
- profile_avatar: 'https://...',
- googleId?: 'google_id',
- githubId?: 'github_id',
- githubUsername?: 'username'
- }
-
- Returns:
- {
- id: 123,
- email: 'user@example.com',
- full_name: 'John Doe',
- profile_avatar: 'https://...',
- access_token: 'jwt...',
- refresh_token: 'jwt...'
- }
-
- Flow:
- 1.  Check if email exists (findByEmail)
- 2.  If exists: Update OAuth ID + avatar (updateOAuthProfile)
- 3.  If new: Create user with random password (createOAuthUser)
- 4.  Generate tokens (tokenService.getTokens)
- 5.  Return user + tokens
-
-
- UserService.findByEmail(email)
- ──────────────────────────────
-
- Purpose:
- - Check if user exists
- - Used for account linking
-
- Returns: User object or null
-
-
- UserService.createOAuthUser(oauthProfile)
- ──────────────────────────────────────────
-
- Purpose:
- - Create new user from OAuth profile
- - Generate random secure password (not used for login)
- - Store OAuth provider ID in meta
-
- Stores in meta:
- {
- oauth_provider: 'google' | 'github',
- created_via_oauth: true,
- google_id?: 'google_id',
- github_id?: 'github_id',
- github_username?: 'username'
- }
-
-
- UserService.updateOAuthProfile(userId, oauthProfile)
- ─────────────────────────────────────────────────────
-
- Purpose:
- - Link OAuth to existing user
- - Update profile avatar
- - Update OAuth provider ID
-
- Updates:
- - user.profile_avatar
- - user.meta.google_id or user.meta.github_id
    \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CONTROLLER ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- GET /auth/google
- ───────────────
- Initiates Google OAuth2 flow
-
- @UseGuards(GoogleAuthGuard)
- Behavior: Redirects to Google consent screen
-
-
- GET /auth/google/callback
- ─────────────────────────
- Google OAuth2 callback
-
- @UseGuards(GoogleAuthGuard)
- Behavior:
- 1.  Validate user with Google
- 2.  Call GoogleStrategy.validate()
- 3.  AuthService.validateOAuthUser() handles account linking
- 4.  Set httpOnly cookie with Refresh Token
- 5.  Redirect to frontend with access token in URL
-
-
- GET /auth/github
- ────────────────
- Initiates GitHub OAuth2 flow
-
- @UseGuards(GitHubAuthGuard)
- Behavior: Redirects to GitHub authorization screen
-
-
- GET /auth/github/callback
- ──────────────────────────
- GitHub OAuth2 callback
-
- @UseGuards(GitHubAuthGuard)
- Behavior:
- 1.  Validate user with GitHub
- 2.  Call GitHubStrategy.validate()
- 3.  AuthService.validateOAuthUser() handles account linking
- 4.  Set httpOnly cookie with Refresh Token
- 5.  Redirect to frontend with access token in URL
      \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 5. STRATEGY CLASSES
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- GoogleStrategy
- ──────────────
- File: src/auth/strategies/google.strategy.ts
-
- Flow:
- 1.  User clicks "Sign in with Google"
- 2.  GoogleAuthGuard triggers
- 3.  Passport redirects to Google
- 4.  User authorizes
- 5.  Google redirects with auth code
- 6.  GoogleStrategy exchanges code for tokens
- 7.  GoogleStrategy.validate() is called
- 8.  Extracts email, name, avatar from profile
- 9.  Calls AuthService.validateOAuthUser()
- 10. Returns user with tokens to controller
-
-
- GitHubStrategy
- ──────────────
- File: src/auth/strategies/github.strategy.ts
-
- Flow:
- 1.  User clicks "Sign in with GitHub"
- 2.  GitHubAuthGuard triggers
- 3.  Passport redirects to GitHub
- 4.  User authorizes
- 5.  GitHub redirects with auth code
- 6.  GitHubStrategy exchanges code for tokens
- 7.  GitHubStrategy.validate() is called
- 8.  Extracts email, name, avatar from profile
- 9.  Calls AuthService.validateOAuthUser()
- 10. Returns user with tokens to controller
      \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 6. FRONTEND INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- REACT COMPONENT EXAMPLE:
- ───────────────────────
-
- import { useEffect } from 'react';
- import { useNavigate } from 'react-router-dom';
- import { useAuth } from './contexts/AuthContext';
-
- function OAuthCallback() {
- const navigate = useNavigate();
- const { setAccessToken } = useAuth();
-
- useEffect(() => {
-     const params = new URLSearchParams(window.location.search);
-     const accessToken = params.get('access_token');
-     const provider = params.get('provider');
-
-     if (accessToken) {
-       // Store in memory (not localStorage!)
-       setAccessToken(accessToken);
-
-       // Refresh token is in httpOnly cookie automatically
-
-       navigate('/dashboard');
-     } else {
-       navigate('/login?error=failed');
-     }
- }, []);
-
- return <div>Authenticating...</div>;
- }
-
-
- MAKING API CALLS:
- ────────────────
-
- const response = await fetch('/api/posts', {
- headers: {
-     'Authorization': `Bearer ${accessToken}`,
- },
- });
-
- // Refresh token is auto-sent in httpOnly cookie
- // No need to manually handle it
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 7. DATABASE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- Users table structure (relevant fields):
-
- {
- id: number,
- email: string (UNIQUE),
- password_hash: string, // Random for OAuth users
- full_name: string | null,
- profile_avatar: string | null,
- role: 'USER' | 'ADMIN',
- meta: {
-     oauth_provider?: 'google' | 'github',
-     created_via_oauth?: boolean,
-     google_id?: string,
-     github_id?: string,
-     github_username?: string,
-     // Other custom fields
- }
- }
-
- Account Linking Example:
-
- User 1: Google + GitHub
- {
- email: 'john@example.com',
- meta: {
-     google_id: 'google_id_123',
-     github_id: 'github_id_456',
- }
- }
-
- User 2: Google only
- {
- email: 'jane@example.com',
- meta: {
-     google_id: 'google_id_789',
- }
- }
-
- User 3: Local auth only
- {
- email: 'bob@example.com',
- meta: {}
- }
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 8. COMMON ISSUES & SOLUTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- ❌ Issue: "Invalid client id"
- ✅ Solution:
- - Check .env for GOOGLE_CLIENT_ID and GITHUB_CLIENT_ID
- - Verify in Google Cloud Console / GitHub Settings
- - Make sure no extra spaces in .env
-
-
- ❌ Issue: "Redirect URI mismatch"
- ✅ Solution:
- - Callback URL must match EXACTLY in provider settings
- - http://localhost:3000/auth/google/callback
- - No trailing slash
- - Include protocol and port
-
-
- ❌ Issue: "Email not found" from GitHub
- ✅ Solution:
- - User's GitHub email is private
- - Go to https://github.com/settings/emails
- - Set email as public
-
-
- ❌ Issue: Token validation fails
- ✅ Solution:
- - Check AtGuard is properly set up
- - Verify JWT_AT_SECRET matches
- - Make sure Redis is running
-
-
- ❌ Issue: Cookie not being set
- ✅ Solution:
- - In production: HTTPS required for secure flag
- - Check sameSite setting
- - Verify COOKIE_DOMAIN in .env
    \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 9. SECURITY CHECKLIST
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- ✅ For Production Deployment:
-
- [ ] Environment variables configured
-     - All OAuth credentials in .env
-     - FRONTEND_URL matches actual frontend
-     - NODE_ENV=production
-
- [ ] HTTPS enabled
-     - OAuth providers require HTTPS
-     - secure flag set on cookies
-     - Redirect URIs use https://
-
- [ ] OAuth provider settings updated
-     - Callback URLs point to production domain
-     - Authorized origins include production domain
-
- [ ] Rate limiting enabled
-     - Throttle decorators on endpoints
-     - Prevent brute force attacks
-
- [ ] Logging enabled
-     - Log all OAuth login attempts
-     - Log account linking events
-     - Monitor for suspicious patterns
-
- [ ] Error handling
-     - Don't expose sensitive info in errors
-     - Handle all edge cases
-     - Proper error messages for users
-
- [ ] Testing
-     - Test OAuth flow end-to-end
-     - Test account linking
-     - Test token refresh
-     - Test error scenarios
  \*/

// ═══════════════════════════════════════════════════════════════════════════════
// 10. ARCHITECTURE DECISIONS
// ═══════════════════════════════════════════════════════════════════════════════

/\*\*

- WHY OAUTH IDs IN meta JSON FIELD?
- ──────────────────────────────────
- - Flexible for future providers (Twitch, Discord, etc.)
- - Don't need database migrations
- - Easy to query and update
- - Supports multiple providers per user
-
- Alternative: Separate columns for each provider
- ❌ Requires migration for each new provider
- ❌ More columns in table
- ❌ Harder to add new providers
-
-
- WHY RANDOM PASSWORD FOR OAUTH USERS?
- ─────────────────────────────────────
- - Secure: 32 random bytes
- - User can't accidentally login with password
- - Protects against password guessing
- - Prevents accidental password discovery
-
- Alternative: No password field
- ❌ Would need to change schema
- ❌ Breaks password reset logic
- ❌ Can't support email/password login if user wants to add it
-
-
- WHY httpOnly COOKIE FOR REFRESH TOKEN?
- ───────────────────────────────────────
- - XSS proof: JavaScript can't access
- - CSRF protected: sameSite flag prevents misuse
- - Auto-sent: Browser handles automatically
- - Secure: No need to manage in JavaScript
-
- Alternative: Store in localStorage
- ❌ Vulnerable to XSS attacks
- ❌ Must manually send in headers
- ❌ Requires more JavaScript
-
-
- WHY ACCESS TOKEN IN URL AFTER CALLBACK?
- ────────────────────────────────────────
- - Frontend needs it immediately after OAuth
- - Callback redirect is only moment to pass it
- - Frontend stores in memory (not localStorage)
- - Refresh token is in httpOnly cookie
-
- Important: Frontend MUST store in memory, not localStorage!
- This prevents XSS attacks from stealing the token.
  \*/

export {};
