import { AssistantRuntimeProvider, useLocalRuntime, ThreadPrimitive, ComposerPrimitive, MessagePrimitive, type ChatModelAdapter } from "@assistant-ui/react";
import { ArrowUpIcon, SparklesIcon } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { PLANNIE_COLOR } from "@/api";

// "Ask Plannie" for the event manager. Read-only Q&A grounded in the event record (POST /api/chat).
function makeAdapter(eventId: string | null): ChatModelAdapter {
  return {
    async run({ messages, abortSignal }) {
      const payload = messages.map((m) => ({ role: m.role, content: m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") }));
      const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, messages: payload }), signal: abortSignal });
      const j = await r.json();
      return { content: [{ type: "text", text: j.text || j.error || "No answer." }], metadata: { custom: { source: j.source } } };
    },
  };
}

const UserMessage = () => (
  <MessagePrimitive.Root className="flex justify-end">
    <div className="max-w-[85%] rounded-[18px] bg-m-accent px-3 py-2 text-[13px] text-white"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>
);
const AssistantMessage = () => (
  <MessagePrimitive.Root className="flex gap-2">
    <div className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white", PLANNIE_COLOR)}><SparklesIcon className="size-3" /></div>
    <div className="max-w-[90%] whitespace-pre-wrap rounded-[18px] bg-m-fill px-3 py-2 text-[13px] leading-relaxed"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>
);

const SUGGESTIONS = ["Where are we?", "What's waiting on approval?", "Do plan, approval and booking match?", "What are the risks or fees?"];

export function AskPlannie({ eventId }: { eventId: string | null }) {
  const adapter = useMemo(() => makeAdapter(eventId), [eventId]);
  const runtime = useLocalRuntime(adapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
        <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <ThreadPrimitive.Empty>
            <div className="flex flex-col items-center gap-3 px-2 pt-8 text-center">
              <div className={cn("grid size-10 place-items-center rounded-full bg-gradient-to-br text-white", PLANNIE_COLOR)}><SparklesIcon className="size-5" /></div>
              <div><div className="text-sm font-semibold">Ask ccPlannie</div><div className="text-xs text-muted-foreground">Answers come from this event's record. ccPlannie can't take actions here.</div></div>
              <div className="mt-2 flex w-full flex-col border-t border-m-sep text-left">
                {SUGGESTIONS.map((q) => <ThreadPrimitive.Suggestion key={q} prompt={q} send className="border-b border-m-sep py-2 text-left text-[13px] text-m-accent">{q}</ThreadPrimitive.Suggestion>)}
              </div>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="m-3 flex items-end gap-2 rounded-[18px] bg-m-window px-3 py-1.5 shadow-[0_0_0_0.5px_var(--m-frame)]">
          <ComposerPrimitive.Input placeholder="Ask about this event…" className="max-h-28 min-h-6 flex-1 resize-none bg-transparent text-[13px] outline-none" />
          <ComposerPrimitive.Send className="grid size-7 place-items-center rounded-full bg-m-accent text-white disabled:opacity-40"><ArrowUpIcon className="size-4" /></ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
