/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // Optional isolated build directory. Used to run several verification
  // servers side by side without sharing a .next directory. Defaults to .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;
