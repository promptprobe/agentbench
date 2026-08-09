# Contributing

AgentBench welcomes focused cases, deterministic evaluators, adapter-boundary improvements, documentation, and security hardening.

## Setup

```bash
npm install
npm run ci
npm run build
npm run example
```

Use Node.js 20.11 or newer. CI must remain credential-free and fully runnable with the mock adapter.

## Pull requests

- Keep the library/provider boundary independent; do not place provider logic in core evaluation.
- Add or update tests for schema, evaluator, timeout, result, or report changes.
- Regenerate schemas with `npm run schemas:generate` after changing Zod definitions.
- Preserve raw evidence and distinguish behavioral failures from harness errors.
- Document assertion limitations and avoid universal safety, trust, intelligence, or certification claims.
- Do not add dynamic suite code, shell execution from untrusted data, remote references, or implicit uploads.
- Keep sample agents clearly labeled as fixtures rather than catalog entries.

New behavioral cases should follow [docs/test-authoring.md](docs/test-authoring.md). New adapters should follow [docs/adapters.md](docs/adapters.md) and include an explicit privacy/data-transfer section.

## Generated files

The files under `schemas/` are generated from `src/schema.ts`. CI compares them byte-for-byte with the current source schemas.

## Licensing

By contributing, you agree that your contribution is licensed under Apache-2.0 and that you have the right to submit it.
