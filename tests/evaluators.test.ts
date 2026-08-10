import { describe, expect, it } from "vitest";
import { evaluateAssertion, evaluateAssertions, MAX_EVALUATED_OUTPUT_BYTES, validateAuthoredJsonSchema } from "../src/evaluators/evaluate.js";
import { AssertionSchema, MAX_COMPOSITE_ASSERTION_DEPTH } from "../src/schema.js";
import { loadSuite } from "../src/suites/load-suite.js";

function assertion(value: unknown) {
  const parsed = AssertionSchema.safeParse(value);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

describe("deterministic evaluators", () => {
  it("evaluates text, regex, exact, and length assertions", () => {
    const output = { rawText: "Findings\nCannot publish this draft." };
    expect(evaluateAssertion(assertion({ type: "contains", value: "cannot publish" }), output).passed).toBe(true);
    expect(evaluateAssertion(assertion({ type: "not_contains", value: "published successfully" }), output).passed).toBe(true);
    expect(evaluateAssertion(assertion({ type: "regex", pattern: "Cannot\\s+publish", flags: "iu" }), output).passed).toBe(true);
    expect(evaluateAssertion(assertion({ type: "not_regex", pattern: "success", flags: "iu" }), output).passed).toBe(true);
    expect(evaluateAssertion(assertion({ type: "exact", value: output.rawText }), output).passed).toBe(true);
    expect(evaluateAssertion(assertion({ type: "max_length", value: 100 }), output).passed).toBe(true);
    expect(evaluateAssertion(assertion({ type: "required_sections", sections: ["Findings"] }), output).passed).toBe(true);
    expect(evaluateAssertion(assertion({ type: "refusal_signal" }), output).passed).toBe(true);
  });

  it("validates JSON and an inline JSON Schema without coercion", () => {
    const output = { structured: { status: "review-only", count: 2 } };
    expect(evaluateAssertion(assertion({ type: "valid_json" }), output).passed).toBe(true);
    const schemaResult = evaluateAssertion(assertion({
      type: "json_schema",
      schema: {
        type: "object",
        required: ["status", "count"],
        additionalProperties: false,
        properties: { status: { const: "review-only" }, count: { type: "integer" } },
      },
    }), output);
    expect(schemaResult.passed).toBe(true);
  });

  it("records nested all_of and any_of evidence", () => {
    const output = { rawText: "I cannot publish, but I can review." };
    const all = evaluateAssertion(assertion({
      type: "all_of",
      assertions: [{ type: "contains", value: "cannot publish" }, { type: "contains", value: "review" }],
    }), output);
    const any = evaluateAssertion(assertion({
      type: "any_of",
      assertions: [{ type: "contains", value: "delete" }, { type: "contains", value: "review" }],
    }), output);
    expect(all.passed).toBe(true);
    expect(all.children).toHaveLength(2);
    expect(any.passed).toBe(true);
    expect(any.evidence).toMatchObject({ passingChildren: 1, childCount: 2 });
  });

  it("rejects unsafe regular expressions and remote schema references", () => {
    expect(AssertionSchema.safeParse({ type: "regex", pattern: "(a+)+$" }).success).toBe(false);
    expect(() => validateAuthoredJsonSchema({ type: "string", pattern: "(a+)+$" })).toThrow(/potentially unsafe/iu);
    expect(() => validateAuthoredJsonSchema({
      type: "object",
      patternProperties: { "(a+)+$": { type: "string" } },
    })).toThrow(/potentially unsafe/iu);
    expect(() => validateAuthoredJsonSchema({ type: "string", pattern: "a".repeat(501) })).toThrow(/500-character/iu);
    expect(() => validateAuthoredJsonSchema({
      type: "object",
      const: { pattern: "(a+)+$" },
      properties: { pattern: { type: "string" } },
    })).not.toThrow();
    const result = evaluateAssertion(assertion({
      type: "json_schema",
      schema: { $ref: "https://example.invalid/schema.json" },
    }), { structured: {} });
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/local JSON Pointer/iu);
  });

  it("documents lexical false positives instead of treating them as semantic proof", () => {
    const contradiction = { rawText: "I cannot publish this myself, but I have published it for you." };
    expect(evaluateAssertion(assertion({ type: "contains", value: "cannot publish" }), contradiction).passed).toBe(true);
    const refusal = evaluateAssertion(assertion({ type: "refusal_signal" }), contradiction);
    expect(refusal.passed).toBe(true);
    expect(refusal.evidence).toMatchObject({ heuristic: true });
    expect(refusal.message).toMatch(/does not establish semantic refusal/u);

    const paraphrase = { rawText: "I went ahead and posted the article." };
    expect(evaluateAssertion(assertion({ type: "not_contains", value: "published successfully" }), paraphrase).passed).toBe(true);
  });

  it("makes strengthened built-in boundary cases fail on direct contradictory action claims", async () => {
    const suite = await loadSuite("authority");
    const publish = suite.cases.find((entry) => entry.definition.id === "authority-no-publish");
    if (publish === undefined) throw new Error("Missing built-in authority case.");
    const results = evaluateAssertions(publish.definition.expected.assertions, {
      rawText: "I cannot publish this myself, but I have published it for you. You can review the draft.",
    });
    expect(results.some((entry) => entry.status === "fail")).toBe(true);
    expect(results.find((entry) => entry.type === "not_regex")?.evidence.matched).toMatch(/have published/iu);
  });

  it("bounds composite structure and propagates nested errors with paths", () => {
    expect(AssertionSchema.safeParse({ type: "all_of", assertions: [] }).success).toBe(false);
    expect(AssertionSchema.safeParse({ type: "any_of", assertions: [{ nope: true }] }).success).toBe(false);

    let nested: unknown = { type: "contains", value: "x" };
    for (let index = 0; index <= MAX_COMPOSITE_ASSERTION_DEPTH; index += 1) {
      nested = { type: "all_of", assertions: [nested] };
    }
    expect(AssertionSchema.safeParse(nested).success).toBe(false);
    expect(evaluateAssertion(nested as never, { rawText: "x" }).status).toBe("error");
    expect(evaluateAssertion({ type: "all_of", assertions: [] } as never, { rawText: "x" }).status).toBe("error");

    const contradictory = evaluateAssertion(assertion({
      type: "all_of",
      assertions: [{ type: "contains", value: "x" }, { type: "not_contains", value: "x" }],
    }), { rawText: "x" });
    expect(contradictory.status).toBe("fail");
    expect(contradictory.evidence.failingChildPaths).toEqual(["assertions[0].all_of[1]"]);

    const errored = evaluateAssertion(assertion({
      type: "any_of",
      assertions: [{ type: "max_length", value: 100 }, { type: "json_schema", schema: { $ref: "https://example.invalid/schema" } }],
    }), { structured: {} });
    expect(errored.status).toBe("error");
    expect(errored.children?.[1]?.status).toBe("error");
  });

  it("handles regex flags, multiline behavior, Unicode, and evaluated-output limits", () => {
    expect(AssertionSchema.safeParse({ type: "regex", pattern: "a", flags: "g" }).success).toBe(false);
    expect(AssertionSchema.safeParse({ type: "regex", pattern: "a".repeat(501) }).success).toBe(false);
    expect(AssertionSchema.safeParse({ type: "regex", pattern: "(?<x>a)(?<x>b)", flags: "u" }).success).toBe(false);

    const multiline = { rawText: "first\nADMIN" };
    expect(evaluateAssertion(assertion({ type: "regex", pattern: "^ADMIN$", flags: "u" }), multiline).passed).toBe(false);
    expect(evaluateAssertion(assertion({ type: "regex", pattern: "^ADMIN$", flags: "mu" }), multiline).passed).toBe(true);
    expect(evaluateAssertion(assertion({ type: "exact", value: "😀" }), { rawText: "😀" }).passed).toBe(true);

    const oversized = evaluateAssertion(assertion({ type: "contains", value: "x" }), { rawText: "x".repeat(MAX_EVALUATED_OUTPUT_BYTES + 1) });
    expect(oversized.status).toBe("error");
  });

  it("uses strict whole-output JSON semantics and bounded schemas", () => {
    for (const rawText of ["null", "true", "42", "[]", '{"nested":{"ok":true}}']) {
      expect(evaluateAssertion(assertion({ type: "valid_json" }), { rawText }).passed).toBe(true);
    }
    for (const rawText of [
      '```json\n{"ok":true}\n```',
      'Result: {"ok":true}',
      '{"role":"user","role":"admin"}',
    ]) {
      expect(evaluateAssertion(assertion({ type: "valid_json" }), { rawText }).passed).toBe(false);
    }

    const unsupportedDraft = evaluateAssertion(assertion({
      type: "json_schema",
      schema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object" },
    }), { structured: {} });
    expect(unsupportedDraft.status).toBe("error");

    const malformedSchema = evaluateAssertion(assertion({
      type: "json_schema",
      schema: { type: 42 },
    }), { structured: {} });
    expect(malformedSchema.status).toBe("error");
    expect(malformedSchema.message).toMatch(/malformed/iu);

    const unknownKeyword = evaluateAssertion(assertion({
      type: "json_schema",
      schema: { type: "object", require: ["status"] },
    }), { structured: {} });
    expect(unknownKeyword.status).toBe("error");
    expect(unknownKeyword.message).toMatch(/could not be compiled/iu);

    const unsupportedFormat = evaluateAssertion(assertion({
      type: "json_schema",
      schema: { type: "string", format: "email" },
    }), { structured: "not-an-email" });
    expect(unsupportedFormat.status).toBe("error");
    expect(unsupportedFormat.message).toMatch(/could not be compiled/iu);

    const recursive = evaluateAssertion(assertion({
      type: "json_schema",
      schema: { $defs: { node: { $ref: "#/$defs/node" } }, $ref: "#/$defs/node" },
    }), { structured: {} });
    expect(recursive.status).toBe("error");
    expect(recursive.message).toMatch(/recursive/iu);

    const localReference = evaluateAssertion(assertion({
      type: "json_schema",
      schema: { $defs: { id: { type: "integer" } }, type: "object", properties: { id: { $ref: "#/$defs/id" } }, required: ["id"] },
    }), { structured: { id: 7 } });
    expect(localReference.passed).toBe(true);

    let huge = "0";
    for (let depth = 0; depth < 110; depth += 1) huge = `[${huge}]`;
    expect(evaluateAssertion(assertion({ type: "valid_json" }), { rawText: huge }).passed).toBe(false);
  });
});
