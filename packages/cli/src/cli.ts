import colors from "ansi-colors";
import meow from "meow";

import * as help from "./help.js";
import { init } from "./init.js";

const cli = meow(
	`
Usage
	$ chargebee-init <command> [subcommand]

Options
	--help display this help text

Examples
	$ chargebee-init
	$ chargebee-init help
	$ chargebee-init help nextjs|express
  `,
	{
		importMeta: import.meta,
		autoHelp: true,
		autoVersion: true,
	},
);

export async function run() {
	const [command = "", subcommand = ""] = cli.input;
	switch (command) {
		case "":
		case "init":
			await init();
			break;

		case "help":
			{
				if (!subcommand || !(subcommand in help.messages)) {
					console.log(
						colors.cyanBright(
							help.cliHelpMsg(cli.pkg.version!, cli.pkg.description!),
						),
					);
					console.log(cli.help.replace(cli.pkg.description!, "").trim());
				} else {
					const framework = subcommand as keyof typeof help.messages;
					console.log(help.messages[framework].preinit);
					console.log(colors.yellowBright(help.messages[framework].postinit));
				}
			}
			break;

		default:
			cli.showHelp();
	}
}
