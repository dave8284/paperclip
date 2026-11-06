import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseObject } from "../adapters/utils.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";

/** A repository-free sandbox task needs isolation, but has no Git base. */
export function shouldUseIsolatedTaskDirectory(input: {
  trustPreset: string;
  environmentDriver: string | null;
  mode: string;
  hasProjectWorkspace: boolean;
  projectWorkspaceId: string | null;
  workspaceStrategies: unknown[];
}): boolean {
  return input.trustPreset === "low_trust_review"
    && input.environmentDriver === "sandbox"
    && input.mode === "isolated_workspace"
    && !input.hasProjectWorkspace
    && !input.projectWorkspaceId
    // Never discard an explicit repository/branch requirement or setup hook.
    && input.workspaceStrategies.every((value) => Object.keys(parseObject(value)).length === 0);
}

/** Stable across turns, separate from project roots and shared agent homes. */
export async function materializeIsolatedTaskDirectory(input: {
  companyId: string;
  issueId: string;
  attemptId?: string;
  purpose?: "egm_packet_review";
}): Promise<string> {
  // Files belong to the task, so reassignment preserves the same workspace.
  const identities = [input.companyId, input.issueId, ...(input.attemptId ? [input.attemptId] : [])];
  if (identities.some((value) => !/^[a-zA-Z0-9_-]+$/.test(value))) {
    throw new Error("Invalid isolated task workspace identity");
  }
  const root = resolvePaperclipInstanceRoot();
  await mkdir(root, { recursive: true });
  let cwd = await realpath(root);
  // A retry is a sibling namespace, never a descendant of the retained root.
  // An old copyback operation must not be able to overwrite its replacement.
  for (const segment of [input.purpose === "egm_packet_review" ? "egm-review-workspaces" : input.attemptId ? "isolated-workspace-attempts" : "isolated-workspaces", ...identities]) {
    cwd = path.join(cwd, segment);
    await mkdir(cwd, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(cwd);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(cwd) !== cwd) {
      throw new Error("Isolated task workspace path is not a private directory");
    }
  }
  return cwd;
}

/** A frozen review has no employee repository or startup project configuration.
 * The minimal Git boundary stops discovery of ancestor project configuration.
 * Reuse is only for this exact run; unexpected files fail closed on recovery. */
export async function materializeEgmReviewWorkspace(input: { companyId: string; issueId: string; runId: string }): Promise<string> {
  const cwd = await materializeIsolatedTaskDirectory({ companyId: input.companyId, issueId: input.issueId, attemptId: input.runId, purpose: "egm_packet_review" });
  for (const relative of [".git", ".git/refs", ".git/refs/heads", ".git/objects"]) {
    const directory = path.join(cwd, relative);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("EGM review workspace boundary is not a private directory");
  }
  for (const [relative, body] of [[".git/HEAD", "ref: refs/heads/main\n"], [".git/config", "[core]\n\trepositoryformatversion = 0\n\tbare = false\n"]]) {
    const file = path.join(cwd, relative);
    await writeFile(file, body, { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || await readFile(file, "utf8") !== body) throw new Error("EGM review workspace boundary changed");
  }
  const allowed: Record<string, string[]> = { "": [".git"], ".git": ["HEAD", "config", "objects", "refs"], ".git/refs": ["heads"], ".git/refs/heads": [], ".git/objects": [] };
  for (const [relative, names] of Object.entries(allowed)) {
    if ((await readdir(path.join(cwd, relative))).some(name => !names.includes(name))) throw new Error("EGM review workspace contains undeclared files");
  }
  return cwd;
}
