import { useEffect, useRef } from "react";

export function PlannieBrand() {
  return (
    <span className="concept-heading concept-display inline-flex items-center gap-3">
      <PlannieMark />
      <span><span className="concept-cc">cc</span>Plannie</span>
    </span>
  );
}

export function PlannieMark() {
  const markRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const mark = markRef.current;
    if (!mark) return;

    const followPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;

      const bounds = mark.getBoundingClientRect();
      const x = event.clientX - (bounds.left + bounds.width / 2);
      const y = event.clientY - (bounds.top + bounds.height / 2);
      const distance = Math.max(Math.hypot(x, y), 100);
      mark.style.setProperty("--plannie-eye-x", `${0.16 * x / distance}em`);
      mark.style.setProperty("--plannie-eye-y", `${0.14 * y / distance}em`);
    };

    const centerEyes = () => {
      mark.style.removeProperty("--plannie-eye-x");
      mark.style.removeProperty("--plannie-eye-y");
    };

    const page = document.documentElement;
    window.addEventListener("pointermove", followPointer, { passive: true });
    window.addEventListener("blur", centerEyes);
    page.addEventListener("pointerleave", centerEyes);
    return () => {
      window.removeEventListener("pointermove", followPointer);
      window.removeEventListener("blur", centerEyes);
      page.removeEventListener("pointerleave", centerEyes);
    };
  }, []);

  return <span ref={markRef} className="plannie-mark" aria-hidden="true" />;
}
