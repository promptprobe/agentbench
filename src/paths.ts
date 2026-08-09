import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

/** Package root in both source (`src/`) and compiled (`dist/`) layouts. */
export const PACKAGE_ROOT = resolve(moduleDirectory, "..");
export const BUILTIN_SUITES_ROOT = resolve(PACKAGE_ROOT, "suites");
export const DEFAULT_MOCK_FIXTURE = resolve(PACKAGE_ROOT, "fixtures", "responses", "default.yaml");
