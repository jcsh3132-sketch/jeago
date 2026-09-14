import { relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function databaseConfig(env: Record<string, string | undefined> = process.env) {
  if (env.JEAGO_TEST_MODE === '1') {
    const url = env.JEAGO_TEST_DATABASE_URL || '';
    if (!url.startsWith('file:')) throw new Error('Tests require an explicit local database.');
    const path = relative(process.cwd(), fileURLToPath(url));
    if (!path.startsWith(`work${sep}`) || isAbsolute(path) || !path.endsWith('.db')) throw new Error('Test databases must be inside work/.');
    return { url, authToken: undefined };
  }
  return {
    url: env.TURSO_DATABASE_URL || env.DATABASE_URL || 'file:instance/inventory-next.db',
    authToken: env.TURSO_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN,
  };
}
