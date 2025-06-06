import type { PackageManifest } from "@pnpm/types";
import semver from "semver";

export type Framework = "nextjs" | "express";

export type Features = "checkout" | "webhook";

export interface FrameworkInfo {
	packageName: string; // NPM package name
	minVersion: string; // Minimum supported semver
	description: string; // Additional text to display to the user
	dependencies: string[]; // List of dependencies to add to package.json
	postInstallSteps: () => void;
}

export const supportedFrameworks: Record<Framework, FrameworkInfo> = {
	nextjs: {
		packageName: "next",
		minVersion: "15",
		description: `Only App Router is supported at the moment`,
		dependencies: ["@chargebee/nextjs:~0.1.0", "chargebee-init-core:~0.1.0"],
		postInstallSteps: () => ``,
	},
	express: {
		packageName: "express",
		minVersion: "4",
		description: "",
		dependencies: ["@chargebee/express:~0.1.0", "chargebee-init-core:~0.1.0"],
		postInstallSteps: () => ``,
	},
} as const;

export type DetectedFramework = {
	name: Framework;
	version: string;
	info: FrameworkInfo;
};

// We read the version from package.json, which will not
// give us the exact installed version thanks to semver. But as
// long as it satisfies our minVersion, that should be ok.
//
// TODO: What if there are multiple detected frameworks?
export function detectFramework(
	pkgJson: PackageManifest,
): DetectedFramework | undefined {
	if (!pkgJson.dependencies) {
		return undefined;
	}

	for (const [framework, info] of Object.entries(supportedFrameworks)) {
		const version = pkgJson.dependencies[info.packageName];
		if (version) {
			return {
				name: framework as Framework,
				version,
				info,
			} as DetectedFramework;
		}
	}

	return undefined;
}

export function satisfiesMinVersion({
	version,
	info,
}: DetectedFramework): boolean {
	const ver = semver.coerce(version)?.version ?? "";
	return semver.satisfies(ver, info.minVersion);
}
