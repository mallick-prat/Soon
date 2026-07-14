/** @type {import('next').NextConfig} */
const nextConfig = {
  // the prisma client (inside @soon/database) must stay a node_modules
  // runtime dependency — never bundled into the server build.
  serverExternalPackages: ["@soon/database", "@prisma/client"],
};

export default nextConfig;
