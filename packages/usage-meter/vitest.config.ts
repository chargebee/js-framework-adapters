import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		clearMocks: true,
		globals: true,
		include: ["src/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.test.ts",
				"src/**/_test-utils.ts",
				"src/**/index.ts",
				"src/**/*.d.ts",
			],
		},
	},
});
