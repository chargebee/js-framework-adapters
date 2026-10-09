import { defineConfig } from "vitest/config";

export default defineConfig({
	ssr: {
		resolve: {
			// `dev-source` precedes Vite's SSR defaults so `@chargebee/entitlements`
			// resolves to its sources and the tests run without building it first.
			conditions: ["dev-source", "module", "node", "development|production"],
		},
	},
	test: {
		clearMocks: true,
		globals: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules/**",
				"dist/**",
				"test/**",
				"**/*.d.ts",
				"vitest.config.ts",
				"tsdown.config.ts",
			],
		},
	},
});
