import Enquirer from "enquirer";
import * as colors from "ansi-colors";
import fs from "node:fs";
import {
	frameworkChecks,
	preflightChecks,
	type PreflightResponse,
	type CheckError,
} from "./checks";
import type { DetectedFramework } from "./frameworks";
import { copyTemplates } from "./templates";
import { writePackageJson, updateDependencies } from "./package";

export const enquirer = new Enquirer();

// Infer the type of the prompt options as it's not exported
type Prompt = Parameters<typeof enquirer.prompt>[0];

const error = (...lines: string[]): void => {
	console.error(
		`\n${lines.map((line) => colors.red(`✖ ${line}`)).join("\n")}\n`,
	);
	process.exit(1);
};

const checkErrors = ({ errors }: object & { errors: CheckError[] }) => {
	const bailErrors = errors.filter((err) => err.bail);
	if (bailErrors.length > 0) {
		error(...bailErrors.map((err) => err.msg));
	}
};

const targetDirPrompt = (cwd: string): Prompt => ({
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

const gitPrompt = (preflight: PreflightResponse): Prompt => ({
	type: "confirm",
	name: "gitConfirm",
	message: () =>
		colors.yellow(
			`${preflight.errors.filter((err) => !err.bail)[0]?.msg}. Do you want to continue?`,
		),
});

const confirmWritePrompt = (framework: DetectedFramework): Prompt => ({
	type: "confirm",
	name: "confirmWrite",
	message: () =>
		`Supported version of ${framework.name} found! Please read these details to continue: \n
${colors.blue(framework.info.description)}

The next step is to create the required files and update package.json with the dependencies.
${colors.green("Do you want to continue?")}`,
});

export const run = async (argv: string[]): Promise<void> => {
	const cwd = argv[0] ?? process.cwd();

	const { targetDir } = (await enquirer.prompt(targetDirPrompt(cwd))) as {
		targetDir: string;
	};

	// General checks
	const preflightResponse = await preflightChecks(targetDir);
	checkErrors(preflightResponse);

	if (preflightResponse.errors.length > 0) {
		const { gitConfirm } = (await enquirer.prompt(
			gitPrompt(preflightResponse),
		)) as {
			gitConfirm: boolean;
		};
		if (!gitConfirm) {
			error("Did not make any changes");
		}
	}

	// Check target framework and version
	// biome-ignore lint/style/noNonNullAssertion: pkg will always be available here
	const pkg = preflightResponse.pkg!;
	const frameworkResponse = await frameworkChecks(pkg);
	checkErrors(frameworkResponse);
	if (!frameworkResponse) {
		throw new Error(`Could not determine framework in package`);
	}

	// biome-ignore lint/style/noNonNullAssertion: framework will always be available here
	const detectedFramework = frameworkResponse.framework!;
	const { confirmWrite } = (await enquirer.prompt(
		confirmWritePrompt(detectedFramework),
	)) as {
		confirmWrite: boolean;
	};

	if (!confirmWrite) {
		console.log(colors.yellow("Not proceeding, did not make any changes"));
		process.exit(0);
	}
	// Copy templates
	try {
		const updatedFiles = copyTemplates(targetDir, detectedFramework.name, [
			"checkout",
		]);
		const updatedPkg = updateDependencies(pkg, detectedFramework);
		writePackageJson(targetDir, updatedPkg);
		updatedFiles.push(`package.json`);

		console.log(
			colors.green(
				`\nThe following files were created or updated: \n${updatedFiles.join("\n")}\n`,
			),
		);
		console.log(
			colors.green(
				`Please run (npm|pnpm|yarn|bun) install before you start your server`,
			),
		);
	} catch (err: unknown) {
		error("Could not copy files to the app directory", err as string);
	}
};
