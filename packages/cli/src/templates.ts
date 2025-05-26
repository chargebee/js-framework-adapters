import fs from "node:fs";
import path from "node:path";

import type { Framework, Features } from "./frameworks";

const pathPrefix = "chargebee";

export const copyTemplates = (
	targetDir: string,
	framework: Framework,
	features: Features[],
): string[] => {
	const source = path.join(__dirname, "templates", framework);
	let srcDir = path.join(targetDir, "app");

	if (!fs.existsSync(srcDir)) {
		srcDir = path.join(targetDir, "src", "app");
		throw new Error(`Could not find directories app or src/app`);
	}

	const copied: string[] = [];
	for (const feature of features) {
		const featurePath = path.join(source, feature);
		const cbDir = path.join(srcDir, pathPrefix, feature);
		fs.mkdirSync(cbDir, { recursive: true });

		fs.cpSync(featurePath, cbDir, {
			recursive: true,
			force: false,
		});
		// Determine the list of files copied
		const files = fs.readdirSync(cbDir, {
			recursive: true,
			withFileTypes: true,
		});
		copied.push(
			...files
				.filter((f) => f.isFile())
				.map((f) => `${f.parentPath}/${f.name}`),
		);
	}

	return copied;
};
