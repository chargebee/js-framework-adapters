import fs from "node:fs";
import path from "node:path";

import type { Framework, FrameworkInfo } from "./frameworks.js";

const __dirname = globalThis.__dirname ?? import.meta.dirname;

export const copyTemplates = ({
	targetDir,
	framework,
	frameworkInfo,
	pathPrefix = "",
}: {
	targetDir: string;
	framework: Framework;
	frameworkInfo: FrameworkInfo;
	pathPrefix: string;
}): string[] => {
	const srcDir = path.join(__dirname, "templates", framework);

	// Determine app directory to write files to
	let appDir = targetDir;
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

	const copiedFiles: string[] = [];
	const templatesDir = path.join(appDir, pathPrefix);

	copyDirectory(srcDir, templatesDir, { pathPrefix }, copiedFiles);
	return copiedFiles;
};

function replaceVariables(
	text: string,
	replacements: Record<string, string>,
): string {
	return text.replace(/{{\s*(\w+)\s*}}/g, (_, key) => replacements[key] ?? "");
}

// Recursively copy the directory and replace templated strings
function copyDirectory(
	srcDir: string,
	destDir: string,
	replacements: Record<string, string>,
	copiedFiles: string[],
) {
	// Ensure destination directory exists
	if (!fs.existsSync(destDir)) {
		fs.mkdirSync(destDir, { recursive: true });
	}

	// Read all items in the current source directory
	const items = fs.readdirSync(srcDir, { withFileTypes: true });

	for (const item of items) {
		const srcPath = path.join(srcDir, item.name);
		const destPath = path.join(destDir, item.name);

		if (item.isDirectory()) {
			// Recursively copy subdirectory
			copyDirectory(srcPath, destPath, replacements, copiedFiles);
		} else if (item.isFile()) {
			let content = fs.readFileSync(srcPath, "utf-8");

			// Only perform replacements for .ts files
			if (path.extname(item.name) === ".ts") {
				content = replaceVariables(content, replacements);
			}

			fs.writeFileSync(destPath, content, "utf-8");
			copiedFiles.push(destPath);
		}
	}
}
