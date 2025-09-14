// next.config.ts
import type { NextConfig } from "next";

const config: NextConfig = {
  turbopack: {
    // point Turbopack at this folder as the project root
    root: __dirname,
  },
  // If you have a custom webpack() function that’s only for Webpack builds,
  // consider guarding it, or removing it during Turbopack dev to avoid the warning.
};

export default config;
