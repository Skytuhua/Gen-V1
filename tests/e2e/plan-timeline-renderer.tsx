import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Snapshot } from "../../packages/contracts";
import { PlanStatus } from "../../apps/web/src/PlanStatus";
import { timelineSnapshot } from "./plan-timeline-fixture";
import "../../apps/web/src/styles.css";
import "@fontsource-variable/inter";

declare global {
  interface Window {
    planFixture: { update(snapshot: Snapshot, threadId?: string): void };
  }
}
function Fixture() {
  const [state, setState] = useState({ snapshot: timelineSnapshot(), threadId: "thread-a" });
  window.planFixture = { update: (snapshot, threadId = "thread-a") => setState({ snapshot, threadId }) };
  return (
    <main style={{ height: "100vh", overflow: "auto" }}>
      <div style={{ padding: "8px 16px", fontSize: 12 }}>Synthetic renderer fixture</div>
      <PlanStatus snapshot={state.snapshot} threadId={state.threadId} />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
