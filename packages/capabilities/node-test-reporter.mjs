import { inspect } from "node:util";

// Gen-owned node:test reporter. Emits one JSON line per completed test event so
// the host can normalize a run without scraping human-readable output. Runs
// inside the launched child process; side effects limited to yielded lines.
const capped = (value, limit) => {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : inspect(value, { depth: 4, breakLength: 100 });
  return text.length > limit ? text.slice(0, limit) : text;
};

export default async function* repositoryTestReporter(source) {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const { name, nesting, file, line, column, details } = event.data;
    const line = {
      type: event.type === "test:pass" ? "pass" : "fail",
      name: capped(name, 8000),
      nesting,
      file,
      line,
      column,
      kind: details?.type ?? "test",
      skip: details?.skip ?? false,
      todo: details?.todo ?? false,
      durationMs: details?.duration_ms,
    };
    const error = details?.error?.cause ?? details?.error;
    if (error) {
      line.error = {
        message: capped(error.message ?? error, 8000),
        expected: capped(error.expected, 20000),
        actual: capped(error.actual, 20000),
        stack: capped(error.stack, 16000),
      };
    }
    yield JSON.stringify(line) + "\n";
  }
}
