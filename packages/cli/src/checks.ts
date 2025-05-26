import type { PackageManifest } from "@pnpm/types";
import {
	detectFramework,
	satisfiesMinVersion,
	supportedFrameworks,
	type DetectedFramework,
} from "./frameworks";
import { isCleanTree } from "./git";
import { getPackageJson } from "./package";
import * as colors from "ansi-colors";

export type Checks = "git" | "package.json" | "framework";

export type CheckError = { check: Checks; msg: string; bail?: boolean };

export type CheckResponse<P extends string, T> = { [k in P]?: T } & {
	errors: CheckError[];
};

export type PreflightResponse = CheckResponse<"pkg", PackageManifest>;
export type FrameworkResponse = CheckResponse<"framework", DetectedFramework>;

export const preflightChecks = async (
	path: string,
): Promise<PreflightResponse> => {
	const errors: CheckError[] = [];

	// We raise a warning if we can't validate that the target directory isn't
	// a git tree, but give them the option to continue
	const cleanTree = await isCleanTree(path);
	if (!cleanTree) {
		errors.push({
			check: "git",
			msg: `Could not validate if the target directory is a clean git tree`,
		});
	}
	// This is a hard stop as we can't continue without a valid package.json
	const pkg = getPackageJson(path);
	if (pkg) {
		return { pkg, errors };
	}
	errors.push({
		check: "package.json",
		msg: `Could not read the contents of ${path}/package.json to perform the required checks. Please ensure your app has a valid package.json.`,
		bail: true,
	});

	return { errors };
};

export const frameworkChecks = async (
	pkg: PackageManifest,
): Promise<FrameworkResponse> => {
	const errors: CheckError[] = [];
	const framework = detectFramework(pkg);

	if (!framework) {
		errors.push({
			check: "framework",
			msg: `No supported framework detected in package.json. We currently support: ${colors.red(Object.keys(supportedFrameworks).join(", "))}`,
			bail: true,
		});
	} else if (!satisfiesMinVersion(framework)) {
		errors.push({
			check: "framework",
			msg: `${framework.name}@${framework.version} does not satisfy the minimum version we support (${framework.info.minVersion}). Can't proceed!`,
			bail: true,
		});
	}

	return { framework, errors };
};
