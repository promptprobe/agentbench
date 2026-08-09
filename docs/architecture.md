# Architecture

AgentBench is a local TypeScript library with a CLI entry point. It has no database, server, queue, hosted control plane, or mandatory network dependency.

## Four independent layers

1. **Agent ingestion** reads bounded local bytes, computes SHA-256, validates the selected format, and creates a `NormalizedAgent`. It never executes content from the artifact.
2. **Suite loading** parses a strict YAML manifest and exact relative case paths. Every case is validated into typed messages, inline untrusted artifacts, and explicit assertions.
3. **Execution adapters** receive the normalized instructions and one case. The stable interface returns raw text and/or structured JSON. Provider-specific configuration cannot enter the evaluator layer.
4. **Evaluators** inspect only the observed output and authored deterministic assertions. They return structured evidence, not an opaque score.

The runner adds per-test timeout handling, preserves every repetition, distinguishes adapter/transport/timeout errors from behavioral failures, writes evidence files, and derives labeled category and consistency summaries.

## Data flow

```text
bounded bytes                         bounded YAML
    │                                     │
    ▼                                     ▼
agent format validation              suite/case validation
    │                                     │
    └──────────► normalized input ◄────────┘
                         │
                         ▼
               explicit local adapter
                         │
                         ▼
                 bounded output data
                         │
                         ▼
             deterministic evaluators
                         │
                         ▼
       manifest + JSON results + Markdown evidence
```

## Normalized agent model

The normalized model contains an ID, optional name, instruction string, source type/resolved path/raw-byte hash/size, normalized-instruction hash, descriptive metadata, and parser warnings. Source-specific execution settings are not promoted into capabilities. Generic `scope` remains metadata so suite authors can select relevant cases; it does not authorize a side effect.

## Suite layout

Each directory has one `suite.yaml` and explicitly listed `.yaml`/`.yml` cases. Globs, URLs, dynamic imports, and arbitrary file references are not supported. Case paths are checked both lexically and after `realpath`, preventing parent traversal and symlink escape.

Inline contextual artifacts support text, Markdown, and JSON. Their parsed trust value is always `untrusted`. This prevents a test file from pretending an embedded fake system message has higher priority in the AgentBench protocol, though an external adapter still needs to format the boundary correctly.

## Result model

`manifest.json` records run-level identity, source and generated-file hashes, resource limits, and environment. `agent.json` preserves the exact normalized instructions and descriptive metadata used by the adapter. `results.json` contains every `TestResult`, authored assertion definition, and derived summary, and is hash-checked before report regeneration. `cases/` contains redundant per-execution copies for inspection. `report.md` renders failures, errors, exact failed assertions, safely fenced raw/structured observed output, category outcomes, consistency signals, and warnings.

Behavioral failure means the adapter returned an observable output that did not satisfy one or more assertions. Execution error means no valid behavioral judgment was possible because of timeout, transport, adapter, or evaluator failure. The CLI preserves that distinction in both records and exit codes; execution errors take precedence over optional behavioral-failure exit status.

## Current Buzz and HiveBuzz boundary

This decision was source-reviewed on 2026-08-10 against:

- `promptprobe/hivebuzz` commit [`f70ffed15c09fb2d912732c6f745e5139c79ba94`](https://github.com/promptprobe/hivebuzz/tree/f70ffed15c09fb2d912732c6f745e5139c79ba94)
- `block/buzz` commit [`119a84897f225c1e3213a09cd149abb37dcb3abc`](https://github.com/block/buzz/tree/119a84897f225c1e3213a09cd149abb37dcb3abc)

HiveBuzz's [`snapshot-scan.ts`](https://github.com/promptprobe/hivebuzz/blob/f70ffed15c09fb2d912732c6f745e5139c79ba94/lib/snapshot-scan.ts) strictly validates public `.agent.json` and `.agent.png` artifacts. It checks the v1 structure, byte limits, PNG chunks, memory policy, source allowlists, remote avatar beacons, unknown fields, credential patterns, spoofing controls, and catalog digest/size. Its own warning says static checks cannot prove prompt behavior. AgentBench therefore does not reproduce that public-artifact scanner.

Buzz's [`agent_snapshot.rs`](https://github.com/block/buzz/blob/119a84897f225c1e3213a09cd149abb37dcb3abc/desktop/src-tauri/src/managed_agents/agent_snapshot.rs) defines `buzz-agent-snapshot` v1. The portable definition can contain `systemPrompt`, runtime/model/provider preferences, parallelism, response policy and allowlists, name pools, and timeouts; profile and optional plaintext memory are separate sections. Buzz also supports JSON, PNG metadata, and locked envelopes, and its import path can mint identity and write state after explicit confirmation.

AgentBench uses a narrower parser:

- accept only strict, unlocked v1 JSON;
- require a non-empty `definition.systemPrompt`;
- require `memory.level: none` and no entries;
- reject unknown fields and unsupported versions;
- ignore runtime, model, provider, response policy, allowlists, name pools, profile assets, and source built-in status for execution;
- never decode PNG, unlock cards, mint identity, import memory, activate an agent, launch Buzz/ACP, or execute embedded capabilities.

This is a compatibility parser, not an installer or a claim that the snapshot passed HiveBuzz's static distribution checks.

## Fixed execution surfaces

Suites cannot name implementation modules. Only adapters compiled into AgentBench may execute. The only MVP adapter is `mock`, which performs fixture lookup and optional bounded delay. The runner executes one fixed `git rev-parse HEAD` process without a shell to capture AgentBench source metadata when available; no untrusted value becomes a command, executable name, or argument.

Future custom adapters should be installed as trusted project dependencies or registered explicitly by a host application. Loading arbitrary JavaScript from a downloaded suite would violate the MVP security model.
