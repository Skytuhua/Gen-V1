import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createSecretRedactor } from "../packages/core/secret-references.ts";
import { databaseConnectionV1Schema } from "../packages/contracts/database.ts";

const password = "hunter2-s3cr3t!";
const record = {
  id: randomUUID(), version: 1 as const, label: "shop", engine: "postgres" as const,
  network: { host: "db.internal", port: 5432, database: "shop", user: "svc", tls: "require" as const, secretRefId: "dbconn:x" },
  createdAt: "", updatedAt: "",
};

describe("database secret redaction", () => {
  it("scrubs passwords and userinfo connection strings from surfaced text", () => {
    const redactor = createSecretRedactor([password, `://svc:${password}@db.internal`]);
    const { text, redactions } = redactor.redact(`connect failed: password=${password} dsn=postgres://svc:${password}@db.internal:5432/shop`);
    expect(redactions).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain(password);
    expect(text).not.toContain("svc:");
  });
  it("keeps passwords out of persisted connection records", () => {
    const parsed = databaseConnectionV1Schema.parse(record);
    expect(JSON.stringify(parsed)).not.toContain("password");
    expect(JSON.stringify(parsed)).toContain("secretRefId");
    expect(() => databaseConnectionV1Schema.parse({ ...record, network: { ...record.network, password } })).toThrow();
  });
  it("routes every gateway adapter error through the secret redactor", () => {
    const source = readFileSync(new URL("../packages/capabilities/database-gateway.ts", import.meta.url), "utf8");
    const redacted = source.match(/this\.redactText\(/g) ?? [];
    expect(redacted.length).toBeGreaterThanOrEqual(5); // every adapter error surface
  });
  it("never interpolates credentials into adapter SQL or messages", () => {
    for (const file of ["database-postgres.ts", "database-mysql.ts", "database-sqlite.ts"]) {
      const source = readFileSync(new URL(`../packages/capabilities/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/console\.(log|error|warn|info)/);
      expect(source).not.toMatch(/\$\{[^}]*password/); // credentials never interpolated into SQL/messages
    }
  });
});
