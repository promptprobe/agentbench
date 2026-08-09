import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PACKAGE_ROOT } from "../paths.js";
import { serializedSchemaDocuments } from "../schema-documents.js";

const failures: string[] = [];
for (const [name, expected] of Object.entries(serializedSchemaDocuments())) {
  const path = resolve(PACKAGE_ROOT, "schemas", name);
  const observed = await readFile(path, "utf8").catch(() => undefined);
  if (observed !== expected) failures.push(name);
}
if (failures.length > 0) {
  throw new Error(`Generated schemas are missing or stale: ${failures.join(", ")}. Run npm run schemas:generate.`);
}
