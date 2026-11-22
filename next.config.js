/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ['pg'],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;