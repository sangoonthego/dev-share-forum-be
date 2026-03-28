export enum AuthErrorCode {
  INVALID_CREDENTIALS = 'AUTH_001',
  EMAIL_REGISTERED = 'AUTH_002',
  REFRESH_FAILED = 'AUTH_003',
  TOKEN_EXPIRED = 'AUTH_004',
  RATE_LIMITED = 'AUTH_005',
  CSRF_INVALID = 'AUTH_006',
  TOKEN_REVOKED = 'AUTH_007',
  REUSE_DETECTED = 'AUTH_008',
  OAUTH_FAILED = 'AUTH_009',
  PASSWORD_INVALID = 'AUTH_010',
}

export interface AuthErrorResponse {
  error_code: string;
  message: string;
  timestamp: string;
}

export const ERROR_CODE_MESSAGES: Record<AuthErrorCode, string> = {
  [AuthErrorCode.INVALID_CREDENTIALS]: 'Invalid email or password',
  [AuthErrorCode.EMAIL_REGISTERED]: 'This email is already in use',
  [AuthErrorCode.REFRESH_FAILED]: 'Unable to refresh session. Please login again',
  [AuthErrorCode.TOKEN_EXPIRED]: 'Your session has expired',
  [AuthErrorCode.RATE_LIMITED]: 'Too many requests. Try again later',
  [AuthErrorCode.CSRF_INVALID]: 'Security check failed. Please try again',
  [AuthErrorCode.TOKEN_REVOKED]: 'Your session was invalidated. Please login again',
  [AuthErrorCode.REUSE_DETECTED]: 'Session security issue detected. Please login again',
  [AuthErrorCode.OAUTH_FAILED]: 'OAuth login failed. Please try again',
  [AuthErrorCode.PASSWORD_INVALID]: 'Password does not meet requirements',
};

export class AuthException extends Error {
  constructor(
    public code: AuthErrorCode,
    public status: number,
    message?: string,
  ) {
    super(message || ERROR_CODE_MESSAGES[code]);
    this.name = 'AuthException';
  }
}
