import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  experimental: {
    // Las Server Actions son el único camino de escritura desde la interfaz.
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
