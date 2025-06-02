import meow from "meow";

const cli = meow(
	`
  Usage
    $ chargebee-init <command>

  Options
    --dir, -d Directory of your app

  Examples
    $ chargebee-init
    $ chargebee-init help
    $ chargebee-init help nextjs
  `,
	{
		importMeta: import.meta,
		flags: {
			command: {
				type: "string",
				isRequired: false,
				default: "init",
			},
		},
	},
);
