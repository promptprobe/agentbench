import { access, readdir, realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { AgentBenchError } from "../errors.js";
import { BUILTIN_SUITES_ROOT } from "../paths.js";
import { SuiteManifestSchema, TestCaseSchema } from "../schema.js";
import { assertJsonComplexity, decodeUtf8, FILE_LIMITS, readBoundedFile, resolveContainedFile, sha256 } from "../security.js";
import type { LoadedCase, LoadedSuite } from "../core/types.js";
import { parseSchema } from "../validation.js";
import { parseYaml } from "../yaml.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveSuitePath(input: string): Promise<string> {
  const explicit = resolve(input);
  if (await pathExists(explicit)) return explicit;
  if (!input.includes("/") && !input.includes("\\")) {
    const builtin = resolve(BUILTIN_SUITES_ROOT, input);
    if (await pathExists(builtin)) return builtin;
  }
  throw new AgentBenchError("validation", `Suite was not found: ${input}`);
}

export async function loadTestCase(path: string): Promise<LoadedCase> {
  const bytes = await readBoundedFile(path, FILE_LIMITS.testCase, "Test case");
  const parsed = parseYaml(decodeUtf8(bytes, `Test case ${path}`), `Test case ${path}`);
  assertJsonComplexity(parsed, `Test case ${path}`);
  return {
    definition: parseSchema(TestCaseSchema, parsed, `Test case ${path}`),
    source: { path, sha256: sha256(bytes) },
  };
}

export async function loadSuite(input: string): Promise<LoadedSuite> {
  const suiteDirectory = await realpath(await resolveSuitePath(input));
  const info = await stat(suiteDirectory).catch(() => undefined);
  if (!info?.isDirectory()) throw new AgentBenchError("validation", `Suite path is not a directory: ${suiteDirectory}`);
  const manifestPath = resolve(suiteDirectory, "suite.yaml");
  const manifestBytes = await readBoundedFile(manifestPath, FILE_LIMITS.suiteManifest, "Suite manifest");
  const rawManifest = parseYaml(decodeUtf8(manifestBytes, `Suite manifest ${manifestPath}`), `Suite manifest ${manifestPath}`);
  assertJsonComplexity(rawManifest, `Suite manifest ${manifestPath}`);
  const manifest = parseSchema(SuiteManifestSchema, rawManifest, `Suite manifest ${manifestPath}`);
  const cases: LoadedCase[] = [];
  const ids = new Map<string, string>();
  for (const relativeCase of manifest.cases) {
    const casePath = await resolveContainedFile(suiteDirectory, relativeCase);
    const loaded = await loadTestCase(casePath);
    const previous = ids.get(loaded.definition.id);
    if (previous !== undefined) {
      throw new AgentBenchError("validation", `Duplicate test ID '${loaded.definition.id}' in suite '${manifest.id}'.`, [
        previous,
        casePath,
      ]);
    }
    ids.set(loaded.definition.id, casePath);
    cases.push(loaded);
  }
  return {
    manifest: {
      schema_version: manifest.schema_version,
      id: manifest.id,
      version: manifest.version,
      title: manifest.title,
      description: manifest.description,
      tags: manifest.tags,
    },
    source: { path: suiteDirectory, sha256: sha256(manifestBytes) },
    cases,
  };
}

export async function listBuiltinSuiteIds(): Promise<string[]> {
  const entries = await readdir(BUILTIN_SUITES_ROOT, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => basename(entry.name)).sort();
}
