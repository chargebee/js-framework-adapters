import fs from "node:fs";
import colors from "ansi-colors";
import type Enquirer from "enquirer";

import type { PreflightResponse } from "./checks.js";
import type { DetectedFramework } from "./frameworks.js";
import * as help from "./help.js";

// Infer the type of the prompt options as it's not exported
type Prompt = Parameters<typeof Enquirer.prompt>[0];

export const targetDirPrompt = (cwd: string): Prompt => ({
	type: "text",
	name: "targetDir",
	message: `Path to your existing app`,
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
${colors.cyanBright(help.messages[framework.name].preinit)}

The next step is to create the required files and update package.json with the dependencies.
${colors.green("Do you want to continue?")}`,
});

export const apiAuthPrompt = (): Prompt => [
	{
		type: "input",
		name: "siteName",
		message: "Site name",
		initial: "site-test",
	},
	{
		type: "password",
		name: "apiKey",
		message() {
			const siteName = (this as any).state.answers.siteName;
			const url = `https://${siteName}.chargebee.com/apikeys_and_webhooks/api`;
			return `API key [${colors.underline(colors.gray(url))}]`;
		},
	},
];

export const pathPrefixPrompt = (): Prompt => ({
	type: "input",
	name: "pathPrefix",
	message:
		"The base path prefix for all the routes created. You can edit the generated files to change this later",
	initial: "/",
	result(value) {
		return value.replace(/^\/*|\/*$/g, "");
	},
});
