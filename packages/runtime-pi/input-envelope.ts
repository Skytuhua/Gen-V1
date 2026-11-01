import type { RunContext, StartRun } from "../contracts/index.ts";
import { sameContext } from "./ipc.ts";

const PREFIX = "[harness-input:v1] ";

/** The first line is application-owned. User text is never searched for markers. */
export function encodeInput(input: StartRun & { inputIds?: string[] }): string {
  const inputIds = input.inputIds ?? [input.inputId];
  if (!inputIds.length || inputIds[0] !== input.inputId || inputIds.some(id => typeof id !== "string" || !id)) throw new Error("Invalid application input envelope IDs.");
  return PREFIX + JSON.stringify({ inputId: input.inputId, inputIds, threadId: input.threadId, runId: input.runId, epoch: input.epoch }) + "\n" +
    JSON.stringify({ prompt: input.prompt, resources: input.resources.map(({ id, kind, label, writable }) => ({ id, kind, label, writable })) });
}

/** Read only application metadata leading a user message, never its opaque prompt. */
export function messageInputIds(message: { role?: unknown; content?: unknown } | undefined, ctx?: RunContext): string[] {
  if (message?.role !== "user") return [];
  const content = message.content;
  const text = typeof content === "string" ? content : Array.isArray(content) && content[0]?.type === "text" ? content[0].text : undefined;
  if (typeof text !== "string" || !text.startsWith(PREFIX)) return [];
  const newline = text.indexOf("\n");
  if (newline < 0) return [];
  try {
    const marker = JSON.parse(text.slice(PREFIX.length, newline));
    if (typeof marker.inputId !== "string" || !marker.inputId || typeof marker.threadId !== "string" || typeof marker.runId !== "string" || !Number.isSafeInteger(marker.epoch)) return [];
    if (ctx && !sameContext(marker, ctx)) return [];
    const inputIds = marker.inputIds ?? [marker.inputId];
    if (!Array.isArray(inputIds) || inputIds[0] !== marker.inputId || inputIds.some(id => typeof id !== "string" || !id)) return [];
    return [...new Set<string>(inputIds)];
  } catch { return []; }
}

export function extractInputIds(jsonl: string): string[] {
  const ids = new Set<string>();
  for (const line of jsonl.split(/\r?\n/)) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "message") continue;
      for (const id of messageInputIds(entry.message)) ids.add(id);
    } catch { /* A torn final append is not a delivered input. */ }
  }
  return [...ids];
}
