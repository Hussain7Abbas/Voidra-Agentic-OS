import type { NextConfig } from "next";
import packageJson from "./package.json" with { type: "json" };

const nextConfig: NextConfig = {
  output: "export",
  generateBuildId: async () => process.env.VOIDRA_BUILD_ID ?? `voidra-${packageJson.version}`,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
