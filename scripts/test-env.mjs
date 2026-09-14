export function testEnvironment(env = process.env) {
  const clean = { ...env, JEAGO_TEST_MODE: '1' };
  for (const key of ['DATABASE_URL', 'DATABASE_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'VERCEL', 'JEAGO_TEST_DATABASE_URL']) delete clean[key];
  return clean;
}
