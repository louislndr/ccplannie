import type { ComponentType, ReactNode } from "react";
import { SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Snapshot, nameOf, isPlannie, initials } from "@/api";

// Building blocks that reproduce macOS Mail (Sequoia) and iOS Mail.
// Colors come from the --m-* tokens in index.css, so light and dark follow the system.

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;
export const SF = 1.6; // stroke width that reads like SF Symbols at 15–18px

export const mailFont = { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif" };

export const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" });

/** Window traffic lights: static window chrome. */
export function TrafficLights({ className }: { className?: string }) {
  return (
    <div className={cn("flex gap-2", className)} aria-hidden>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} className="size-3 rounded-full" style={{ background: c, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.18)" }} />)}
    </div>
  );
}

/** Toolbar glyph. Static chrome unless onClick is given. */
export function ToolIcon({ icon: I, title, className, onClick, tint }: { icon: Icon; title: string; className?: string; onClick?: () => void; tint?: string }) {
  const body = <I className={cn("size-[18px]", tint ?? "text-m-icon")} strokeWidth={SF} />;
  return onClick
    ? <button type="button" title={title} aria-label={title} onClick={onClick} className={cn("grid h-7 w-8 place-items-center rounded-[6px] hover:bg-m-fill", className)}>{body}</button>
    : <span title={title} className={cn("grid h-7 w-8 place-items-center", className)}>{body}</span>;
}

export const ToolDivider = () => <span className="mx-1 h-[18px] w-px bg-m-sep" aria-hidden />;

export function SearchField({ value, onChange, className }: { value?: string; onChange?: (v: string) => void; className?: string }) {
  const Glass = (p: any) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} {...p}><circle cx="7" cy="7" r="4.75" /><path d="m10.5 10.5 3.5 3.5" strokeLinecap="round" /></svg>;
  return (
    <label className={cn("flex h-7 items-center gap-1.5 rounded-[7px] bg-m-fill px-2 text-[13px]", className)}>
      <Glass className="size-[13px] shrink-0 text-m-label2" />
      {onChange
        ? <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-m-label outline-none placeholder:text-m-label2" />
        : <span className="text-m-label2">Search</span>}
    </label>
  );
}

export const SectionLabel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("px-[18px] pb-[3px] pt-[14px] text-[11px] font-semibold text-m-label2", className)}>{children}</div>
);

export function SidebarItem({ icon: I, label, count, selected, onClick, lead }: { icon?: Icon; label: ReactNode; count?: number | string; selected?: boolean; onClick?: () => void; lead?: ReactNode }) {
  const cls = cn("mx-[10px] flex h-7 w-[calc(100%-20px)] items-center gap-[7px] rounded-[6px] px-2 text-left text-[13px] text-m-label", selected && "bg-m-sidesel");
  const inner = <>
    {lead ?? (I ? <I className="size-4 shrink-0 text-m-accent" strokeWidth={SF} /> : null)}
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {count ? <span className="shrink-0 text-[12px] tabular-nums text-m-label2">{count}</span> : null}
  </>;
  return onClick ? <button type="button" onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>;
}

/** Contact monogram, like Mail's: gray gradient circle with white initials. ccPlannie gets a glyph instead. */
export function Monogram({ s, addr, size = 40 }: { s: Snapshot; addr: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.4, background: "linear-gradient(180deg, var(--m-avatar1), var(--m-avatar2))" }} className="grid shrink-0 select-none place-items-center rounded-full font-medium text-white">
      {isPlannie(s, addr) ? <SparklesIcon style={{ width: size * 0.46, height: size * 0.46 }} strokeWidth={1.8} /> : initials(nameOf(s, addr))}
    </div>
  );
}

/** Message list row (macOS). */
export function ListRow({ sender, date, subject, preview, selected, unread, onClick, badge }: { sender: ReactNode; date: string; subject: ReactNode; preview: string; selected: boolean; unread?: boolean; onClick: () => void; badge?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="group block w-full px-[10px] text-left">
      <div className={cn("relative rounded-[8px] py-[9px] pl-[26px] pr-3", selected ? "bg-m-select text-white" : "text-m-label")}>
        {unread ? <span className={cn("absolute left-[10px] top-[15px] size-[9px] rounded-full", selected ? "bg-white" : "bg-m-accent")} /> : null}
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{sender}</span>
          <span className={cn("shrink-0 text-[12px]", selected ? "text-white/85" : "text-m-label2")}>{date}</span>
        </div>
        <div className="flex items-center gap-1 truncate text-[12px] leading-[17px]">{badge}<span className="truncate">{subject}</span></div>
        <div className={cn("line-clamp-2 text-[12px] leading-[16px]", selected ? "text-white/80" : "text-m-label2")}>{preview}</div>
      </div>
      {/* Hairline separator, inset to the text, hidden next to the selection */}
      <div className={cn("ml-[26px] mr-2 h-px bg-m-sep", selected && "invisible")} />
    </button>
  );
}

/** Push button (macOS 13pt "regular" control). One primary per screen. */
export function PushButton({ primary, className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button type="button" {...p} className={cn(
      "inline-flex h-[28px] items-center justify-center gap-1.5 rounded-[6px] px-[14px] text-[13px] font-medium disabled:opacity-50",
      primary
        ? "bg-m-accent text-white shadow-[0_0.5px_1.5px_rgba(0,0,0,0.25),inset_0_0.5px_0_rgba(255,255,255,0.25)] active:brightness-90"
        : "bg-m-button text-m-label shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_0.5px_1.5px_rgba(0,0,0,0.12)] active:brightness-95",
      className)}>{children}</button>
  );
}

/** Thin macOS progress bar. */
export const Progress = ({ value, className }: { value: number; className?: string }) => (
  <div className={cn("h-[5px] overflow-hidden rounded-full bg-m-fill", className)} role="progressbar" aria-valuenow={Math.round(value * 100)}>
    <div className="h-full rounded-full bg-m-accent transition-[width] duration-500" style={{ width: `${value * 100}%` }} />
  </div>
);

/** Status dot + label, used where Apple shows state as text, not as a colored pill. */
export const Status = ({ tone, children }: { tone: "green" | "orange" | "purple" | "blue" | "gray"; children: ReactNode }) => (
  <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-m-label2">
    <span className={cn("size-[7px] rounded-full", { green: "bg-m-green", orange: "bg-m-orange", purple: "bg-m-purple", blue: "bg-m-accent", gray: "bg-m-label3" }[tone])} />{children}
  </span>
);
