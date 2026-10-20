import type { NextConfig } from "next";
const config: NextConfig = { poweredByHeader: false, output: 'standalone', outputFileTracingExcludes: {'/*':['./.data/**/*','./.keys/**/*','./.backups/**/*','./.env*']}, experimental: {cpus:2} };
export default config;
