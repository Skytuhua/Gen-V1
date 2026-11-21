import { z } from "zod";

// Runner-neutral structured result of an approved `repository.test` operation.
// Captured from a machine-readable runner report (node:test JSON lines or the
// Vitest json reporter), normalized host-side, and stored on the operation's
// ProcessResult. Bounded: totals always count every test the report contained
// even when `truncated` dropped suite/test entries beyond the limits.
export const TEST_RUN_LIMITS = { reportBytes: 8 * 1024 * 1024, tests: 2000, suites: 500, nameChars: 1000, messageChars: 8000, expectedChars: 20000, stackFrames: 12, stackChars: 16000 } as const;

export const testStatusSchema = z.enum(["passed", "failed", "skipped", "todo"]);

export const testLocationSchema = z.object({
  file: z.string().max(1024),
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
}).strict();

export const testCaseSchema = z.object({
  id: z.string().regex(/^t[0-9a-f]{16}$/),          // sha256(file + NUL byte + fullName) first 16 hex, prefixed "t"
  name: z.string().max(TEST_RUN_LIMITS.nameChars),
  fullName: z.string().max(TEST_RUN_LIMITS.nameChars * 4),
  status: testStatusSchema,
  durationMs: z.number().nonnegative().optional(),
  location: testLocationSchema.optional(),
  failure: z.object({
    message: z.string().max(TEST_RUN_LIMITS.messageChars),
    expected: z.string().max(TEST_RUN_LIMITS.expectedChars).optional(),
    actual: z.string().max(TEST_RUN_LIMITS.expectedChars).optional(),
    stack: z.array(testLocationSchema.extend({ text: z.string().max(500) })).max(TEST_RUN_LIMITS.stackFrames),
    truncated: z.boolean(),
  }).strict().optional(),
}).strict();
export type TestCaseV1 = z.infer<typeof testCaseSchema>;

export type TestSuite = { id: string; name: string; file: string; status: "passed" | "failed" | "skipped"; suites: TestSuite[]; tests: TestCaseV1[] };
export const testSuiteSchema: z.ZodType<TestSuite> = z.lazy(() => z.object({
  id: z.string().regex(/^s[0-9a-f]{16}$/),
  name: z.string().max(TEST_RUN_LIMITS.nameChars),
  file: z.string().max(1024),
  status: z.enum(["passed", "failed", "skipped"]),
  suites: z.array(testSuiteSchema),
  tests: z.array(testCaseSchema),
}).strict());

export const testRunV1Schema = z.object({
  version: z.literal(1),
  runner: z.enum(["node-test", "vitest"]),
  reportState: z.enum(["complete", "partial", "missing", "invalid"]),
  reportProblem: z.string().max(500).optional(),     // plain-language reason when not complete
  totals: z.object({
    tests: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
    todo: z.number().int(),
  }).strict(),
  durationMs: z.number().nonnegative().optional(),
  suites: z.array(testSuiteSchema),                  // top level = one suite per test file
  truncated: z.boolean(),                            // limits hit; totals still count everything seen
  filter: z.object({ testName: z.string() }).strict().optional(),
  rerunOf: z.object({ operationId: z.string(), testId: z.string() }).strict().optional(),
}).strict();
export type TestRunV1 = z.infer<typeof testRunV1Schema>;
