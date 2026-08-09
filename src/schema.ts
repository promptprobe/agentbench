import safeRegex from "safe-regex2";
import { z } from "zod";

export const BEHAVIOR_CATEGORIES = [
  "instruction-following",
  "scope-boundary",
  "authority-boundary",
  "missing-context",
  "evidence-discipline",
  "prompt-injection",
  "uncertainty",
  "output-contract",
  "consistency",
] as const;

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const MESSAGE_ROLES = ["user", "assistant", "tool"] as const;

const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use lowercase letters, numbers, dots, underscores, or hyphens.");

const DescriptionSchema = z.string().min(1).max(4_000);
const AssertionDescriptionSchema = z.string().min(1).max(500).optional();

export type Assertion =
  | { type: "contains"; value: string; case_sensitive: boolean; description?: string | undefined }
  | { type: "not_contains"; value: string; case_sensitive: boolean; description?: string | undefined }
  | { type: "regex"; pattern: string; flags: string; description?: string | undefined }
  | { type: "not_regex"; pattern: string; flags: string; description?: string | undefined }
  | { type: "exact"; value: string; trim: boolean; case_sensitive: boolean; description?: string | undefined }
  | { type: "valid_json"; description?: string | undefined }
  | { type: "json_schema"; schema: Record<string, unknown>; description?: string | undefined }
  | { type: "max_length"; value: number; unit: "characters" | "bytes"; description?: string | undefined }
  | { type: "required_sections"; sections: string[]; case_sensitive: boolean; description?: string | undefined }
  | { type: "refusal_signal"; signals: string[]; description?: string | undefined }
  | { type: "all_of"; assertions: Assertion[]; description?: string | undefined }
  | { type: "any_of"; assertions: Assertion[]; description?: string | undefined };

const StringAssertionValue = z.string().min(1).max(16_384);
const RegexFlagsSchema = z
  .string()
  .max(5)
  .regex(/^(?!.*(.).*\1)[imsu]*$/, "Only unique i, m, s, and u flags are supported.");
const RegexPatternSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((pattern) => safeRegex(pattern), "Pattern is potentially unsafe.");

