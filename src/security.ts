import { createHash, randomUUID } from "node:crypto";
import { open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { AgentBenchError, errorMessage } from "./errors.js";

export const FILE_LIMITS = {
  agent: 5 * 1024 * 1024,
  agentRecord: 16 * 1024 * 1024,
  suiteManifest: 256 * 1024,
  testCase: 512 * 1024,
  mockFixture: 5 * 1024 * 1024,
  resultFile: 256 * 1024 * 1024,
} as const;

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new AgentBenchError("validation", `${label} is not valid UTF-8.`, [errorMessage(error)]);
  }
}

export async function readBoundedFile(path: string, maximumBytes: number, label: string): Promise<Buffer> {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    throw new AgentBenchError("validation", `${label} could not be read: ${path}`, [errorMessage(error)]);
  }
  if (!info.isFile()) throw new AgentBenchError("validation", `${label} is not a regular file: ${path}`);
  if (info.size < 1) throw new AgentBenchError("validation", `${label} is empty: ${path}`);
  if (info.size > maximumBytes) {
    throw new AgentBenchError("validation", `${label} exceeds the ${maximumBytes}-byte limit: ${path}`);
  }
  try {
    return await readFile(path);
  } catch (error) {
    throw new AgentBenchError("validation", `${label} could not be read: ${path}`, [errorMessage(error)]);
  }
}

export async function resolveContainedFile(root: string, untrustedRelativePath: string): Promise<string> {
  if (isAbsolute(untrustedRelativePath) || untrustedRelativePath.split(/[\\/]/u).includes("..")) {
    throw new AgentBenchError("validation", `Suite case path escapes its suite: ${untrustedRelativePath}`);
  }
  const rootPath = await realpath(root);
  const target = await realpath(resolve(rootPath, untrustedRelativePath)).catch((error: unknown) => {
    throw new AgentBenchError("validation", `Suite case could not be resolved: ${untrustedRelativePath}`, [errorMessage(error)]);
  });
  const relation = relative(rootPath, target);
  if (relation.startsWith("..") || isAbsolute(relation)) {
    throw new AgentBenchError("validation", `Suite case path escapes its suite: ${untrustedRelativePath}`);
  }
  return target;
}

/** Remove terminal controls while preserving ordinary newlines and tabs. */
export function sanitizeTerminal(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex -- intentionally strips ANSI escape sequences from untrusted output
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/gu, "")
    // eslint-disable-next-line no-control-regex -- intentionally strips unsafe C0/C1 controls while retaining newlines and tabs
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "");
}

export function markdownText(value: string): string {
  return sanitizeTerminal(value).replace(/\r?\n/gu, " ").replace(/([\\`*_[\]<>#+.!|{}()-])/gu, "\\$1");
}

export function fencedCode(value: string, language = "text"): string {
  const clean = sanitizeTerminal(value);
  const longest = Math.max(0, ...[...clean.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${clean}\n${fence}`;
}

export function inlineCode(value: string): string {
  const clean = sanitizeTerminal(value).replace(/\r?\n/gu, " ");
  const longest = Math.max(0, ...[...clean.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(1, longest + 1));
  const padding = clean.startsWith("`") || clean.endsWith("`") || clean.startsWith(" ") || clean.endsWith(" ") ? " " : "";
  return `${fence}${padding}${clean}${padding}${fence}`;
}

export async function writePrivateFileAtomic(path: string, contents: string): Promise<void> {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await rename(temporary, path);
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (!["EEXIST", "EPERM"].includes(code)) throw error;
      await unlink(path).catch((unlinkError: unknown) => {
        const unlinkCode = unlinkError !== null && typeof unlinkError === "object" && "code" in unlinkError ? String(unlinkError.code) : "";
        if (unlinkCode !== "ENOENT") throw unlinkError;
      });
      await rename(temporary, path);
    }
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw new AgentBenchError("io", `Could not write file atomically: ${path}`, [errorMessage(error)]);
  }
}

export function assertJsonComplexity(value: unknown, label: string, maximumDepth = 20, maximumNodes = 20_000): void {
  let nodes = 0;
  const ancestors = new WeakSet<object>();
  const visit = (entry: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > maximumNodes) throw new AgentBenchError("validation", `${label} contains too many JSON values.`);
    if (depth > maximumDepth) throw new AgentBenchError("validation", `${label} exceeds the maximum nesting depth.`);
    if (entry !== null && typeof entry === "object") {
      if (ancestors.has(entry)) throw new AgentBenchError("validation", `${label} contains a circular structure.`);
      ancestors.add(entry);
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item, depth + 1);
    } else if (entry !== null && typeof entry === "object") {
      for (const item of Object.values(entry as Record<string, unknown>)) visit(item, depth + 1);
    }
    if (entry !== null && typeof entry === "object") ancestors.delete(entry);
  };
  visit(value, 0);
}
