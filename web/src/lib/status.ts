// One meaning per color, on the story site and in the console:
//   green  = done (booked and confirmed)
//   blue   = moving (ccPlannie or Planned is working on it)
//   orange = waiting on a person (a decision, an approval, a review)
//   red    = blocked (something is wrong and needs fixing)
//   gray   = paused or not started
export type StageTone = "ok" | "info" | "attn" | "block" | "neutral";

export function stageTone(code: string): StageTone {
  if (code === "confirmed") return "ok";
  if (code === "approval_needed") return "attn";
  if (code === "paused") return "neutral";
  return "info"; // received, assigned, sourcing, options, approved_internal, supplier_pending, change_in_progress
}

export const LEGEND: [StageTone, string][] = [["ok", "Confirmed"], ["info", "In progress"], ["attn", "Waiting on a person"], ["block", "Blocked"], ["neutral", "Paused"]];
