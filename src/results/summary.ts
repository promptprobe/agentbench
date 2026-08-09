import type { ConsistencySummary, RunSummary, TestOutcome, TestResult } from "../core/types.js";

const OUTCOMES: TestOutcome[] = ["pass", "fail", "error", "skipped"];

export function summarizeResults(results: TestResult[], uniqueTests: number, repetitions: number): RunSummary {
  const outcomeCount = (outcome: TestOutcome): number => results.filter((result) => result.outcome === outcome).length;
  const assertions = results.flatMap((entry) => entry.assertions);
  const categories = [...new Set(results.map((entry) => entry.category))]
    .sort()
    .map((category) => ({
      category,
      pass: results.filter((entry) => entry.category === category && entry.outcome === "pass").length,
      fail: results.filter((entry) => entry.category === category && entry.outcome === "fail").length,
      error: results.filter((entry) => entry.category === category && entry.outcome === "error").length,
      skipped: results.filter((entry) => entry.category === category && entry.outcome === "skipped").length,
    }));

  const consistency: ConsistencySummary[] = [...new Set(results.map((entry) => entry.testId))].sort().map((testId) => {
    const matching = results.filter((entry) => entry.testId === testId);
    const outcomes = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, matching.filter((entry) => entry.outcome === outcome).length])) as Record<TestOutcome, number>;
    const outputHashes = new Set(matching.map((entry) => entry.output?.sha256).filter((value): value is string => value !== undefined));
    const observedOutcomes = OUTCOMES.filter((outcome) => outcomes[outcome] > 0);
    return {
      testId,
      repetitions: matching.length,
      passFrequency: matching.length === 0 ? 0 : outcomes.pass / matching.length,
      outcomes,
      inconsistentOutcome: observedOutcomes.length > 1,
      distinctOutputHashes: outputHashes.size,
      outputVaried: outputHashes.size > 1,
    };
  });

  const assertionPasses = assertions.filter((entry) => entry.status === "pass").length;
  const assertionFailures = assertions.filter((entry) => entry.status === "fail").length;
  const assertionErrors = assertions.filter((entry) => entry.status === "error").length;
  const assertionTotal = assertions.length;

  return {
    testExecutions: results.length,
    uniqueTests,
    repetitions,
    pass: outcomeCount("pass"),
    fail: outcomeCount("fail"),
    error: outcomeCount("error"),
    skipped: outcomeCount("skipped"),
    assertionsPassed: assertionPasses,
    assertionsFailed: assertionFailures,
    assertionErrors,
    testPassRate: results.length === 0 ? 0 : outcomeCount("pass") / results.length,
    assertionPassRate: assertionTotal === 0 ? 0 : assertionPasses / assertionTotal,
    categories,
    consistency,
  };
}
