import fs from "node:fs";
import path from "node:path";

import type { Framework, FrameworkInfo } from "./frameworks.js";

const pathPrefix = "chargebee";
const __dirname = globalThis.__dirname ?? import.meta.dirname;

export const copyTemplates = (
	targetDir: string,
	framework: Framework,
	frameworkInfo: FrameworkInfo,
): string[] => {
	const source = path.join(__dirname, "templates", framework);
	let appDir = targetDir;
	// Determine app directory to write files to
	for (let dir of frameworkInfo.appDirectories) {
		dir = path.join(appDir, dir);
		if (fs.existsSync(dir)) {
			appDir = dir;
			break;
		}
	}

	if (appDir === targetDir || !fs.existsSync(appDir)) {
		throw new Error(
			`Could not find expected directories to copy files to: ${frameworkInfo.appDirectories.join(", ")}`,
		);
	}

	const copied: string[] = [];
	const cbDir = path.join(appDir, pathPrefix);
	fs.mkdirSync(cbDir, { recursive: true });

	fs.cpSync(source, cbDir, {
		recursive: true,
		force: false,
	});
	// Determine the list of files copied
	const files = fs.readdirSync(cbDir, {
		recursive: true,
		withFileTypes: true,
	});
	copied.push(
		...files.filter((f) => f.isFile()).map((f) => `${f.parentPath}/${f.name}`),
	);

	return copied;
};
