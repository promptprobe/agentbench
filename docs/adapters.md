# Execution adapters

An adapter sends normalized instructions and a schema-validated case to one runtime. It does not judge the result.

```ts
interface ExecutionAdapter {
  readonly id: string
  describe(): AdapterDescriptor
  execute(input: {
    agent: NormalizedAgent
    test: TestCase
    repetition: number
    signal: AbortSignal
  }): Promise<{
    rawText?: string
    structured?: unknown
  }>
}
```

`describe()` must identify adapter version, runtime/model where applicable, material non-secret parameters, and warnings. The runner enforces an outer per-test timeout and output size/depth limits. Adapters should also honor the supplied abort signal.

## Mock adapter

The built-in `mock` adapter is deterministic, local, and required by CI. A fixture is strict YAML:

```yaml
schema_version: "1"
id: example
responses:
  authority-no-publish:
    content: I cannot publish, but I can review the draft.
  repeated-case:
    sequence:
      - content: first recorded output
      - content: second recorded output
input_patterns:
  - contains: AGENTBENCH_MOCK_JSON
    response:
      structured: {status: mock}
fallback:
  error:
    kind: fixture
    message: No authored response exists.
```

Lookup order is exact test ID, then the first matching literal substring pattern in authored order, then fallback. Matching is case-insensitive unless the pattern sets `case_sensitive: true`. A `sequence` selects the corresponding one-based repetition and reuses its final output after the sequence ends. Optional bounded `delay_ms` supports timeout tests. Fixture error responses are recorded as adapter or transport errors, never behavioral failures. A missing exact/pattern/fallback response is an adapter error; it cannot silently become an empty output or passing case.

Fixtures are strict UTF-8 YAML. Duplicate mapping keys, semantically duplicate literal input patterns, aliases, unknown fields, output-plus-error combinations, empty sequences, and responses with no output are invalid. A response ID can appear only once because duplicate YAML keys are rejected. Fixtures are limited to 5 MiB, 200 input patterns, 100 sequence entries, a 60-second fixture delay, and 1,048,576 characters per authored content field; the runner additionally enforces its UTF-8 output limits.

Mock fixtures do not derive output from agent instructions and cannot establish model behavior. The fixture's resolved path, ID, exact raw-byte SHA-256, and lookup rule are recorded in the run manifest.

## Future external adapter requirements

No external provider adapter ships in the MVP. A future implementation must:

- read credentials only from environment variables or an explicit host secret provider;
- never print, write to run files, or include credentials in adapter metadata;
- state clearly that agent instructions, messages, and context are transmitted externally;
- isolate provider-specific message conversion and parameters;
- record exact model/runtime identifier, sampling settings, endpoint class, timeout, and retry policy;
- retry only transient transport failures with a bounded policy;
- never retry a behavioral failure;
- distinguish provider refusal, transport failure, timeout, malformed output, and deterministic assertion failure;
- keep paid access optional and out of CI.

Suites may not download or select arbitrary adapters. Trusted host applications can construct an `ExecutionAdapter` through the library API, but doing so changes the trust and reproducibility boundary and should be documented in every run.
