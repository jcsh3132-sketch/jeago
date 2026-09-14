import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['@libsql/client'],
  // Apply only to route bundles; '*' also matches Next's internal server trace
  // where substring matching would incorrectly exclude its "framework" folder.
  outputFileTracingExcludes: { '/*': ['./work/**/*', './instance/**/*', './.env*', './android/**/*', './tests/**/*'] },
  outputFileTracingIncludes: { '/*': ['./node_modules/next/dist/lib/framework/*.js'] },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ] }];
  },
};
export default config;
