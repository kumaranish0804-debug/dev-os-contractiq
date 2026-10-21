/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack: (config) => {
    // react-pdf: pdfjs optionally requires `canvas` in Node; never bundle it
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
