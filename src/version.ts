import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PACKAGE_ROOT } from "./paths.js";

interface PackageMetadata {
  version?: unknown;
}

function readVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, "package.json"), "utf8")) as PackageMetadata;
    return typeof parsed.version === "string" ? parsed.version : "0.0.0-unknown";
  } catch {
    return "0.0.0-unknown";
  }
}

export const AGENTBENCH_VERSION = readVersion();
