import { defineConfig } from "tsdown";

export default defineConfig({
	dts: { build: true, incremental: true },
	format: ["esm"],
	entry: {
		index: "./src/index.ts",
		cache: "./src/cache/index.ts",
		server: "./src/server/index.ts",
		web: "./src/web/index.ts",
		nextjs: "./src/nextjs.ts",
	},
	external: ["chargebee", "ioredis", "next", "next/server", "server-only"],
	sourcemap: true,
});
