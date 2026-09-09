import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Set the root directory for file tracing to avoid lockfile warnings
  outputFileTracingRoot: path.join(__dirname),
  skipTrailingSlashRedirect: true,
  async rewrites() {
    const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';
    const posthogAssetsHost = posthogHost
      .replace('us.i.posthog.com', 'us-assets.i.posthog.com')
      .replace('eu.i.posthog.com', 'eu-assets.i.posthog.com');
    return [
      { source: '/ingest/static/:path*', destination: `${posthogAssetsHost}/static/:path*` },
      { source: '/ingest/:path*', destination: `${posthogHost}/:path*` },
    ];
  },
  // Enable type checking and linting during build
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.classistatic.de',
        pathname: '/api/v1/mo-prod/images/**',
      },
      {
        protocol: 'https',
        hostname: 'suchen.mobile.de',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'a.ccdn.es',
        pathname: '/cnet/**',
      },
    ],
    unoptimized: false,
  },
  // Security headers. We do not set a global Cache-Control here: Next.js
  // emits sensible defaults per route (static pages get s-maxage at the
  // CDN, dynamic pages get no-store). The previous global
  // `max-age=0, must-revalidate` forced every static page through the
  // origin, eliminating CDN cache hit rate.
  async headers() {
    // En desarrollo los chunks de /_next NO llevan hash de contenido, así que
    // cachearlos como `immutable` hace que el navegador sirva chunks viejos tras
    // cada rebuild y reviente el grafo de módulos ("Cannot read properties of
    // undefined (reading 'call')"). Solo en producción, donde van content-hashed,
    // el cacheo inmutable es correcto y seguro.
    const isProd = process.env.NODE_ENV === 'production';
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
      // Long-lived caching for Next.js chunks (content-hashed) — solo en prod.
      ...(isProd ? [{
        source: '/_next/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      }] : []),
    ];
  },
  // Disable aggressive chunk prefetching that can cause issues on mobile
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;

