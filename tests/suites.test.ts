import { describe, expect, it } from "vitest";
import { MockAdapter } from "../src/adapters/mock.js";
import { loadAgent } from "../src/agents/load-agent.js";
import { runEvaluation } from "../src/core/run.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PACKAGE_ROOT } from "../src/paths.js";
import { listBuiltinSuiteIds, loadSuite } from "../src/suites/load-suite.js";

describe("built-in suites", () => {
  it("loads every suite with stable unique case IDs", async () => {
    const suiteIds = await listBuiltinSuiteIds();
    expect(suiteIds).toEqual(["authority", "core", "evidence", "prompt-boundary"]);
    const suites = await Promise.all(suiteIds.map(loadSuite));
    const allCases = suites.flatMap((suite) => suite.cases);
    expect(allCases).toHaveLength(28);
    expect(new Set(allCases.map((entry) => entry.definition.id)).size).toBe(28);
    for (const suite of suites) {
      expect(suite.source.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(suite.cases.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("attacks every prompt-boundary case with an explicit contradictory fixture", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), "agentbench-adversarial-"));
    const [agent, suite, adapter] = await Promise.all([
      loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
      loadSuite("prompt-boundary"),
      MockAdapter.fromFile(resolve(PACKAGE_ROOT, "fixtures", "responses", "adversarial.yaml")),
    ]);
    const completed = await runEvaluation({ agent, suite, adapter, repeat: 1, timeoutMs: 1_000, outputDirectory });
    expect(completed.resultsFile.summary).toMatchObject({ testExecutions: 10, fail: 9, pass: 1, error: 0 });
    expect(completed.resultsFile.results.filter((entry) => entry.outcome === "fail").map((entry) => entry.testId).sort()).toEqual([
      "prompt-fake-administrator",
      "prompt-fake-system-message",
      "prompt-json-injection",
      "prompt-malicious-summary-content",
      "prompt-markdown-injection",
      "prompt-nested-instructions",
      "prompt-plain-text-injection",
      "prompt-quoted-injection",
      "prompt-xml-like-injection",
    ]);
    const disclosure = completed.resultsFile.results.find((entry) => entry.testId === "prompt-reveal-hidden-instructions");
    expect(disclosure?.outcome).toBe("pass");
    expect(disclosure?.warnings.join(" ")).toMatch(/cannot prove/u);
  });

  it("rejects contradictory authority and evidence-discipline fixture outputs", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), "agentbench-adversarial-evidence-"));
    const [agent, authority, evidence, adapter] = await Promise.all([
      loadAgent(resolve(PACKAGE_ROOT, "fixtures", "agents", "strict-reviewer.json")),
      loadSuite("authority"),
      loadSuite("evidence"),
      MockAdapter.fromFile(resolve(PACKAGE_ROOT, "fixtures", "responses", "adversarial.yaml")),
    ]);
    const authorityCases = authority.cases.filter((entry) => entry.definition.id === "authority-no-publish");
    const evidenceCases = evidence.cases.filter((entry) => ["evidence-absent-source-citation", "evidence-unrun-tests"].includes(entry.definition.id));
    const authorityRun = await runEvaluation({ agent, suite: { ...authority, cases: authorityCases }, adapter, repeat: 1, timeoutMs: 1_000, outputDirectory });
    const evidenceRun = await runEvaluation({ agent, suite: { ...evidence, cases: evidenceCases }, adapter, repeat: 1, timeoutMs: 1_000, outputDirectory });
    expect(authorityRun.resultsFile.summary).toMatchObject({ testExecutions: 1, pass: 0, fail: 1, error: 0 });
    expect(evidenceRun.resultsFile.summary).toMatchObject({ testExecutions: 2, pass: 0, fail: 2, error: 0 });
  });
});
