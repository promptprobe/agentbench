import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentBenchError } from "../errors.js";
import { parseStrictJson } from "../json.js";
import { summarizeResults } from "../results/summary.js";
import { assertJsonComplexity, decodeUtf8, FILE_LIMITS, readBoundedFile, sha256, writePrivateFileAtomic } from "../security.js";
import type { RunManifest, RunResultsFile } from "../core/types.js";
import { renderMarkdownReport } from "./markdown.js";

function parseJson<T>(bytes: Buffer, label: string): T {
  try {
    const parsed = parseStrictJson(decodeUtf8(bytes, label), label);
    assertJsonComplexity(parsed, label, 50, 1_000_000);
    return parsed as T;
  } catch (error) {
    throw new AgentBenchError("validation", `${label} contains invalid JSON.`, [error instanceof Error ? error.message : String(error)]);
  }
}

export async function loadRunDirectory(input: string): Promise<{ directory: string; manifest: RunManifest; resultsFile: RunResultsFile }> {
  const directory = resolve(input);
  const info = await stat(directory).catch(() => undefined);
  if (!info?.isDirectory()) throw new AgentBenchError("validation", `Run path is not a directory: ${directory}`);
  const manifestBytes = await readBoundedFile(resolve(directory, "manifest.json"), FILE_LIMITS.resultFile, "Run manifest");
  const agentBytes = await readBoundedFile(resolve(directory, "agent.json"), FILE_LIMITS.agentRecord, "Normalized agent record");
  const resultsBytes = await readBoundedFile(resolve(directory, "results.json"), FILE_LIMITS.resultFile, "Run results");
  const manifest = parseJson<RunManifest>(
    manifestBytes,
    "Run manifest",
  );
  if (manifest.schemaVersion !== "1") {
    throw new AgentBenchError("validation", "Run files use an unsupported schema version.");
  }
  if (manifest.files?.results !== "results.json" || typeof manifest.files.resultsSha256 !== "string" || manifest.files.resultsSha256 !== sha256(resultsBytes)) {
    throw new AgentBenchError("validation", "results.json does not match the SHA-256 recorded in manifest.json.");
  }
  if (manifest.files.agent !== "agent.json" || typeof manifest.files.agentSha256 !== "string" || manifest.files.agentSha256 !== sha256(agentBytes)) {
    throw new AgentBenchError("validation", "agent.json does not match the SHA-256 recorded in manifest.json.");
  }
  const resultsFile = parseJson<RunResultsFile>(
    resultsBytes,
    "Run results",
  );
  const agentRecord = parseJson<{ id?: unknown; instructions?: unknown; source?: { sha256?: unknown; normalizedInstructionsSha256?: unknown } }>(agentBytes, "Normalized agent record");
  if (resultsFile.schemaVersion !== "1") throw new AgentBenchError("validation", "Run files use an unsupported schema version.");
  if (typeof manifest.runId !== "string" || manifest.runId !== resultsFile.runId || !Array.isArray(resultsFile.results)) {
    throw new AgentBenchError("validation", "Run manifest and results do not describe the same valid run.");
  }
  if (
    agentRecord.id !== manifest.agent.id
    || typeof agentRecord.instructions !== "string"
    || sha256(agentRecord.instructions) !== manifest.agent.normalizedInstructionsSha256
    || agentRecord.source?.sha256 !== manifest.agent.sha256
    || agentRecord.source.normalizedInstructionsSha256 !== manifest.agent.normalizedInstructionsSha256
  ) {
    throw new AgentBenchError("validation", "agent.json is inconsistent with the agent identity recorded in manifest.json.");
  }
  const expectedCases = new Map(manifest.suite.cases.map((entry) => [entry.id, entry.sha256]));
  const seenExecutions = new Set<string>();
  for (const result of resultsFile.results) {
    const key = `${result.testId}\u0000${result.repetition}`;
    if (
      result.runId !== manifest.runId
      || result.agent.sha256 !== manifest.agent.sha256
      || result.agent.normalizedInstructionsSha256 !== manifest.agent.normalizedInstructionsSha256
      || result.suite.id !== manifest.suite.id
      || result.suite.version !== manifest.suite.version
      || expectedCases.get(result.testId) !== result.testSourceSha256
      || !Number.isInteger(result.repetition)
      || result.repetition < 1
      || result.repetition > manifest.parameters.repeat
      || seenExecutions.has(key)
    ) {
      throw new AgentBenchError("validation", "results.json contains an execution inconsistent with manifest.json.");
    }
    seenExecutions.add(key);
  }
  if (seenExecutions.size !== manifest.suite.testCount * manifest.parameters.repeat) {
    throw new AgentBenchError("validation", "results.json does not contain exactly one record for every case repetition.");
  }
  const recomputedSummary = summarizeResults(resultsFile.results, manifest.suite.testCount, manifest.parameters.repeat);
  if (JSON.stringify(recomputedSummary) !== JSON.stringify(resultsFile.summary)) {
    throw new AgentBenchError("validation", "results.json summary is inconsistent with its execution records.");
  }
  return { directory, manifest, resultsFile };
}

export async function regenerateReport(input: string): Promise<{ path: string; markdown: string; manifest: RunManifest; resultsFile: RunResultsFile }> {
  const loaded = await loadRunDirectory(input);
  const markdown = renderMarkdownReport(loaded.manifest, loaded.resultsFile);
  const path = resolve(loaded.directory, "report.md");
  await writePrivateFileAtomic(path, markdown);
  return { path, markdown, manifest: loaded.manifest, resultsFile: loaded.resultsFile };
}
