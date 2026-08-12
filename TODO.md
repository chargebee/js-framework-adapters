# Beta

- [x] Pull in live data in the `apiPayload` method

- [x] Optionally get the prefix (/chargebee) from the user/let them replace

- [x] Set header for all API calls indicating the source tool (chargebee-init) and the framework (nextjs/express)

- [x] Update cb-client-libs to accept a list of default headers for the client

- [x] Cleanup creation of multiple clients for each middleware, make it a singleton

- [x] Move existing readme to developer.md and add documentation for usage

- [x] CI pipeline to at least build all the packages to maintain basic sanity

# Nice to have

- [ ] Write/append the required env variables to `.env` or `.env.example`

- [ ] Automatically run the appropriate package manager by detecting which lockfile is present

- [ ] Consolidate the initial checks (git/supported framework) into a single step and display the results to the user with an option of continuing if it's just a warning. This makes it very evident what is expected to run the tool

- [ ] changesets/conventional commits for release

- [ ] Read express/nextjs adapter version from package.json and pass to userAgentSuffix

# Other topics discussed with KPS

- [ ] Entitlements

- [ ] Entitlements service sidecar??

- [ ] Better auth integration: what are the major features and how does the API interact?
