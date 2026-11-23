import wordmark from "@/assets/planned-wordmark.png";

export function PlannedCredit() {
  return (
    <p className="concept-label flex items-center gap-2.5">
      <span>Built for</span>
      <img className="concept-wordmark" src={wordmark} width="1081" height="168" alt="Planned" />
    </p>
  );
}
