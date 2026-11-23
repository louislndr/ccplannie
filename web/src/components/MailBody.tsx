import { Fragment } from "react";
import { money, fmtDate } from "@/api";

// Minimal, safe rendering of Plannie's plain-text emails: **bold**, *(label)*, "- " bullets, "1. " lists.
function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*\([^)]+\)\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**")) return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith("*(")) return <span key={i} className="text-m-label2"> ({p.slice(2, -2)})</span>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export function MailBody({ body, meta, hideOptionsText }: { body: string; meta?: any; hideOptionsText?: boolean }) {
  const lines = body.split("\n");
  const blocks: JSX.Element[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => { if (list) { const L = list; blocks.push(L.ordered ? <ol key={blocks.length} className="my-1.5 ml-5 list-decimal space-y-1">{L.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ol> : <ul key={blocks.length} className="my-1.5 ml-5 list-disc space-y-1 marker:text-m-label2">{L.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ul>); list = null; } };
  const options: VenueOption[] | undefined = hideOptionsText ? meta?.options : undefined;
  let renderedOptions = false;
  for (const l of lines) {
    const b = l.match(/^- (.*)/), o = l.match(/^\d+\. (.*)/);
    if (options?.length && o) {
      if (!renderedOptions) {
        flush();
        blocks.push(<OptionCards key={blocks.length} options={options} />);
        renderedOptions = true;
      }
      continue;
    }
    if (b || o) { const ordered = !!o; if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; } list.items.push((b || o)![1]); continue; }
    flush();
    if (/^— ccPlannie ·/.test(l)) { blocks.push(<p key={blocks.length} className="mt-3 text-[0.85em] text-m-label2">{l}</p>); continue; }
    if (/^--- (Request|Offer) details/.test(l) || /^---$/.test(l)) { blocks.push(<p key={blocks.length} className="text-[0.85em] text-m-label2">{l}</p>); continue; }
    blocks.push(l.trim() ? <p key={blocks.length} className="min-h-[1.25em]">{inline(l)}</p> : <div key={blocks.length} className="h-2.5" />);
  }
  flush();
  return (
    <div className="leading-[1.5] text-m-label">
      {blocks}
      {!renderedOptions && options?.length ? <OptionCards options={options} /> : null}
    </div>
  );
}

type VenueOption = {
  id: string;
  n: number;
  supplier: string;
  city?: string;
  capacity: number | null;
  headcount: number;
  date: string | null;
  amount: number | null;
  overBudget: boolean;
};

export function OptionCards({ options }: { options: VenueOption[] }) {
  return (
    <ol aria-label="Venue quotes" role="list" className="my-2 list-none divide-y divide-m-sep overflow-hidden rounded-[10px] border border-m-sep bg-m-window">
      {options.map((option) => (
        <li key={option.id} className="px-3.5 py-3">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1 basis-32">
              <div className="text-[14px] font-semibold leading-tight text-m-label">
                {options.length > 1 ? <span className="mr-1.5 text-[12px] font-normal tabular-nums text-m-label2">{option.n}.</span> : null}
                {option.supplier}
              </div>
              {option.city ? <div className="mt-0.5 text-[12px] leading-snug text-m-label2">{option.city}</div> : null}
            </div>
            <div className="ml-auto whitespace-nowrap text-right">
              <div className="text-[15px] font-semibold leading-tight tabular-nums text-m-label">{money(option.amount)}</div>
              {option.overBudget ? <div className="mt-0.5 text-[12px] leading-snug text-[#8b460d]">Over budget</div> : null}
            </div>
          </div>
          <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2 border-t border-m-sep pt-2 text-[12px] leading-snug">
            <div>
              <dt className="text-m-label2">Quoted for</dt>
              <dd>{option.headcount} guests</dd>
            </div>
            <div>
              <dt className="text-m-label2">Capacity</dt>
              <dd>{option.capacity == null ? "Unknown" : `${option.capacity} guests`}</dd>
            </div>
            <div>
              <dt className="text-m-label2">Date</dt>
              <dd>{fmtDate(option.date)}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}
