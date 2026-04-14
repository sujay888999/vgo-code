/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    if (process.env.NODE_ENV === 'production') {
      return [];
    }

    const target = process.env.API_PROXY_TARGET || 'http://localhost:3001';

    return [
      {
        source: '/api/:path*',
        destination: `${target}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
