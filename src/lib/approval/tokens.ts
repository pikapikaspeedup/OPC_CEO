import * as crypto from 'crypto';

const DEFAULT_SECRET = 'default-dev-secret';
const TOKEN_TTL_SECONDS = 86_400;

function resolveSecret(secret?: string): string {
  return secret || process.env.APPROVAL_HMAC_SECRET || DEFAULT_SECRET;
}

export function generateApprovalToken(requestId: string, action: string, secret?: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${requestId}:${action}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', resolveSecret(secret)).update(payload).digest('hex');
  return `${timestamp}.${hmac}`;
}

export function verifyApprovalToken(requestId: string, action: string, token: string, secret?: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const timestamp = parseInt(parts[0], 10);
  if (Number.isNaN(timestamp)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (now - timestamp > TOKEN_TTL_SECONDS) return false;

  const payload = `${requestId}:${action}:${timestamp}`;
  const expected = crypto.createHmac('sha256', resolveSecret(secret)).update(payload).digest('hex');
  const actual = parts[1];
  if (actual.length !== expected.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(actual, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}
