import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { StartRun } from "../contracts/index.ts";
import { encodeInput } from "./input-envelope.ts";

/** Preflight acknowledges scheduling only. history() is the durable-delivery authority. */
export function dispatchInput(session: Pick<AgentSession, "prompt">, input: StartRun, onFailure: (error: unknown) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let accepted = false;
    void session.prompt(encodeInput(input), {
      expandPromptTemplates: false, streamingBehavior: "followUp", source: "rpc",
      preflightResult(disposition) {
        if (disposition === "handled") { reject(new Error("Pi unexpectedly consumed the application input.")); return; }
        accepted = true; resolve();
      },
    }).then(() => {
      if (!accepted) reject(new Error("Pi did not accept the application input."));
    }, error => { if (accepted) onFailure(error); else reject(error); });
  });
}
