import type { AssertionResult, RunManifest, RunResultsFile, TestResult } from "../core/types.js";
import { fencedCode, inlineCode, markdownText } from "../security.js";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function outputEvidence(result: TestResult): string {
  if (result.output === undefined) return "_No output was recorded._";
  const blocks: string[] = [];
  if (result.output.rawText !== undefined) blocks.push(fencedCode(result.output.rawText));
  if (result.output.structured !== undefined) blocks.push(fencedCode(JSON.stringify(result.output.structured, null, 2), "json"));
  return blocks.join("\n\n");
}

function assertionLines(assertions: AssertionResult[], depth = 0): string[] {
  const lines: string[] = [];
  for (const assertion of assertions) {
    const indentation = "  ".repeat(depth);
    lines.push(`${indentation}- ${assertion.status === "pass" ? "PASS" : assertion.status === "fail" ? "FAIL" : "ERROR"} ${inlineCode(assertion.path)} (${inlineCode(assertion.type)}): ${markdownText(assertion.message)}`);
    if (assertion.status !== "pass" && Object.keys(assertion.evidence).length > 0) {
      lines.push(`${indentation}  - Evidence: ${markdownText(JSON.stringify(assertion.evidence))}`);
    }
    if (assertion.children !== undefined) lines.push(...assertionLines(assertion.children, depth + 1));
  }
  return lines;
}

export function renderMarkdownReport(manifest: RunManifest, resultsFile: RunResultsFile): string {
  const { summary } = resultsFile;
  const lines = [
    "# AgentBench run report",
    "",
    "> AgentBench evaluates defined behavior under the recorded conditions. This report is not a safety, trust, quality, or intelligence certification.",
    "> PASS means only that the authored deterministic assertions passed for the recorded output. Inspect the raw evidence before drawing conclusions.",
    "",
    "## Summary",
    "",
    `- Run: ${inlineCode(manifest.runId)}`,
    `- Agent: ${markdownText(manifest.agent.name ?? manifest.agent.id)} (${inlineCode(manifest.agent.sourceType)}, source SHA-256 ${inlineCode(manifest.agent.sha256)}, normalized-instructions SHA-256 ${inlineCode(manifest.agent.normalizedInstructionsSha256)})`,
    `- Suite: ${markdownText(manifest.suite.id)} ${inlineCode(manifest.suite.version)} (${manifest.suite.testCount} cases)`,
    `- Adapter: ${inlineCode(manifest.adapter.id)}${manifest.adapter.model === undefined ? "" : ` / model ${inlineCode(manifest.adapter.model)}`}`,
    `- Repetitions: ${manifest.parameters.repeat}`,
    `- Test executions: ${summary.testExecutions} — ${summary.pass} pass, ${summary.fail} fail, ${summary.error} error, ${summary.skipped} skipped`,
    `- Test pass rate: ${percent(summary.testPassRate)}`,
    `- Assertion pass rate: ${percent(summary.assertionPassRate)} (${summary.assertionsPassed} pass, ${summary.assertionsFailed} fail, ${summary.assertionErrors} error)`,
    `- Started: ${manifest.startedAt}`,
    `- Completed: ${manifest.completedAt}`,
    "",
    "## Category outcomes",
    "",
    "| Category | Pass | Fail | Error | Skipped |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...summary.categories.map((entry) => `| ${markdownText(entry.category)} | ${entry.pass} | ${entry.fail} | ${entry.error} | ${entry.skipped} |`),
    "",
    "## Executions",
    "",
    "| Test | Repetition | Category | Severity | Outcome | Duration |",
    "| --- | ---: | --- | --- | --- | ---: |",
    ...resultsFile.results.map((entry) => `| ${markdownText(entry.testId)} | ${entry.repetition} | ${markdownText(entry.category)} | ${entry.severity} | **${entry.outcome.toUpperCase()}** | ${entry.durationMs} ms |`),
    "",
  ];

  const inconsistent = summary.consistency.filter((entry) => entry.inconsistentOutcome || entry.outputVaried);
  lines.push("## Repetition consistency", "");
  if (manifest.parameters.repeat < 2) {
    lines.push("No repeated execution was requested.", "");
  } else if (inconsistent.length === 0) {
    lines.push("No outcome or output-hash variance was observed across the recorded repetitions.", "");
  } else {
    lines.push("| Test | Pass frequency | Outcome varied | Distinct output hashes |", "| --- | ---: | --- | ---: |");
    lines.push(...inconsistent.map((entry) => `| ${markdownText(entry.testId)} | ${entry.outcomes.pass}/${entry.repetitions} | ${entry.inconsistentOutcome ? "yes" : "no"} | ${entry.distinctOutputHashes} |`), "");
  }

  const material = resultsFile.results.filter((entry) => entry.outcome !== "pass");
  lines.push("## Failures and errors", "");
  if (material.length === 0) lines.push("No failed or errored executions.", "");
  for (const entry of material) {
    lines.push(`### ${markdownText(entry.testId)} — repetition ${entry.repetition}`, "");
    lines.push(`Outcome: **${entry.outcome.toUpperCase()}**`, "");
    if (entry.executionError !== undefined) {
      lines.push(`Execution error (${inlineCode(entry.executionError.kind)}): ${markdownText(entry.executionError.message)}`, "");
    }
    if (entry.assertions.length > 0) lines.push(...assertionLines(entry.assertions), "");
    lines.push("Observed output:", "", outputEvidence(entry), "");
    if (entry.warnings.length > 0) lines.push("Warnings:", "", ...entry.warnings.map((warning) => `- ${markdownText(warning)}`), "");
  }

  const warnings = [...new Set([...manifest.warnings, ...manifest.adapter.warnings])];
  lines.push("## Recorded execution configuration", "");
  lines.push(`- Per-test timeout: ${manifest.parameters.timeoutMs} ms`);
  lines.push(`- Resource limits: ${inlineCode(JSON.stringify(manifest.parameters.resourceLimits))}`);
  lines.push("", "Adapter descriptor:", "", fencedCode(JSON.stringify(manifest.adapter, null, 2), "json"), "");
  lines.push("## Runtime and warnings", "");
  lines.push(`- Node: ${inlineCode(manifest.environment.node)} on ${inlineCode(`${manifest.environment.platform}-${manifest.environment.arch}`)}`);
  if (manifest.agentbench.gitCommit !== undefined) lines.push(`- AgentBench source commit: ${inlineCode(manifest.agentbench.gitCommit)}`);
  lines.push(`- Suite manifest raw-byte SHA-256: ${inlineCode(manifest.suite.manifestSha256)}`);
  lines.push(`- Normalized agent file raw-byte SHA-256: ${inlineCode(manifest.files.agentSha256)}`);
  lines.push(`- Results raw-byte SHA-256: ${inlineCode(manifest.files.resultsSha256)}`);
  for (const warning of warnings) lines.push(`- ${markdownText(warning)}`);
  lines.push("", "The exact normalized instructions are preserved in `agent.json`. Every raw output and assertion record is preserved in `results.json`; `cases/` contains derived per-execution copies.", "");
  return `${lines.join("\n")}\n`;
}
