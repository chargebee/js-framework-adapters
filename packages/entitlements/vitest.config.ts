import { defineConfig } from "vitest/config";

export default defineConfig({
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
