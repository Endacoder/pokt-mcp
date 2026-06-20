/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@pokt-mcp/shared"],
};

export default nextConfig;
