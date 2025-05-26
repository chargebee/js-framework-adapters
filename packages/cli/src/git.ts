import { simpleGit } from "simple-git";

export async function isCleanTree(dir: string): Promise<boolean> {
	try {
		const git = simpleGit(dir);
		return (await git.status()).isClean();
	} catch (_err) {
		return false;
	}
}