function regexAssertionSchema(type: "regex" | "not_regex") {
  return z
    .object({
      type: z.literal(type),
      pattern: RegexPatternSchema,
      flags: RegexFlagsSchema.default("u"),
      description: AssertionDescriptionSchema,
    })
    .strict()
    .superRefine((value, context) => {
      try {
        const expression = new RegExp(value.pattern, value.flags);
        if (!safeRegex(expression)) context.addIssue({ code: "custom", path: ["pattern"], message: "Pattern is potentially unsafe with these flags." });
      } catch (error) {
        context.addIssue({
          code: "custom",
          path: ["pattern"],
          message: `Pattern and flags do not form a valid JavaScript regular expression: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
}

const LeafAssertionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("contains"),
      value: StringAssertionValue,
      case_sensitive: z.boolean().default(false),
      description: AssertionDescriptionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("not_contains"),
      value: StringAssertionValue,
      case_sensitive: z.boolean().default(false),
      description: AssertionDescriptionSchema,
    })
    .strict(),
  regexAssertionSchema("regex"),
  regexAssertionSchema("not_regex"),
  z
    .object({
      type: z.literal("exact"),
      value: z.string().max(262_144),
      trim: z.boolean().default(true),
      case_sensitive: z.boolean().default(true),
      description: AssertionDescriptionSchema,
    })
    .strict(),
  z.object({ type: z.literal("valid_json"), description: AssertionDescriptionSchema }).strict(),
  z
    .object({
      type: z.literal("json_schema"),
      schema: z.record(z.string(), z.unknown()),
      description: AssertionDescriptionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("max_length"),
      value: z.number().int().min(0).max(1_048_576),
      unit: z.enum(["characters", "bytes"]).default("characters"),
      description: AssertionDescriptionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("required_sections"),
      sections: z.array(z.string().min(1).max(200)).min(1).max(30),
      case_sensitive: z.boolean().default(false),
      description: AssertionDescriptionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("refusal_signal"),
      signals: z.array(z.string().min(1).max(200)).max(20).default([]),
      description: AssertionDescriptionSchema,
    })
    .strict(),
]);

export const MAX_COMPOSITE_ASSERTION_DEPTH = 4;
const Utf8InputStringSchema = z
  .string()
  .min(1)
  .max(262_144)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 262_144, "Must be at most 262144 UTF-8 bytes.");
const Utf8ArtifactStringSchema = z
  .string()
  .max(262_144)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 262_144, "Must be at most 262144 UTF-8 bytes.");

function boundedAssertionSchema(depthRemaining: number): z.ZodType<Assertion> {
  if (depthRemaining === 0) return LeafAssertionSchema;
  const child = boundedAssertionSchema(depthRemaining - 1);
  return z.union([
    LeafAssertionSchema,
    z
      .object({
        type: z.literal("all_of"),
        assertions: z.array(child).min(1).max(20),
        description: AssertionDescriptionSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("any_of"),
        assertions: z.array(child).min(1).max(20),
        description: AssertionDescriptionSchema,
      })
      .strict(),
  ]);
}

export const AssertionSchema = boundedAssertionSchema(MAX_COMPOSITE_ASSERTION_DEPTH);

export const AgentMessageSchema = z
  .object({
    role: z.enum(MESSAGE_ROLES),
    content: Utf8InputStringSchema,
    name: z.string().min(1).max(120).optional(),
  })
  .strict();

export const ContextArtifactSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1).max(240).optional(),
    media_type: z.enum(["text/plain", "text/markdown", "application/json"]),
    content: Utf8ArtifactStringSchema,
    trust: z.literal("untrusted").default("untrusted"),
  })
  .strict();

export const TestCaseSchema = z
  .object({
    schema_version: z.literal("1"),
    id: IdentifierSchema,
    title: z.string().min(1).max(240),
    category: z.enum(BEHAVIOR_CATEGORIES),
    description: DescriptionSchema,
    input: z
      .object({
        messages: z.array(AgentMessageSchema).min(1).max(50),
        context: z
          .object({
            artifacts: z.array(ContextArtifactSchema).min(1).max(20),
          })
          .strict()
          .optional(),
      })
      .strict(),
    expected: z
      .object({
        assertions: z.array(AssertionSchema).min(1).max(50),
      })
      .strict(),
    severity: z.enum(SEVERITIES).default("medium"),
    tags: z.array(IdentifierSchema).max(30).default([]),
    rationale: z.string().min(1).max(4_000).optional(),
    expected_limitations: z.array(z.string().min(1).max(1_000)).max(10).default([]),
  })
  .strict();

const RelativeCasePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !value.startsWith("/") && !value.startsWith("\\") && !value.split(/[\\/]/u).includes(".."), {
    message: "Case paths must be relative and cannot traverse parent directories.",
  })
  .refine((value) => /\.(?:yaml|yml)$/iu.test(value), "Case paths must end in .yaml or .yml.");

export const SuiteManifestSchema = z
  .object({
    schema_version: z.literal("1"),
    id: IdentifierSchema,
    version: z.string().min(1).max(80).regex(/^[0-9A-Za-z][0-9A-Za-z._+-]*$/),
    title: z.string().min(1).max(240),
    description: DescriptionSchema,
    cases: z.array(RelativeCasePathSchema).min(1).max(500),
    tags: z.array(IdentifierSchema).max(30).default([]),
  })
  .strict()
  .superRefine((suite, context) => {
    const duplicates = suite.cases.filter((value, index) => suite.cases.indexOf(value) !== index);
    if (duplicates.length > 0) {
      context.addIssue({ code: "custom", path: ["cases"], message: `Duplicate case paths: ${[...new Set(duplicates)].join(", ")}` });
    }
  });

export const GenericAgentSchema = z
  .object({
    schema_version: z.literal("1"),
    id: IdentifierSchema,
    name: z.string().min(1).max(240).optional(),
    instructions: z.string().min(1).max(262_144),
    scope: z
      .object({
        allowed_actions: z.array(z.string().min(1).max(240)).max(100).default([]),
        prohibited_actions: z.array(z.string().min(1).max(240)).max(100).default([]),
      })
      .strict()
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const BuzzAgentSnapshotSchema = z
  .object({
    format: z.literal("buzz-agent-snapshot"),
    version: z.literal(1),
    definition: z
      .object({
        name: z.string().min(1).max(120),
        sourceIsBuiltIn: z.boolean().optional(),
        systemPrompt: z.string().min(1).max(262_144),
        runtime: z.string().max(120).nullable().optional(),
        model: z.string().max(160).nullable().optional(),
        provider: z.string().max(120).nullable().optional(),
        parallelism: z.number().int().min(1).max(64).nullable().optional(),
        respondTo: z.string().max(80).nullable().optional(),
        respondToAllowlist: z.array(z.string().min(1).max(128)).max(128).optional(),
        namePool: z.array(z.string().min(1).max(120)).max(64).optional(),
        idleTimeoutSeconds: z.number().int().min(1).max(31_536_000).nullable().optional(),
        maxTurnDurationSeconds: z.number().int().min(1).max(86_400).nullable().optional(),
      })
      .strict(),
    profile: z
      .object({
        displayName: z.string().min(1).max(120),
        about: z.string().max(4_000).nullable().optional(),
        avatarDataUrl: z.string().max(3 * 1024 * 1024).nullable().optional(),
        avatarUrl: z.string().max(4_000).nullable().optional(),
      })
      .strict(),
    memory: z
      .object({
        level: z.literal("none"),
        entries: z.array(z.unknown()).max(0).optional(),
      })
      .strict(),
  })
  .strict();

const MockOutputSchema = z
  .object({
    content: z.string().max(1_048_576).optional(),
    structured: z.unknown().optional(),
  })
  .strict()
  .refine((value) => value.content !== undefined || value.structured !== undefined, "Mock output needs content or structured data.");

export const MockResponseSchema = z
  .object({
    content: z.string().max(1_048_576).optional(),
    structured: z.unknown().optional(),
    sequence: z.array(MockOutputSchema).min(1).max(100).optional(),
    delay_ms: z.number().int().min(0).max(60_000).default(0),
    error: z
      .object({
        kind: z.enum(["transport", "fixture"]),
        message: z.string().min(1).max(1_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasOutput = value.content !== undefined || value.structured !== undefined || value.sequence !== undefined;
    if (hasOutput === (value.error !== undefined)) {
      context.addIssue({ code: "custom", message: "Define either output fields or error, but not both." });
    }
  });

export const MockFixtureSchema = z
  .object({
    schema_version: z.literal("1"),
    id: IdentifierSchema,
    description: z.string().min(1).max(2_000).optional(),
    responses: z.record(IdentifierSchema, MockResponseSchema).default({}),
    input_patterns: z
      .array(
        z
          .object({
            contains: z.string().min(1).max(2_000),
            case_sensitive: z.boolean().default(false),
            response: MockResponseSchema,
          })
          .strict(),
      )
      .max(200)
      .default([]),
    fallback: MockResponseSchema.optional(),
  })
  .strict()
  .superRefine((fixture, context) => {
    const seen = new Set<string>();
    fixture.input_patterns.forEach((pattern, index) => {
      const comparable = pattern.case_sensitive ? pattern.contains : pattern.contains.toLocaleLowerCase("en-US");
      const key = `${pattern.case_sensitive ? "sensitive" : "insensitive"}\u0000${comparable}`;
      if (seen.has(key)) {
        context.addIssue({ code: "custom", path: ["input_patterns", index, "contains"], message: "Duplicate literal input pattern." });
      }
      seen.add(key);
    });
  });

export type TestCase = z.infer<typeof TestCaseSchema>;
export type SuiteManifest = z.infer<typeof SuiteManifestSchema>;
export type GenericAgent = z.infer<typeof GenericAgentSchema>;
export type BuzzAgentSnapshot = z.infer<typeof BuzzAgentSnapshotSchema>;
export type MockFixture = z.infer<typeof MockFixtureSchema>;
export type MockResponse = z.infer<typeof MockResponseSchema>;
