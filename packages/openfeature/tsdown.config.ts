import { defineConfig } from "tsdown";

export default defineConfig({
	dts: { build: true, incremental: true },
	format: ["esm"],
	entry: [
		"./src/index.ts",
		"./src/cache.ts",
		"./src/server.ts",
		"./src/web.ts",
		"./src/nextjs.ts",
	],
	external: [
		"@openfeature/server-sdk",
		"@openfeature/web-sdk",
		"chargebee",
		"next",
		"next/server",
		"server-only",
	],
	sourcemap: true,
});
