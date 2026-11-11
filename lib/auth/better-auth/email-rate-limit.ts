import { redisManager } from '@lib/infra/redis';
import { createHash } from 'node:crypto';

export type AuthEmailKind = 'password-reset' | 'verification';

const RESERVE_EMAIL_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[2]) or '0')
if redis.call('EXISTS', KEYS[1]) == 1 or count >= tonumber(ARGV[3]) then
  return 0
end
local nextCount = redis.call('INCR', KEYS[2])
if nextCount == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[2])
end
redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
return 1
`;

export async function reserveAuthEmail(
  email: string,
  kind: AuthEmailKind
): Promise<boolean> {
  const recipient = email.trim().toLowerCase();
  if (!recipient) {
    throw new Error(
      'An email address is required for authentication email limits'
    );
  }
  const digest = createHash('sha256').update(recipient).digest('hex');
  const key = redisManager.buildKey('auth-email', `{${digest}}`);
  const client = await redisManager.getClient();
  const result = await client.eval(RESERVE_EMAIL_SCRIPT, {
    keys: [`${key}:cooldown:${kind}`, `${key}:hour`],
    arguments: ['60', '3600', '5'],
  });
  if (result !== 0 && result !== 1) {
    throw new Error('Authentication email limiter returned an invalid result');
  }
  return result === 1;
}
