import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPostgresMigrationTarget } from "./postgres-migration-target.mjs";

test("transaction retries are bounded to confirmed rollback errors, never uncertain connection or commit failures", async () => {
  for (const code of ["40001", "40P01", "08006", "ECONNRESET"]) {
    let attempts = 0;
    const destination = createPostgresMigrationTarget({ unsafe() { throw new Error("Unused outside transaction"); },
      async begin() { attempts++; throw Object.assign(new Error("private credentials and evidence"), { code }); } }, { destinationId: randomUUID() });
    await assert.rejects(destination.initialize(), error => !error.message.includes("private credentials") && /could not be confirmed/.test(error.message));
    assert.equal(attempts, ["40001", "40P01"].includes(code) ? 3 : 1);
  }
});

test("unknown driver failures do not expose connection details or private SQL values", async () => {
  const destination = createPostgresMigrationTarget({ unsafe() {}, async begin() { throw new Error("postgres://private:secret@host/private-data"); } }, { destinationId: randomUUID() });
  await assert.rejects(destination.initialize(), error => !error.message.includes("secret") && !error.message.includes("host") && /could not be confirmed/.test(error.message));
});
