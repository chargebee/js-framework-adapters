import type { PackageManifest } from "@pnpm/types";
import colors from "ansi-colors";
import Enquirer from "enquirer";

import { type CheckError, frameworkChecks, preflightChecks } from "./checks.js";
import {
	type DetectedFramework,
	detectFramework,
	type Framework,
	supportedFrameworks,
} from "./frameworks.js";
import * as help from "./help.js";
import {
	getPackageJson,
	updateDependencies,
	writePackageJson,
} from "./package.js";
import {
	confirmWritePrompt,
	gitPrompt,
	pathPrefixPrompt,
	targetDirPrompt,
} from "./prompts.js";
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

export const init = async (flags: Record<string, unknown>): Promise<void> => {
	const { path, dangerouslySkipChecks } = flags;
	const cwd = (path || process.cwd()) as string;
	const enquirer = new Enquirer();

	let updatedFiles: string[] = [];
	let detectedFramework: DetectedFramework | undefined;

	if (!dangerouslySkipChecks) {
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

		const { pathPrefix } = (await enquirer.prompt(pathPrefixPrompt())) as {
			pathPrefix: string;
		};

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

		updatedFiles = await copyFiles(
			targetDir,
			detectedFramework,
			pathPrefix,
			pkg,
		);
	} else {
		// we skipped all checks
		const pkg = getPackageJson(cwd);
		if (!pkg) {
			error("Could not find package.json in the current directory");
		}
		detectedFramework = detectFramework(pkg!);
		if (!detectedFramework) {
			error(`Could not detect a supported framework in ${cwd}/package.json`);
		}
		const pathPrefix = "/chargebee";
		updatedFiles = await copyFiles(cwd, detectedFramework!, pathPrefix, pkg!);
	}

	if (updatedFiles.length > 0) {
		console.log(
			colors.green(
				`\nThe following files were created or updated: \n${updatedFiles.join("\n")}\n`,
			),
		);
		console.log(colors.yellow(help.messages[detectedFramework!.name].postinit));
	}
};

const copyFiles = async (
	targetDir: string,
	detectedFramework: DetectedFramework,
	pathPrefix: string,
	pkg: PackageManifest,
): Promise<string[]> => {
	try {
		const frameworkName = detectedFramework.name as Framework;
		const updatedFiles = copyTemplates({
			targetDir,
			framework: frameworkName,
			frameworkInfo: supportedFrameworks[frameworkName],
			pathPrefix,
		});

		const updatedPkg = updateDependencies(pkg, detectedFramework);
		writePackageJson(targetDir, updatedPkg);
		updatedFiles.push(`package.json`);

		return updatedFiles;
	} catch (err: unknown) {
		error("Could not copy files to the app directory", err as string);
		return [];
	}
};
