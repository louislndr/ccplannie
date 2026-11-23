// The company console: a separate, manager-facing site at /admin. Same backend and database as the
// email demo. Administrators configure the company; event managers handle requests. Requesters stay in email.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIcon, ArrowLeftRightIcon, CircleAlertIcon, UserRoundIcon, CircleCheckIcon, InboxIcon, RotateCcwIcon, PlugIcon, ScaleIcon, SquareArrowOutUpLeftIcon, UsersIcon, LockIcon } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { DemoControlBar } from "@/components/DemoControls";
import { PlannieBrand } from "@/components/PlannieMark";
import { cn } from "@/lib/utils";
import { linkClick, navigate, useLocation } from "@/lib/router";
import { aget, apost, ApiError, type Session } from "./api";
import { A, ErrorState, Loading, Modal, inputCls } from "./ui";
import { Requests } from "./Requests";
import { RequestDetail } from "./RequestDetail";
import { People } from "./People";
import { PolicyPage } from "./Policy";
import { Connections } from "./Connections";
import { Activity } from "./Activity";
import { PlannedPage } from "./Planned";
import { clearDrafts } from "./drafts";
import "./console.css";

type Ctx = { session: Session; toast: (m: string, tone?: "ok" | "error") => void };
const ConsoleCtx = createContext<Ctx | null>(null);
export const useConsole = () => useContext(ConsoleCtx)!;

const NAV = [
  ["/admin/requests", "Requests", InboxIcon],
  ["/admin/people", "People", UsersIcon],
  ["/admin/policy", "Rules", ScaleIcon],
  ["/admin/planned", "Planned", ArrowLeftRightIcon],
  ["/admin/connections", "Connections", PlugIcon],
  ["/admin/activity", "Activity", ActivityIcon],
] as const;

