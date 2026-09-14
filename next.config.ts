import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['@libsql/client'],
  outputFileTracingExcludes: { '*': ['./work/**/*', './instance/**/*', './.env*', './android/**/*', './tests/**/*'] },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ] }];
  },
};
export default config;
