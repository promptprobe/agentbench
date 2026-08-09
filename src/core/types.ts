import type { Assertion, TestCase } from "../schema.js";

export interface NormalizedAgent {
  id: string;
  name?: string;
  instructions: string;
  source: {
    type: "system-prompt" | "generic-json" | "buzz-agent-snapshot";
    path: string;
    sha256: string;
    normalizedInstructionsSha256: string;
    sizeBytes: number;
  };
  metadata?: Record<string, unknown>;
  warnings: string[];
}

export interface LoadedCase {
  definition: TestCase;
  source: {
    path: string;
    sha256: string;
  };
}

export interface LoadedSuite {
  manifest: {
    schema_version: "1";
    id: string;
    version: string;
    title: string;
    description: string;
    tags: string[];
  };
  source: {
    path: string;
    sha256: string;
  };
  cases: LoadedCase[];
}

export interface ExecutionOutput {
  rawText?: string;
  structured?: unknown;
}

export interface AdapterExecutionInput {
  agent: NormalizedAgent;
  test: TestCase;
  repetition: number;
  signal: AbortSignal;
}

export interface AdapterDescriptor {
  id: string;
  version?: string;
  runtime?: string;
  model?: string;
  parameters: Record<string, unknown>;
  warnings: string[];
}

export interface ExecutionAdapter {
  readonly id: string;
  describe(): AdapterDescriptor;
  execute(input: AdapterExecutionInput): Promise<ExecutionOutput>;
}

export type AssertionStatus = "pass" | "fail" | "error";

export interface AssertionResult {
  path: string;
  type: Assertion["type"];
  status: AssertionStatus;
  passed: boolean;
  message: string;
  evidence: Record<string, unknown>;
  children?: AssertionResult[];
}

export type TestOutcome = "pass" | "fail" | "error" | "skipped";

export interface TestResult {
  schemaVersion: "1";
  runId: string;
  testId: string;
  testTitle: string;
  testSourcePath: string;
  testSourceSha256: string;
  assertionDefinitions: Assertion[];
  repetition: number;
  category: TestCase["category"];
  severity: TestCase["severity"];
  agent: {
    id: string;
    sha256: string;
    normalizedInstructionsSha256: string;
    sourceType: NormalizedAgent["source"]["type"];
  };
  suite: {
    id: string;
    version: string;
  };
  adapter: AdapterDescriptor;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  input: TestCase["input"];
  output?: ExecutionOutput & { sha256: string; sizeBytes: number };
  assertions: AssertionResult[];
  outcome: TestOutcome;
  executionError?: {
    kind: "timeout" | "transport" | "adapter" | "evaluation";
    message: string;
  };
  warnings: string[];
}

export interface CategorySummary {
  category: TestCase["category"];
  pass: number;
  fail: number;
  error: number;
  skipped: number;
}

export interface ConsistencySummary {
  testId: string;
  repetitions: number;
  passFrequency: number;
  outcomes: Record<TestOutcome, number>;
  inconsistentOutcome: boolean;
  distinctOutputHashes: number;
  outputVaried: boolean;
}

export interface RunSummary {
  testExecutions: number;
  uniqueTests: number;
  repetitions: number;
  pass: number;
  fail: number;
  error: number;
  skipped: number;
  assertionsPassed: number;
  assertionsFailed: number;
  assertionErrors: number;
  testPassRate: number;
  assertionPassRate: number;
  categories: CategorySummary[];
  consistency: ConsistencySummary[];
}

export interface RunManifest {
  schemaVersion: "1";
  runId: string;
  agentbench: {
    version: string;
    gitCommit?: string;
  };
  agent: {
    id: string;
    name?: string;
    sourceType: NormalizedAgent["source"]["type"];
    path: string;
    sha256: string;
    normalizedInstructionsSha256: string;
    sizeBytes: number;
  };
  suite: {
    id: string;
    version: string;
    path: string;
    manifestSha256: string;
    testCount: number;
    cases: Array<{
      id: string;
      path: string;
      sha256: string;
    }>;
  };
  adapter: AdapterDescriptor;
  parameters: {
    repeat: number;
    timeoutMs: number;
    resourceLimits: {
      maxOutputBytes: number;
      maxTotalCapturedOutputBytes: number;
      maxTestExecutions: number;
      maxResultFileBytes: number;
    };
  };
  startedAt: string;
  completedAt: string;
  environment: {
    node: string;
    platform: NodeJS.Platform;
    arch: string;
    locale?: string;
    timezone?: string;
    ci: boolean;
  };
  files: {
    agent: "agent.json";
    agentSha256: string;
    results: "results.json";
    resultsSha256: string;
    report: "report.md";
    casesDirectory: "cases";
  };
  warnings: string[];
}

export interface RunResultsFile {
  schemaVersion: "1";
  runId: string;
  summary: RunSummary;
  results: TestResult[];
}

export interface CompletedRun {
  directory: string;
  manifest: RunManifest;
  resultsFile: RunResultsFile;
}
