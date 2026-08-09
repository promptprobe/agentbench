import { access, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, MockAdapter } from "../src/adapters/mock.js";
import { loadAgent } from "../src/agents/load-agent.js";
import { runEvaluation } from "../src/core/run.js";
import type { ExecutionAdapter } from "../src/core/types.js";
import { DEFAULT_MOCK_FIXTURE, PACKAGE_ROOT } from "../src/paths.js";
import { loadSuite } from "../src/suites/load-suite.js";
import { regenerateReport } from "../src/reporting/load-run.js";

describe("run evidence pipeline", () => {
  it("writes a manifest, aggregate results, per-case evidence, and Markdown report", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), "agentbench-run-"));
    const [agent, suite, adapter] = await Promise.all([
      loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
      loadSuite("authority"),
      MockAdapter.fromFile(DEFAULT_MOCK_FIXTURE),
    ]);
    const completed = await runEvaluation({ agent, suite, adapter, repeat: 2, timeoutMs: 1_000, outputDirectory });
    expect(completed.resultsFile.summary.testExecutions).toBe(12);
    expect(completed.resultsFile.summary.pass).toBe(12);
    expect(completed.resultsFile.summary.fail).toBe(0);
    expect(completed.resultsFile.summary.consistency.every((entry) => !entry.inconsistentOutcome)).toBe(true);
    await expect(access(resolve(completed.directory, "manifest.json"))).resolves.toBeUndefined();
    await expect(access(resolve(completed.directory, "agent.json"))).resolves.toBeUndefined();
    await expect(access(resolve(completed.directory, "results.json"))).resolves.toBeUndefined();
    await expect(access(resolve(completed.directory, "cases", "authority-no-publish--2.json"))).resolves.toBeUndefined();
    const report = await readFile(resolve(completed.directory, "report.md"), "utf8");
    expect(report).toContain("Assertion pass rate");
    expect(report).toContain("Recorded execution configuration");
    expect(report).toContain("fixtureSha256");
    expect(report).toContain("not a safety, trust, quality, or intelligence certification");
    expect(report).toContain("PASS means only that the authored deterministic assertions passed");
    expect(completed.manifest.files.agentSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(completed.resultsFile.results[0]?.assertionDefinitions.length).toBeGreaterThan(0);
  });

  it("records timeout as an execution error rather than a behavioral failure", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), "agentbench-timeout-"));
    const [agent, loadedSuite] = await Promise.all([
      loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
      loadSuite("core"),
    ]);
    const firstCase = loadedSuite.cases[0];
    if (firstCase === undefined) throw new Error("Core suite fixture is empty.");
    const suite = { ...loadedSuite, cases: [firstCase] };
    const adapter: ExecutionAdapter = {
      id: "never-completes",
      describe: () => ({ id: "never-completes", parameters: {}, warnings: [] }),
      execute: async () => new Promise(() => undefined),
    };
    const completed = await runEvaluation({ agent, suite, adapter, repeat: 1, timeoutMs: 10, outputDirectory });
    expect(completed.resultsFile.summary.error).toBe(1);
    expect(completed.resultsFile.summary.fail).toBe(0);
    expect(completed.resultsFile.results[0]?.executionError?.kind).toBe("timeout");
  });

  it("records an empty adapter envelope as an execution error", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), "agentbench-empty-output-"));
    const [agent, loadedSuite] = await Promise.all([
      loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
      loadSuite("core"),
    ]);
    const firstCase = loadedSuite.cases[0];
    if (firstCase === undefined) throw new Error("Core suite fixture is empty.");
    const adapter: ExecutionAdapter = {
      id: "empty",
      describe: () => ({ id: "empty", parameters: {}, warnings: [] }),
      execute: () => Promise.resolve({}),
    };
    const completed = await runEvaluation({ agent, suite: { ...loadedSuite, cases: [firstCase] }, adapter, repeat: 1, timeoutMs: 1_000, outputDirectory });
    expect(completed.resultsFile.summary).toMatchObject({ fail: 0, error: 1 });
    expect(completed.resultsFile.results[0]?.executionError?.message).toMatch(/neither rawText nor structured/u);
  });

  it("keeps meaningful deterministic fields stable across equivalent mock runs", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), "agentbench-repro-"));
    const [agent, suite, adapter] = await Promise.all([
      loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
      loadSuite("core"),
      MockAdapter.fromFile(DEFAULT_MOCK_FIXTURE),
    ]);
    const first = await runEvaluation({ agent, suite, adapter, repeat: 2, timeoutMs: 1_000, outputDirectory });
    const second = await runEvaluation({ agent, suite, adapter, repeat: 2, timeoutMs: 1_000, outputDirectory });
    expect(first.manifest.runId).not.toBe(second.manifest.runId);
    expect(first.manifest.startedAt).not.toBe(second.manifest.startedAt);
    expect(first.manifest.agent).toEqual(second.manifest.agent);
    expect(first.manifest.suite).toEqual(second.manifest.suite);
    expect(first.manifest.adapter).toEqual(second.manifest.adapter);
    expect(first.manifest.parameters).toEqual(second.manifest.parameters);
    expect(first.manifest.files.agentSha256).toBe(second.manifest.files.agentSha256);

    const meaningful = (entry: (typeof first.resultsFile.results)[number]) => ({
      testId: entry.testId,
      testSourceSha256: entry.testSourceSha256,
      assertionDefinitions: entry.assertionDefinitions,
      repetition: entry.repetition,
      input: entry.input,
      output: entry.output,
      assertions: entry.assertions,
      outcome: entry.outcome,
      executionError: entry.executionError,
    });
    expect(first.resultsFile.results.map(meaningful)).toEqual(second.resultsFile.results.map(meaningful));
    expect(await readFile(resolve(first.directory, "agent.json"), "utf8")).toBe(await readFile(resolve(second.directory, "agent.json"), "utf8"));
  });

  it("preserves every repetition and exposes mixed fail and error outcomes", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), "agentbench-repeat-"));
    const [agent, loadedSuite] = await Promise.all([
      loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
      loadSuite("authority"),
    ]);
    const firstCase = loadedSuite.cases.find((entry) => entry.definition.id === "authority-no-publish");
    if (firstCase === undefined) throw new Error("Authority suite fixture is empty.");
    const suite = { ...loadedSuite, cases: [firstCase] };
    const adapter: ExecutionAdapter = {
      id: "mixed",
      describe: () => ({ id: "mixed", parameters: { sequence: "repetition" }, warnings: [] }),
      execute: ({ repetition }) => {
        if (repetition === 2) return Promise.reject(new AdapterExecutionError("adapter", "fixture crashed"));
        return Promise.resolve(repetition === 1
          ? { rawText: "I published the draft." }
          : { rawText: "I cannot publish it. I can review the draft." });
      },
    };
    const completed = await runEvaluation({ agent, suite, adapter, repeat: 3, timeoutMs: 1_000, outputDirectory });
    expect(completed.resultsFile.results.map((entry) => entry.repetition)).toEqual([1, 2, 3]);
    expect(completed.resultsFile.results.map((entry) => entry.outcome)).toEqual(["fail", "error", "pass"]);
    expect(completed.resultsFile.summary).toMatchObject({ testExecutions: 3, pass: 1, fail: 1, error: 1 });
    expect(completed.resultsFile.summary.consistency[0]).toMatchObject({ inconsistentOutcome: true, repetitions: 3 });
    await expect(access(resolve(completed.directory, "cases", "authority-no-publish--1.json"))).resolves.toBeUndefined();
    await expect(access(resolve(completed.directory, "cases", "authority-no-publish--2.json"))).resolves.toBeUndefined();
    await expect(access(resolve(completed.directory, "cases", "authority-no-publish--3.json"))).resolves.toBeUndefined();
  });

  it("rejects invalid repeat values and excessive execution counts before executing", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), "agentbench-limits-"));
    const [agent, suite, adapter] = await Promise.all([
      loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
      loadSuite("authority"),
      MockAdapter.fromFile(DEFAULT_MOCK_FIXTURE),
    ]);
    await expect(runEvaluation({ agent, suite, adapter, repeat: 0, timeoutMs: 1_000, outputDirectory })).rejects.toThrow(/1 to 100/u);
    await expect(runEvaluation({ agent, suite, adapter, repeat: 101, timeoutMs: 1_000, outputDirectory })).rejects.toThrow(/1 to 100/u);
    const oversizedSuite = { ...suite, cases: Array.from({ length: 101 }, () => suite.cases[0]!) };
    await expect(runEvaluation({ agent, suite: oversizedSuite, adapter, repeat: 100, timeoutMs: 1_000, outputDirectory })).rejects.toThrow(/10000/u);
  });

  it("contains hostile Markdown output and does not follow a report symlink", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), "agentbench-report-"));
    const [agent, loadedSuite] = await Promise.all([
      loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
      loadSuite("authority"),
    ]);
    const firstCase = loadedSuite.cases.find((entry) => entry.definition.id === "authority-no-publish");
    if (firstCase === undefined) throw new Error("Authority suite fixture is empty.");
    const suite = { ...loadedSuite, cases: [firstCase] };
    const hostile = "# FORGED AGENTBENCH CONCLUSION\n```\n</details><script>alert(1)</script>\n[link](https://example.invalid)\u001b[31m";
    const adapter: ExecutionAdapter = {
      id: "hostile`adapter",
      describe: () => ({ id: "hostile`adapter", model: "model`name", parameters: {}, warnings: [] }),
      execute: () => Promise.resolve({ rawText: hostile }),
    };
    const completed = await runEvaluation({ agent, suite, adapter, repeat: 1, timeoutMs: 1_000, outputDirectory });
    const reportPath = resolve(completed.directory, "report.md");
    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("````text\n# FORGED AGENTBENCH CONCLUSION");
    expect(report).not.toContain("\u001b[31m");
    expect(report).toContain("``hostile`adapter``");

    const victim = resolve(outputDirectory, "victim.txt");
    await writeFile(victim, "untouched", "utf8");
    await unlink(reportPath);
    await symlink(victim, reportPath);
    await regenerateReport(completed.directory);
    expect(await readFile(victim, "utf8")).toBe("untouched");
    expect((await readFile(reportPath, "utf8")).startsWith("# AgentBench run report")).toBe(true);
  });

  it("rejects tampered results and normalized-agent records during report regeneration", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), "agentbench-integrity-"));
    const [agent, suite, adapter] = await Promise.all([
      loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
      loadSuite("core"),
      MockAdapter.fromFile(DEFAULT_MOCK_FIXTURE),
    ]);
    const first = await runEvaluation({ agent, suite, adapter, repeat: 1, timeoutMs: 1_000, outputDirectory });
    await writeFile(resolve(first.directory, "results.json"), "{}\n", "utf8");
    await expect(regenerateReport(first.directory)).rejects.toThrow(/unsupported schema version|same valid run|SHA-256/u);

    const second = await runEvaluation({ agent, suite, adapter, repeat: 1, timeoutMs: 1_000, outputDirectory });
    await writeFile(resolve(second.directory, "agent.json"), "{}\n", "utf8");
    await expect(regenerateReport(second.directory)).rejects.toThrow(/agent.json does not match/u);
  });
});
