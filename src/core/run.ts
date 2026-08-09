import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { AdapterExecutionError } from "../adapters/mock.js";
import { AgentBenchError } from "../errors.js";
import { evaluateAssertions } from "../evaluators/evaluate.js";
import { PACKAGE_ROOT } from "../paths.js";
import { renderMarkdownReport } from "../reporting/markdown.js";
import { assertJsonComplexity, FILE_LIMITS, sha256, writePrivateFileAtomic } from "../security.js";
import { summarizeResults } from "../results/summary.js";
import { AGENTBENCH_VERSION } from "../version.js";
import type {
  CompletedRun,
  ExecutionAdapter,
  ExecutionOutput,
  LoadedCase,
  LoadedSuite,
  NormalizedAgent,
  RunManifest,
  RunResultsFile,
  TestResult,
} from "./types.js";

const execFileAsync = promisify(execFile);
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_CAPTURED_OUTPUT_BYTES = 64 * 1024 * 1024;
export const MAX_TEST_EXECUTIONS = 10_000;

export interface RunOptions {
  agent: NormalizedAgent;
  suite: LoadedSuite;
  adapter: ExecutionAdapter;
  repeat: number;
  timeoutMs: number;
  outputDirectory: string;
}

class TestTimeoutError extends Error {}

async function executeWithTimeout(adapter: ExecutionAdapter, agent: NormalizedAgent, test: LoadedCase, repetition: number, timeoutMs: number): Promise<ExecutionOutput> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_accept, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TestTimeoutError(`Test exceeded the ${timeoutMs} ms timeout.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      adapter.execute({ agent, test: test.definition, repetition, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function validateOutput(output: ExecutionOutput): ExecutionOutput & { sha256: string; sizeBytes: number } {
  if (output === null || typeof output !== "object") {
    throw new AgentBenchError("execution", "Adapter returned a non-object output.");
  }
  if (output.rawText === undefined && output.structured === undefined) {
    throw new AgentBenchError("execution", "Adapter output contains neither rawText nor structured data.");
  }
  if (output.rawText !== undefined && typeof output.rawText !== "string") {
    throw new AgentBenchError("execution", "Adapter rawText output must be a string.");
  }
  let structured = "";
  if (output.structured !== undefined) {
    assertJsonComplexity(output.structured, "Adapter structured output", 30, 100_000);
    try {
      structured = JSON.stringify(output.structured);
    } catch (error) {
      throw new AgentBenchError("execution", "Adapter structured output is not JSON serializable.", [error instanceof Error ? error.message : String(error)]);
    }
  }
  const rawText = output.rawText ?? "";
  const serialized = JSON.stringify({ rawText: output.rawText, structured: output.structured });
  const sizeBytes = Buffer.byteLength(rawText) + Buffer.byteLength(structured);
  if (sizeBytes > MAX_OUTPUT_BYTES) {
    throw new AgentBenchError("execution", `Adapter output exceeds the ${MAX_OUTPUT_BYTES}-byte limit.`);
  }
  return { ...output, sha256: sha256(serialized), sizeBytes };
}

async function runOne(
  runId: string,
  agent: NormalizedAgent,
  suite: LoadedSuite,
  test: LoadedCase,
  adapter: ExecutionAdapter,
  repetition: number,
  timeoutMs: number,
): Promise<TestResult> {
  const start = Date.now();
  const startedAt = new Date(start).toISOString();
  const base = {
    schemaVersion: "1" as const,
    runId,
    testId: test.definition.id,
    testTitle: test.definition.title,
    testSourcePath: test.source.path,
    testSourceSha256: test.source.sha256,
    assertionDefinitions: test.definition.expected.assertions,
    repetition,
    category: test.definition.category,
    severity: test.definition.severity,
    agent: {
      id: agent.id,
      sha256: agent.source.sha256,
      normalizedInstructionsSha256: agent.source.normalizedInstructionsSha256,
      sourceType: agent.source.type,
    },
    suite: { id: suite.manifest.id, version: suite.manifest.version },
    adapter: adapter.describe(),
    startedAt,
    input: test.definition.input,
    warnings: [...agent.warnings, ...test.definition.expected_limitations],
  };

  try {
    const observed = await executeWithTimeout(adapter, agent, test, repetition, timeoutMs);
    const validated = validateOutput(observed);
    const assertions = evaluateAssertions(test.definition.expected.assertions, validated);
    const outcome = assertions.some((assertion) => assertion.status === "error")
      ? "error"
      : assertions.every((assertion) => assertion.passed)
        ? "pass"
        : "fail";
    const completed = Date.now();
    return {
      ...base,
      completedAt: new Date(completed).toISOString(),
      durationMs: completed - start,
      output: validated,
      assertions,
      outcome,
      ...(outcome === "error" ? { executionError: { kind: "evaluation" as const, message: "One or more assertions could not be evaluated." } } : {}),
    };
  } catch (error) {
    const completed = Date.now();
    const kind = error instanceof TestTimeoutError
      ? "timeout"
      : error instanceof AdapterExecutionError
        ? error.adapterKind === "transport" ? "transport" : "adapter"
        : "adapter";
    return {
      ...base,
      completedAt: new Date(completed).toISOString(),
      durationMs: completed - start,
      assertions: [],
      outcome: "error",
      executionError: { kind, message: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function sourceCommit(): Promise<string | undefined> {
  if (process.env.GITHUB_SHA?.match(/^[0-9a-f]{40}$/iu)) return process.env.GITHUB_SHA;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: PACKAGE_ROOT, timeout: 2_000 });
    const commit = stdout.trim();
    return /^[0-9a-f]{40}$/u.test(commit) ? commit : undefined;
  } catch {
    return undefined;
  }
}

function runDirectoryName(startedAt: string, runId: string): string {
  return `${startedAt.replace(/[:.]/gu, "-")}--${runId.slice(0, 8)}`;
}

export async function runEvaluation(options: RunOptions): Promise<CompletedRun> {
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 100) {
    throw new AgentBenchError("usage", "Repeat count must be an integer from 1 to 100.");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 600_000) {
    throw new AgentBenchError("usage", "Timeout must be an integer from 1 to 600000 milliseconds.");
  }
  const executionCount = options.repeat * options.suite.cases.length;
  if (executionCount > MAX_TEST_EXECUTIONS) {
    throw new AgentBenchError(
      "usage",
      `This run requests ${executionCount} test executions; the limit is ${MAX_TEST_EXECUTIONS}. Reduce --repeat or split the suite.`,
    );
  }
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const outputRoot = resolve(options.outputDirectory);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const directory = resolve(outputRoot, runDirectoryName(startedAt, runId));
  const casesDirectory = resolve(directory, "cases");
  await mkdir(directory, { recursive: false, mode: 0o700 });
  await mkdir(casesDirectory, { recursive: false, mode: 0o700 });

  const results: TestResult[] = [];
  let capturedOutputBytes = 0;
  for (let repetition = 1; repetition <= options.repeat; repetition += 1) {
    for (const test of options.suite.cases) {
      const testResult = await runOne(runId, options.agent, options.suite, test, options.adapter, repetition, options.timeoutMs);
      capturedOutputBytes += testResult.output?.sizeBytes ?? 0;
      if (capturedOutputBytes > MAX_TOTAL_CAPTURED_OUTPUT_BYTES) {
        throw new AgentBenchError(
          "execution",
          `Run output exceeded the ${MAX_TOTAL_CAPTURED_OUTPUT_BYTES}-byte total capture limit. Split the suite or reduce repetitions.`,
        );
      }
      results.push(testResult);
    }
  }
  const completedAt = new Date().toISOString();
  const descriptor = options.adapter.describe();
  const resolvedOptions = Intl.DateTimeFormat().resolvedOptions();
  const agentInfo = {
    id: options.agent.id,
    ...(options.agent.name === undefined ? {} : { name: options.agent.name }),
    sourceType: options.agent.source.type,
    path: options.agent.source.path,
    sha256: options.agent.source.sha256,
    normalizedInstructionsSha256: options.agent.source.normalizedInstructionsSha256,
    sizeBytes: options.agent.source.sizeBytes,
  };
  const gitCommit = await sourceCommit();
  const normalizedAgentText = `${JSON.stringify({
    schemaVersion: "1",
    id: options.agent.id,
    ...(options.agent.name === undefined ? {} : { name: options.agent.name }),
    instructions: options.agent.instructions,
    source: options.agent.source,
    ...(options.agent.metadata === undefined ? {} : { metadata: options.agent.metadata }),
    warnings: options.agent.warnings,
  }, null, 2)}\n`;
  if (Buffer.byteLength(normalizedAgentText, "utf8") > FILE_LIMITS.agentRecord) {
    throw new AgentBenchError("execution", `Generated agent.json exceeds the ${FILE_LIMITS.agentRecord}-byte record limit.`);
  }
  const resultsFile: RunResultsFile = {
    schemaVersion: "1",
    runId,
    summary: summarizeResults(results, options.suite.cases.length, options.repeat),
    results,
  };
  const resultsText = `${JSON.stringify(resultsFile, null, 2)}\n`;
  if (Buffer.byteLength(resultsText, "utf8") > FILE_LIMITS.resultFile) {
    throw new AgentBenchError(
      "execution",
      `Generated results.json exceeds the ${FILE_LIMITS.resultFile}-byte result-file limit. Split the run.`,
    );
  }
  const manifest: RunManifest = {
    schemaVersion: "1",
    runId,
    agentbench: {
      version: AGENTBENCH_VERSION,
      ...(gitCommit === undefined ? {} : { gitCommit }),
    },
    agent: agentInfo,
    suite: {
      id: options.suite.manifest.id,
      version: options.suite.manifest.version,
      path: options.suite.source.path,
      manifestSha256: options.suite.source.sha256,
      testCount: options.suite.cases.length,
      cases: options.suite.cases.map((test) => ({ id: test.definition.id, path: test.source.path, sha256: test.source.sha256 })),
    },
    adapter: descriptor,
    parameters: {
      repeat: options.repeat,
      timeoutMs: options.timeoutMs,
      resourceLimits: {
        maxOutputBytes: MAX_OUTPUT_BYTES,
        maxTotalCapturedOutputBytes: MAX_TOTAL_CAPTURED_OUTPUT_BYTES,
        maxTestExecutions: MAX_TEST_EXECUTIONS,
        maxResultFileBytes: FILE_LIMITS.resultFile,
      },
    },
    startedAt,
    completedAt,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      ...(resolvedOptions.locale === undefined ? {} : { locale: resolvedOptions.locale }),
      ...(resolvedOptions.timeZone === undefined ? {} : { timezone: resolvedOptions.timeZone }),
      ci: Boolean(process.env.CI),
    },
    files: {
      agent: "agent.json",
      agentSha256: sha256(normalizedAgentText),
      results: "results.json",
      resultsSha256: sha256(resultsText),
      report: "report.md",
      casesDirectory: "cases",
    },
    warnings: [...new Set([...options.agent.warnings, ...descriptor.warnings])],
  };
  await writePrivateFileAtomic(resolve(directory, "agent.json"), normalizedAgentText);
  await writePrivateFileAtomic(resolve(directory, "results.json"), resultsText);
  await writePrivateFileAtomic(resolve(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const entry of results) {
    const path = resolve(casesDirectory, `${entry.testId}--${entry.repetition}.json`);
    await writePrivateFileAtomic(path, `${JSON.stringify(entry, null, 2)}\n`);
  }
  await writePrivateFileAtomic(resolve(directory, "report.md"), renderMarkdownReport(manifest, resultsFile));
  return { directory, manifest, resultsFile };
}
