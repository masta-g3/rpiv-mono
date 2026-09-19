import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("pre-push hook", () => {
	it("clears repository-local Git variables before running tests", () => {
		const directory = mkdtempSync(join(tmpdir(), "rpiv-pre-push-"));
		temporaryDirectories.push(directory);
		const output = join(directory, "environment.txt");
		const npm = join(directory, "npm");
		writeFileSync(
			npm,
			`#!/bin/sh\nprintf '%s\\n%s\\n%s\\n' "\${GIT_DIR-unset}" "\${GIT_WORK_TREE-unset}" "$*" > "$HOOK_ENV_OUTPUT"\n`,
		);
		chmodSync(npm, 0o755);

		execFileSync("sh", [resolve(".husky/pre-push")], {
			cwd: resolve("."),
			env: {
				...process.env,
				GIT_DIR: "/poisoned/repository",
				GIT_WORK_TREE: "/poisoned/worktree",
				HOOK_ENV_OUTPUT: output,
				PATH: `${directory}:${process.env.PATH ?? ""}`,
			},
		});

		expect(readFileSync(output, "utf8")).toBe("unset\nunset\nrun coverage\n");
	});
});
