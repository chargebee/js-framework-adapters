import { defineConfig } from "tsdown";

export default defineConfig({
	dts: { build: true, incremental: true },
	format: ["esm"],
	entry: {
		index: "./src/index.ts",
		server: "./src/server/index.ts",
		web: "./src/web/index.ts",
	},
	external: [
		"@chargebee/entitlements",
		"@chargebee/entitlements/server",
		"@chargebee/entitlements/web",
		"@openfeature/server-sdk",
		"@openfeature/web-sdk",
	],
	sourcemap: true,
});
