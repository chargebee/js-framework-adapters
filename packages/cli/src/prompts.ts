import fs from "node:fs";
import colors from "ansi-colors";
import Enquirer from "enquirer";
import type { PreflightResponse } from "./checks.js";
import type { DetectedFramework } from "./frameworks.js";

export const enquirer = new Enquirer();

// Infer the type of the prompt options as it's not exported
type Prompt = Parameters<typeof enquirer.prompt>[0];

export const targetDirPrompt = (cwd: string): Prompt => ({
	type: "text",
	name: "targetDir",
	message: `Where do you want to ?`,
	initial: cwd,
	validate(path) {
		if (!(fs.existsSync(path) && fs.lstatSync(path).isDirectory())) {
			return `${path} doesn't exist or is not a directory`;
		}
		return true;
	},
});

export const gitPrompt = (preflight: PreflightResponse): Prompt => ({
	type: "confirm",
	name: "gitConfirm",
	message: () =>
		colors.yellow(
			`${preflight.errors.filter((err) => !err.bail)[0]?.msg}. Do you want to continue?`,
		),
});

export const confirmWritePrompt = (framework: DetectedFramework): Prompt => ({
	type: "confirm",
	name: "confirmWrite",
	message: () =>
		`Supported version of ${framework.name} found! Please read these details to continue: \n
${colors.blue(framework.info.description)}

The next step is to create the required files and update package.json with the dependencies.
${colors.green("Do you want to continue?")}`,
});
