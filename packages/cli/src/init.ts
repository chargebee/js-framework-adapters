import colors from "ansi-colors";
import Enquirer from "enquirer";

import { type CheckError, frameworkChecks, preflightChecks } from "./checks.js";
import { type Framework, supportedFrameworks } from "./frameworks.js";
import * as help from "./help.js";
import { updateDependencies, writePackageJson } from "./package.js";
import { confirmWritePrompt, gitPrompt, targetDirPrompt } from "./prompts.js";
import { copyTemplates } from "./templates.js";

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

export const init = async (): Promise<void> => {
	const cwd = process.cwd();
	const enquirer = new Enquirer();

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
		const frameworkName = detectedFramework.name as Framework;
		const updatedFiles = copyTemplates(
			targetDir,
			frameworkName,
			supportedFrameworks[frameworkName],
		);
		const updatedPkg = updateDependencies(pkg, detectedFramework);
		writePackageJson(targetDir, updatedPkg);
		updatedFiles.push(`package.json`);

		console.log(
			colors.green(
				`\nThe following files were created or updated: \n${updatedFiles.join("\n")}\n`,
			),
		);
		console.log(colors.yellow(help.messages[frameworkName].postinit));
	} catch (err: unknown) {
		error("Could not copy files to the app directory", err as string);
	}
};
