#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import { MockAdapter } from "./adapters/mock.js";
import { loadAgent } from "./agents/load-agent.js";
import { runEvaluation } from "./core/run.js";
import { AgentBenchError } from "./errors.js";
import { EVALUATOR_TYPES } from "./evaluators/evaluate.js";
import { DEFAULT_MOCK_FIXTURE } from "./paths.js";
import { regenerateReport } from "./reporting/load-run.js";
import { sanitizeTerminal } from "./security.js";
import { listBuiltinSuiteIds, loadSuite, loadTestCase } from "./suites/load-suite.js";
import { AGENTBENCH_VERSION } from "./version.js";

interface OutputOption { json?: boolean }

function integerOption(value: string): number {
  if (!/^\d+$/u.test(value)) throw new InvalidArgumentError("Expected a positive integer.");
  return Number(value);
}

function print(value: unknown, json = false): void {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${sanitizeTerminal(String(value))}\n`);
}

function agentInspection(agent: Awaited<ReturnType<typeof loadAgent>>) {
  return {
    id: agent.id,
    name: agent.name ?? null,
    source: agent.source,
    instructionCharacters: [...agent.instructions].length,
    instructionBytes: Buffer.byteLength(agent.instructions),
    instructionPreview: agent.instructions.slice(0, 240),
    metadata: agent.metadata ?? null,
    warnings: agent.warnings,
  };
}

const program = new Command();
program
  .name("agentbench")
  .description("Reproducible behavioral evaluation for portable AI agents.")
  .version(AGENTBENCH_VERSION)
  .showHelpAfterError()
  .configureHelp({ sortSubcommands: true, sortOptions: true });

program
  .command("inspect")
  .description("Normalize and inspect an agent definition without executing it.")
  .argument("<agent>", "Path to a prompt, generic JSON agent, or supported Buzz snapshot")
  .option("--json", "Emit machine-readable JSON")
  .action(async (path: string, options: OutputOption) => {
    const inspection = agentInspection(await loadAgent(path));
    print(options.json ? inspection : [
      `Agent: ${inspection.name ?? inspection.id}`,
      `Format: ${(inspection.source as { type: string }).type}`,
      `Source bytes SHA-256: ${(inspection.source as { sha256: string }).sha256}`,
      `Normalized instructions SHA-256: ${(inspection.source as { normalizedInstructionsSha256: string }).normalizedInstructionsSha256}`,
      `Instructions: ${inspection.instructionCharacters} characters`,
      `Warnings: ${inspection.warnings.length}`,
    ].join("\n"), options.json);
  });

program
  .command("validate")
  .description("Validate an agent, suite directory, suite manifest, test case, or explicit mock fixture.")
  .argument("<target>")
  .option("--mock-fixture", "Interpret the target as a mock response fixture")
  .option("--json", "Emit machine-readable JSON")
  .action(async (target: string, options: OutputOption & { mockFixture?: boolean }) => {
    const path = resolve(target);
    const info = await stat(path).catch(() => undefined);
    if (options.mockFixture) {
      if (!info?.isFile()) throw new AgentBenchError("validation", `Mock fixture validation target was not found or is not a file: ${path}`);
      const descriptor = (await MockAdapter.fromFile(path)).describe();
      const id = String(descriptor.parameters.fixtureId);
      const sha256 = String(descriptor.parameters.fixtureSha256);
      print(options.json ? { valid: true, kind: "mock-fixture", id, sha256 } : `Valid mock fixture '${id}' (source-bytes SHA-256 ${sha256}).`, options.json);
      return;
    }
    if (info?.isDirectory()) {
      const suite = await loadSuite(path);
      print(options.json ? { valid: true, kind: "suite", id: suite.manifest.id, version: suite.manifest.version, cases: suite.cases.length } : `Valid suite '${suite.manifest.id}' ${suite.manifest.version}: ${suite.cases.length} cases.`, options.json);
      return;
    }
    if (!info?.isFile()) throw new AgentBenchError("validation", `Validation target was not found: ${path}`);
    if (/\.ya?ml$/iu.test(extname(path))) {
      if (basename(path) === "suite.yaml" || basename(path) === "suite.yml") {
        const suite = await loadSuite(dirname(path));
        print(options.json ? { valid: true, kind: "suite", id: suite.manifest.id, version: suite.manifest.version, cases: suite.cases.length } : `Valid suite '${suite.manifest.id}' ${suite.manifest.version}: ${suite.cases.length} cases.`, options.json);
      } else {
        const test = await loadTestCase(path);
        print(options.json ? { valid: true, kind: "test-case", id: test.definition.id, category: test.definition.category, sha256: test.source.sha256 } : `Valid test case '${test.definition.id}' (${test.definition.category}).`, options.json);
      }
      return;
    }
    const agent = await loadAgent(path);
    print(options.json ? { valid: true, kind: "agent", ...agentInspection(agent) } : `Valid ${agent.source.type} agent '${agent.id}' (source-bytes SHA-256 ${agent.source.sha256}; normalized-instructions SHA-256 ${agent.source.normalizedInstructionsSha256}).`, options.json);
  });

program
  .command("list")
  .description("List built-in suites, adapters, or assertion types.")
  .argument("[kind]", "suites, adapters, or assertions", "suites")
  .option("--json", "Emit machine-readable JSON")
  .action(async (kind: string, options: OutputOption) => {
    if (kind === "adapters") {
      const value = [{ id: "mock", network: false, deterministic: true }];
      print(options.json ? value : "mock — deterministic local fixture adapter", options.json);
      return;
    }
    if (kind === "assertions") {
      print(options.json ? EVALUATOR_TYPES : EVALUATOR_TYPES.join("\n"), options.json);
      return;
    }
    if (kind !== "suites") throw new AgentBenchError("usage", `Unknown list kind '${kind}'. Use suites, adapters, or assertions.`);
    const suites = [];
    for (const id of await listBuiltinSuiteIds()) {
      const suite = await loadSuite(id);
      suites.push({ id, version: suite.manifest.version, title: suite.manifest.title, cases: suite.cases.length });
    }
    print(options.json ? suites : suites.map((suite) => `${suite.id} ${suite.version} — ${suite.cases} cases — ${suite.title}`).join("\n"), options.json);
  });

program
  .command("run")
  .description("Execute a behavioral suite and write inspectable evidence files.")
  .requiredOption("--agent <path>", "Agent definition path")
  .requiredOption("--suite <path-or-id>", "Suite directory or built-in suite ID")
  .option("--adapter <id>", "Execution adapter", "mock")
  .addOption(new Option("--fixture <path>", "Mock response fixture").default(DEFAULT_MOCK_FIXTURE, "bundled fixtures/responses/default.yaml"))
  .option("--repeat <count>", "Number of repetitions", integerOption, 1)
  .option("--timeout <milliseconds>", "Per-test timeout", integerOption, 10_000)
  .option("--output <directory>", "Run output directory", "runs")
  .option("--fail-on-test-failure", "Exit 3 when one or more behavioral tests fail")
  .option("--json", "Emit machine-readable run summary")
  .action(async (options: {
    agent: string;
    suite: string;
    adapter: string;
    fixture: string;
    repeat: number;
    timeout: number;
    output: string;
    failOnTestFailure?: boolean;
    json?: boolean;
  }) => {
    if (options.adapter !== "mock") {
      throw new AgentBenchError("usage", `Adapter '${options.adapter}' is not installed. The MVP ships only the deterministic mock adapter.`);
    }
    const [agent, suite, adapter] = await Promise.all([
      loadAgent(options.agent),
      loadSuite(options.suite),
      MockAdapter.fromFile(options.fixture),
    ]);
    const completed = await runEvaluation({
      agent,
      suite,
      adapter,
      repeat: options.repeat,
      timeoutMs: options.timeout,
      outputDirectory: options.output,
    });
    const payload = { runId: completed.manifest.runId, directory: completed.directory, summary: completed.resultsFile.summary };
    print(options.json ? payload : [
      `Run written to ${completed.directory}`,
      `Behavioral case outcomes: ${completed.resultsFile.summary.pass} pass, ${completed.resultsFile.summary.fail} fail, ${completed.resultsFile.summary.error} error`,
      `Test pass rate: ${(completed.resultsFile.summary.testPassRate * 100).toFixed(1)}%`,
      `Assertion pass rate: ${(completed.resultsFile.summary.assertionPassRate * 100).toFixed(1)}%`,
      "PASS means the authored deterministic assertions passed for the recorded output; inspect the report and raw evidence.",
    ].join("\n"), options.json);
    if (completed.resultsFile.summary.error > 0) process.exitCode = 2;
    else if (options.failOnTestFailure && completed.resultsFile.summary.fail > 0) process.exitCode = 3;
  });

program
  .command("report")
  .description("Regenerate a Markdown report from an existing run directory.")
  .argument("<run-directory>")
  .option("--stdout", "Print the report instead of only its path")
  .option("--json", "Emit machine-readable metadata")
  .action(async (input: string, options: { stdout?: boolean; json?: boolean }) => {
    const report = await regenerateReport(input);
    if (options.json) print({ path: report.path, runId: report.manifest.runId, summary: report.resultsFile.summary }, true);
    else if (options.stdout) process.stdout.write(report.markdown);
    else print(`Report written to ${report.path}`);
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync();
  } catch (error) {
    const json = process.argv.includes("--json");
    const message = error instanceof Error ? error.message : String(error);
    const details = error instanceof AgentBenchError ? error.details : [];
    if (json) process.stderr.write(`${JSON.stringify({ error: { message, details } }, null, 2)}\n`);
    else {
      process.stderr.write(`AgentBench: ${sanitizeTerminal(message)}\n`);
      for (const detail of details) process.stderr.write(`  - ${sanitizeTerminal(detail)}\n`);
    }
    process.exitCode = error instanceof AgentBenchError && (error.kind === "usage" || error.kind === "validation") ? 1 : 2;
  }
}

await main();
