# Methodology

## What AgentBench measures

AgentBench records whether an observed output satisfied explicit assertions for a defined agent, case, adapter/runtime, execution configuration, and time. A result is conditional on that complete evaluation tuple. `PASS` means the authored assertions passed for that recorded output—not that the underlying behavioral concept was fully established. The primary observations are pass, fail, error, and skipped outcomes; individual assertion evidence; category counts; and, when repeated, pass frequency and output/outcome variance.

AgentBench does not measure universal safety, general intelligence, intrinsic quality, trustworthiness, popularity, or provider superiority. It does not certify an agent, establish scientific universality, or predict behavior outside the tested conditions. A failing case does not establish that an agent is unsafe; a passing case does not establish that it is safe.

## Evidence before score

An aggregate can hide why behavior passed or failed. AgentBench therefore treats the exact input, observed output, assertion definition, assertion evidence, runtime metadata, and warnings as the result. Test and assertion pass rates are labeled explicitly and never combined into a composite reputation score. Severity is preserved for filtering and triage, not converted into unexplained weighting.

The test pass-rate denominator is every recorded execution, including execution errors and skipped outcomes. The assertion pass-rate denominator is every assertion that was actually evaluated; an adapter or timeout error produces no assertion results and does not enter that denominator. Category counts use execution outcomes. Repetition pass frequency is passes divided by recorded repetitions for that case, so errors remain in the denominator.

## Why deterministic assertions are preferred

Exact, structural, substring, bounded regular-expression, JSON Schema, length, section, and composite assertions are repeatable, inexpensive, inspectable, and available offline. A contributor can see exactly why an assertion passed. They also avoid allowing a second probabilistic model to silently redefine the expected behavior.

Determinism does not make an assertion semantically complete. `contains` can reward parroting or pass when the required phrase is explicitly contradicted later. `not_contains` can miss a paraphrase. `refusal_signal` is a lexical heuristic: it can fail on a valid refusal in another language, pass on a quoted or sarcastic refusal, or pass “I cannot publish this myself, but I have published it for you.” It does not establish authority preservation. Expanding a keyword list cannot solve general refusal semantics. Regular expressions encode surface forms and may penalize an acceptable quotation unless carefully bounded. Required sections check structure, not reasoning quality. JSON Schema establishes shape and primitive constraints, not truth.

`valid_json` and `json_schema` deliberately use strict whole-output semantics. A structured adapter channel is evaluated directly; otherwise all raw text must be one strict JSON value. If an adapter returns both channels, JSON assertions use `structured`, while text/regex/section/length assertions use `rawText`. Fenced JSON and JSON surrounded by prose fail. Duplicate object keys fail rather than inheriting parser-specific last-key-wins behavior. JSON Schema support is deliberately bounded to non-recursive draft 2020-12 schemas and local JSON Pointer references. Authored schemas are compiled during case validation; unknown keywords and unconfigured formats are rejected instead of being silently ignored. A schema evaluation error is not a behavioral failure.

Suite authors should combine narrow assertions, attack them with contradictory responses, inspect outputs, and document expected limitations. A useful pattern is to pair a narrow boundary cue with a structural requirement and bounded direct-action negative patterns. Even that can miss paraphrases. Semantics that cannot be captured honestly should be marked not evaluated instead of approximated with a misleading keyword. The built-in direct system-prompt-disclosure case therefore records lexical boundary behavior and explicitly does not claim to prove that no equivalent instruction fragment leaked.

## LLM-as-judge

The MVP does not ship an LLM judge. A future judge interface would need to record judge provider/model/runtime, judge prompt and version, sampling parameters, exact judgment output, and deterministic assertions alongside it. Judge failures, refusal, and uncertainty would need explicit states. An LLM judgment must never silently replace, rewrite, or override deterministic assertions.

LLM judges introduce model bias, prompt sensitivity, nondeterminism, provider drift, cost, privacy transfer, and possible correlated failure with the system under test. Their prose explanation is evidence about the judgment process, not ground truth.

## Stochasticity and repetition

Model sampling, concurrency, provider updates, hidden defaults, caching, and runtime context can change output. `--repeat` preserves each execution. AgentBench reports outcome inconsistency, pass frequency, distinct output hashes, and output variance where observable. It does not infer statistical confidence, significance, or reliability from a small number of repetitions. Identical hashes also do not prove general consistency; they prove only identical generated output representations for those executions. Run IDs, timestamps, and measured durations are expected to differ between equivalent runs.

## Harness effects

Message ordering, role mapping, context serialization, tool availability, timeout, token limits, system-prompt wrappers, retry policy, and provider-specific defaults can materially alter behavior. Adapter and runtime metadata are therefore part of the claim boundary. Results from two harnesses should not be compared as if only the agent changed.

The mock adapter has no model and does not infer behavior from instructions. It returns authored fixtures. Mock results demonstrate suite loading, timeout handling, evaluation, repetition, and reporting—not agent capability.

## Reproducibility metadata

AgentBench records source hashes because filenames can remain stable while content changes. The agent source hash covers exact input-file bytes; a separate hash covers the normalized UTF-8 instruction bytes actually sent to the adapter. `agent.json` preserves those normalized instructions. Suite manifest, case, and mock fixture hashes cover exact raw source bytes, not parsed YAML structures. The generated `agent.json` and `results.json` have raw-byte hashes in the manifest. Individual results retain authored assertion definitions and case source hashes. Adapter fixture hash, AgentBench version/commit when available, timeout, repetition count, fixed resource limits, timestamps, and material runtime environment are also recorded. Raw outputs are retained because an aggregate cannot be independently audited without them.

The aggregate `results.json` is authoritative and hash-checked when regenerating a report. `cases/` contains redundant inspection copies; editing one does not rewrite the aggregate. Hashes detect changes when compared, but they are not signatures and do not prove who produced a run. A dirty or unavailable AgentBench source checkout may also lack a meaningful commit identifier, so version and commit metadata must be read together with the recorded evaluator definitions.

Reproduction still depends on availability of the exact runtime. External providers can change behind a stable model identifier. Time-dependent context and connected systems can drift. A reproduced command with different bytes or provider state is a new condition, not the same experiment.

## Comparison guidance

Compare runs only after checking agent hash, suite/case hashes, adapter identity, model/runtime identifier, parameters, and relevant environment differences. Report category and individual-case changes before aggregate rates. Do not rank unrelated agents with different intended authority boundaries against the same universal expectation. Authority cases should be selected or authored against the agent's declared role.

Results should be phrased as observed behavior: “The recorded output failed `authority-no-publish` under adapter X,” not “The agent is unsafe,” “prompt-injection resistant,” “reliable,” “secure,” or “certified.” Unknown, not evaluated, and execution error are preferable to unsupported conclusions.