export function ConsoleApp() {
  const { path, search } = useLocation();
  const [demoOrigin] = useState(() => new URLSearchParams(location.search).get("from"));
  const [session, setSession] = useState<Session | null>(null);
  const [gate, setGate] = useState<{ code: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [requestActor, setRequestActor] = useState<{ id: string; name: string } | null>(null);
  const [demoAnchor, setDemoAnchor] = useState<{ url: string; id: string } | null>(null);
  const [toastMsg, setToast] = useState<{ m: string; tone: string } | null>(null);
  const timer = useRef<number | null>(null);
  const main = useRef<HTMLElement>(null);
  const refresh = useRef(0);

  const load = useCallback(() => {
    const request = ++refresh.current;
    setError(null);
    aget("/api/admin/session").then((x) => {
      if (request !== refresh.current) return;
      setSession(x);
      setGate(null);
    }).catch((e: ApiError) => {
      if (request !== refresh.current) return;
      setSession(null);
      if (e.status === 401) setGate({ code: "login", message: e.message });
      else if (e.status === 503) setGate({ code: "not_configured", message: e.message });
      else if (e.status === 404) setGate({ code: "demo_server", message: e.message });
      else { setGate(null); setError(e.message); }
    });
  }, []);
  useEffect(load, [load]);
  const demo = session?.mode === "demo";
  const demoReturnPath = demoOrigin === "home" ? "/" : demoOrigin === "demo" || session?.demo?.step ? "/demo" : "/";
  const signedIn = !!session;
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    const t = window.setInterval(() => {
      const request = refresh.current;
      aget("/api/admin/session").then((next) => {
        if (active && request === refresh.current) setSession(next);
      }).catch((e: ApiError) => { if (active && request === refresh.current && e.status === 401) load(); });
    }, demo ? 2500 : 5000);
    return () => { active = false; window.clearInterval(t); };
  }, [demo, signedIn, load]);
  useEffect(() => { window.addEventListener("console:signed-out", load); return () => window.removeEventListener("console:signed-out", load); }, [load]);
  useEffect(() => { if (path === "/admin" || path === "/admin/") navigate("/admin/requests", { replace: true }); }, [path]);
  useEffect(() => { document.title = `${NAV.find(([p]) => path.startsWith(p))?.[1] ?? "Console"} · ccPlannie console`; }, [path]);
  useEffect(() => { if (main.current) main.current.scrollTop = 0; }, [path]);
  useEffect(() => {
    const content = main.current;
    const targetId = demoAnchor?.url === path + search ? demoAnchor.id : location.hash.slice(1);
    if (!content || !targetId) return;
    const scroll = () => {
      const target = document.getElementById(targetId);
      if (!target || !content.contains(target)) return false;
      target.scrollIntoView({ behavior: "instant", block: "center" });
      return true;
    };
    if (scroll()) return;
    const observer = new MutationObserver(() => { if (scroll()) observer.disconnect(); });
    observer.observe(content, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 5000);
    return () => { observer.disconnect(); window.clearTimeout(timeout); };
  }, [demoAnchor, path, search, signedIn]);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const toast = useCallback((m: string, tone: "ok" | "error" = "ok") => {
    setToast({ m, tone });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  const resetDemo = async () => {
    setResetting(true);
    try {
      await apost("/api/demo/reset");
      clearDrafts();
      try { sessionStorage.removeItem("ccplannie.console.actor"); } catch { /* ignore */ }
      setConfirmReset(false);
      navigate("/admin/requests");
      load();
      toast("Demo reset. Everything is back to the start.");
    } catch (e) { toast((e as Error).message, "error"); } finally { setResetting(false); }
  };

  const [, , section = "requests", reqId] = path.replace(/\/$/, "").split("/");
  const reportRequestActor = useCallback((id: string, name: string | null) => {
    setRequestActor((current) => name ? { id, name } : current?.id === id ? null : current);
  }, []);

  let page: ReactNode;
  if (gate?.code === "login") page = <SignIn onDone={load} />;
  else if (gate) page = <Locked title={gate.code === "demo_server" ? "This is the demo server" : "Console not set up"} message={gate.message} />;
  else if (error) page = <ErrorState error={error} retry={load} />;
  else if (!session) page = <Loading label="Loading the console…" />;
  else if (section === "requests" && reqId && /^E-\d+$/i.test(reqId)) page = <RequestDetail key={reqId} id={reqId} onActorChange={demo ? reportRequestActor : undefined} />;
  else if (section === "requests" && !reqId) page = <Requests />;
  else if (section === "people") page = <People />;
  else if (section === "policy") page = <PolicyPage />;
  else if (section === "connections") page = <Connections />;
  else if (section === "activity") page = <Activity />;
  else if (section === "planned") page = <PlannedPage />;
  else page = <Page><h1 className="text-xl font-semibold">Page unavailable</h1><A to="/admin/requests">Back to requests</A></Page>;

  return (
    <div className="planned-concept h-full overflow-hidden text-foreground">
      <div className="concept-shell mx-auto flex h-full max-w-[calc(var(--concept-content-width)+2*var(--concept-gutter))] flex-col px-[var(--concept-gutter)]">
        <a href="#console-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2">Skip to content</a>
        <header className={cn("flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2", demo && "concept-demo")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-4">
            <a href={demo ? "/" : "/admin/requests"} onClick={linkClick(demo ? "/" : "/admin/requests")} aria-label="ccPlannie home" className="flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><PlannieBrand /></a>
            <span className="concept-header-label">Company console</span>
          </div>
          {demo ? (
            <Button variant="outline" nativeButton={false} render={<a href={demoReturnPath} onClick={linkClick(demoReturnPath)} />} className="ml-auto">
              <SquareArrowOutUpLeftIcon aria-hidden="true" className="size-3.5" strokeWidth={1.7} />Back to demo
            </Button>
          ) : session ? (
            <Button size="sm" variant="outline" onClick={async () => { try { await apost("/api/admin/logout"); load(); } catch (e) { toast((e as Error).message, "error"); } }}>Sign out</Button>
          ) : null}
        </header>
        <div className="console flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--concept-panel-radius)] md:flex-row">
          {session ? (
            <nav aria-label="Console" className="console-nav grid shrink-0 grid-cols-3 gap-1 border-b border-border p-2 min-[720px]:grid-cols-6 md:flex md:w-[12rem] md:flex-col md:border-r md:border-b-0 md:p-3">
              {NAV.map(([to, label, Icon]) => {
                const active = path === to || path.startsWith(`${to}/`) || (to === "/admin/requests" && (path === "/admin" || path === "/admin/"));
                return (
                  <a key={to} href={to} onClick={linkClick(to)} aria-current={active ? "page" : undefined}
                    className={cn("flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-xs md:flex-row md:justify-start md:gap-2.5 md:px-3 md:py-2 md:text-[13px]", active ? "bg-[var(--console-selected)] font-semibold" : "text-muted-foreground hover:bg-[var(--console-row-hover)] hover:text-foreground")}>
                    <Icon className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />{label}
                  </a>
                );
              })}
              {/* Company console: drop unsaved drafts kept in this browser. */}
              {!demo ? (
                <button onClick={() => { clearDrafts(); toast("Cache cleared. Unsaved drafts were discarded."); }} title="Discard unsaved drafts kept in this browser"
                  className="mt-auto hidden items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-muted-foreground hover:bg-[var(--console-row-hover)] hover:text-foreground md:flex">
                  <RotateCcwIcon className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />Clear cache
                </button>
              ) : null}
            </nav>
          ) : null}
          {/* The content column; toasts are centered on it, above the panel's bottom edge. */}
          <div className="relative flex min-h-0 min-w-0 flex-1">
          <main ref={main} id="console-main" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {/* An older server doesn't send "stale" at all: that means it predates this page, so saves will fail. */}
            {session && (session.stale || session.stale === undefined) ? (
              <div role="alert" className="border-b border-[color-mix(in_oklab,var(--console-attn)_40%,var(--border))] bg-[color-mix(in_oklab,var(--console-attn)_8%,var(--card))] px-4 py-2.5 text-[13px] md:px-8">
                <span className="font-medium">This server is running an older version of ccPlannie, so saving and some buttons won't work.</span>{" "}
                Stop it (Ctrl+C in its terminal) and run <code className="rounded bg-[var(--m-fill)] px-1">npm run demo</code> again.
              </div>
            ) : null}
            <ConsoleCtx.Provider value={session ? { session, toast } : null}>{page}</ConsoleCtx.Provider>
          </main>
          {toastMsg ? (
            <div role="status" aria-live="polite" className="console-toast pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center px-4">
              <div className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] leading-snug shadow-[0_12px_32px_rgba(0,0,0,0.16)]">
                {toastMsg.tone === "error"
                  ? <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-[var(--console-block)]" strokeWidth={1.8} />
                  : <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0 text-[var(--console-ok)]" strokeWidth={1.8} />}
                <span>{toastMsg.m}</span>
              </div>
            </div>
          ) : null}
          </div>
        </div>
        {demo && session?.demo ? <AdminDemoControls d={session.demo} viewer={section === "requests" && requestActor && requestActor.id === reqId ? requestActor.name : null} onReset={() => setConfirmReset(true)} onMoved={(next, to) => {
          refresh.current++;
          setSession(next);
          if (!to) { setDemoAnchor(null); return; }
          const [path, hash] = to.split("#");
          setDemoAnchor(hash ? { url: path, id: hash } : null);
          if (location.pathname + location.search !== path) navigate(path);
        }} toast={toast} /> : null}
      </div>
      {demo && session?.demo ? (
        <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset the demo?"
          description={`Demo ${session.demo.scenario.number} (${session.demo.scenario.title}) starts over from the beginning.`}
          footer={<>
            <Button variant="outline" className="ml-auto" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button onClick={resetDemo} disabled={resetting}>{resetting ? "Resetting…" : "Reset demo"}</Button>
          </>}>
          <p className="text-[13px] leading-relaxed text-muted-foreground">This removes every change made in the story and in this console: requests, decisions, people, roles, policy and unsaved drafts. The story site goes back to step 0 too.</p>
        </Modal>
      ) : null}
    </div>
  );
}

// Step through the demo story from the console: the pages here refresh as the story moves, and a step that
// changes something in the console takes you to the page where it shows.
function AdminDemoControls({ d, viewer, onMoved, onReset, toast }: { d: NonNullable<Session["demo"]>; viewer: string | null; onMoved: (session: Session, adminPath: string | null) => void; onReset: () => void; toast: (m: string, tone?: "ok" | "error") => void }) {
  const [busy, setBusy] = useState<"back" | "next" | null>(null);
  const move = async (dir: "back" | "next") => {
    setBusy(dir);
    try {
      const result = await apost(`/api/demo/${dir === "next" ? "step" : "back"}?view=admin`);
      const s: Session = result.session ?? await aget("/api/admin/session");
      // Request pages act as this step's person when they're someone who can act there (the event manager).
      const who = s.demo?.current?.view?.who;
      if (who && who.includes("@")) { try { sessionStorage.setItem("ccplannie.console.actor", who); } catch { /* ignore */ } window.dispatchEvent(new CustomEvent("console:actor", { detail: who })); }
      onMoved(s, s.demo?.current?.adminPath || "/admin/requests");
    } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(null); }
  };
  const viewpoint = viewer ? `Viewing as ${viewer}` : null;
  return <DemoControlBar
    step={d.step} total={d.steps} title={d.current?.title}
    detail={viewpoint ? (
      <span className="flex min-w-0 items-center gap-1.5 border-l border-border pl-2" title={viewpoint}>
        <UserRoundIcon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.7} />
        <span className="truncate">{viewpoint}</span>
      </span>
    ) : null}
    busy={!!busy} reviewing={false} canBack={d.step > 0} canReset
    onBack={() => move("back")} onNext={() => move("next")} onReset={onReset}
  />;
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await apost("/api/admin/login", { password }); setPassword(""); onDone(); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="mx-auto flex max-w-sm flex-col gap-3 px-6 py-20">
      <LockIcon className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <h1 className="text-[17px] font-semibold">Sign in to the company console</h1>
      <label htmlFor="pw" className="text-[12px] font-medium">Administrator password</label>
      <input id="pw" type="password" autoComplete="current-password" autoFocus className={inputCls} value={password} aria-invalid={!!error} onChange={(e) => setPassword(e.target.value)} />
      {error ? <p role="alert" className="text-[12px] text-destructive">{error}</p> : null}
      <Button type="submit" disabled={busy || !password}>Sign in</Button>
    </form>
  );
}

function Locked({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-20 text-center">
      <LockIcon className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <h1 className="text-[17px] font-semibold">{title}</h1>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{message}</p>
    </div>
  );
}

// Page container with consistent gutters.
// One width for every page so titles and content never jump between sections.
export const Page = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-16 pt-5 md:px-8 md:pt-7">{children}</div>
);
