import fs from "node:fs";
import path from "node:path";
import type { PackageManifest } from "@pnpm/types";
import type { DetectedFramework } from "./frameworks";

export function getPackageJson(dir: string): PackageManifest | undefined {
	try {
		const pkgJson = fs.readFileSync(path.join(dir, "package.json"), {
			encoding: "utf8",
		});
		return typeof pkgJson === "string"
			? (JSON.parse(pkgJson) as PackageManifest)
			: undefined;
	} catch (_err) {
		return undefined;
	}
}

export function updateDependencies(
	pkg: PackageManifest,
	framework: DetectedFramework,
): PackageManifest {
	pkg.dependencies ??= {};
	framework.info.dependencies.forEach((dep) => {
		const [name, version] = dep.split(":");
		if (name && version && pkg.dependencies) {
			pkg.dependencies[name] = version;
		}
	});
	return pkg;
}

export function writePackageJson(dir: string, pkg: PackageManifest) {
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify(pkg, null, 2),
		{
			encoding: "utf8",
		},
	);
}
