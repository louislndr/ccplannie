import { useCallback, useEffect, useRef, useState } from "react";
import { getState, post, type Snapshot } from "@/api";
import { ConsoleApp } from "@/console/ConsoleApp";
import { CompanyPage } from "@/components/CompanyPage";
import { goBack, linkClick, navigate, useLocation } from "@/lib/router";
import { HowItWorks } from "@/components/HowItWorks";
import { ScenarioStart } from "@/components/ScenarioPicker";
import { StepsOutline } from "@/components/StepsOutline";
import { ListIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { DemoControls } from "@/components/DemoControls";
import { PlannieBrand } from "@/components/PlannieMark";
import { StoryView } from "@/components/StoryView";
import { Button, Card } from "@/components/ui/primitives";

const DEMO_PATH = "/demo";
const COMPANY_PATH = "/demo/company";
const STEPS_PATH = "/demo/steps";

export default function App() {
  const path = useLocation().path.replace(/\/+$/, "") || "/";
  if (path === "/admin" || path.startsWith("/admin/")) return <div className="h-full overflow-clip"><ConsoleApp /></div>;
  if (path === "/how-it-works") return <HowItWorks />;
  return <DemoApp path={path} />;
}

function DemoApp({ path }: { path: string }) {
  const [current, setCurrent] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [review, setReview] = useState<Snapshot | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toastMsg, setToast] = useState<string | null>(null);
  const closeDemoPanel = useCallback(() => goBack(DEMO_PATH), []);
  const timer = useRef<number | null>(null);
  const stepsButton = useRef<HTMLButtonElement>(null);
  const refreshRequest = useRef(0);
  const appliedRefresh = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++refreshRequest.current;
    try {
      const snapshot = await getState();
      if (request < appliedRefresh.current) return;
      appliedRefresh.current = request;
      setCurrent(snapshot);
      setLoadError(false);
    } catch {
      if (request < appliedRefresh.current) return;
      appliedRefresh.current = request;
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 2500);
    return () => window.clearInterval(id);
  }, [refresh]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const toast = (message: string) => {
    setToast(message);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 5000);
  };

  const runDemoAction = async (action: "step" | "reset" | "back", scenarioId?: string) => {
    setBusy(true);
    try {
      if (scenarioId) {
        await post("/api/demo/scenario", { id: scenarioId });
        setReview(null);
      }
      const result = await post(`/api/demo/${action}?view=story`);
      if (action !== "step") setReview(null);
      if (result.snapshot) {
        appliedRefresh.current = ++refreshRequest.current;
        setCurrent(result.snapshot);
        setLoadError(false);
      } else await refresh();
      if (scenarioId) {
        setSelection(null);
        if (location.pathname === path) navigate(DEMO_PATH);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "The demo request failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!current) return (
    <main className="planned-concept grid h-dvh place-items-center bg-background p-4 text-foreground">
      {loadError ? <Card className="flex w-full max-w-sm flex-col items-start gap-3 p-6">
        <div role="alert"><h1 className="text-lg font-semibold">Couldn’t load the demo</h1></div>
        <Button disabled={retrying} onClick={async () => { setRetrying(true); await refresh(); setRetrying(false); }}>{retrying ? "Trying again…" : "Try again"}</Button>
      </Card> : <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
    </main>
  );

  const reviewed = review?.demo.scenario.id === current.demo.scenario.id && review.demo.step < current.demo.step ? review : null;
  const s = reviewed ?? current;
  const reviewAt = async (step: number) => {
    if (step === current.demo.step) { setReview(null); return; }
    setReviewBusy(true);
    try { setReview(await getState(step)); }
    catch { toast("Couldn’t open that step. Try again from Steps."); }
    finally { setReviewBusy(false); }
  };

  const company = path === COMPANY_PATH;
  const outline = path === STEPS_PATH;
  const pickingScenario = path !== DEMO_PATH && !company && !outline;
  const activeScenario = pickingScenario ? null : current.demo.scenario;
  const selectedScenario = selection ?? current.demo.scenario.id;
  const adminDestination = new URL((!pickingScenario && current.demo.adminPath) || "/admin/requests", location.origin);
  adminDestination.searchParams.set("from", pickingScenario ? "home" : "demo");
  const adminPath = adminDestination.pathname + adminDestination.search + adminDestination.hash;
  const showRulesLink = !pickingScenario && !reviewed && current.demo.steps[current.demo.step - 1]?.op === "editTimeout";

  return (
    <main className="planned-concept concept-demo h-full overflow-clip bg-background text-foreground">
      {company && activeScenario ? (
        <CompanyPage toast={toast} onClose={closeDemoPanel} />
      ) : (
        <div data-picker={pickingScenario ? "" : undefined} className="concept-shell concept-story mx-auto flex h-full max-w-[calc(var(--concept-content-width)+2*var(--concept-gutter))] flex-col px-[var(--concept-gutter)]">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-4">
              <h1 className="flex"><a href="/" onClick={linkClick("/")} aria-label="ccPlannie home" className="flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><PlannieBrand /></a></h1>
              {activeScenario ? (
                <h2 className="concept-header-label">{activeScenario.title}</h2>
              ) : null}
            </div>
            <nav aria-label="More" className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {activeScenario ? (
                <Button ref={stepsButton} variant="outline" onClick={() => navigate(STEPS_PATH, { returnTo: DEMO_PATH })} disabled={busy || reviewBusy} aria-expanded={outline} aria-haspopup="dialog">
                  <ListIcon aria-hidden="true" strokeWidth={1.7} />Steps
                </Button>
              ) : null}
              {!activeScenario ? <Button variant="outline" nativeButton={false} render={<a href="/how-it-works" onClick={linkClick("/how-it-works", { returnTo: "/" })} />}>
                About ccPlannie
              </Button> : null}
              {activeScenario ? <Button variant="outline" onClick={() => navigate(COMPANY_PATH, { returnTo: DEMO_PATH })}>Company</Button> : null}
              <Button variant="outline" nativeButton={false} render={<a href={adminPath} target="_blank" rel="noreferrer" />}>
                {showRulesLink ? "See the rule change" : <><span className="sm:hidden">Admin</span><span className="hidden sm:inline">Admin dashboard</span></>}<SquareArrowOutUpRightIcon aria-hidden="true" className="size-3.5" strokeWidth={1.7} />
              </Button>
            </nav>
          </header>
          <div className="min-h-0 flex-1">
            {pickingScenario
              ? <ScenarioStart scenarios={current.demo.scenarios} current={selectedScenario} busy={busy} onPick={setSelection} onStart={() => runDemoAction("step", selectedScenario)} />
              : <StoryView key={`${s.demo.scenario.id}:${s.demo.step}`} s={s} />}
          </div>
          {!pickingScenario ? <DemoControls
            s={s}
            busy={busy || reviewBusy}
            reviewing={!!reviewed}
            canBack={reviewed ? reviewed.demo.step > 1 : current.demo.step > 0}
            canReset={!reviewed && current.demo.step > 0}
            onBack={() => reviewed ? reviewAt(reviewed.demo.step - 1) : runDemoAction("back")}
            onNext={() => reviewed ? reviewAt(reviewed.demo.step + 1) : runDemoAction("step")}
            onReset={() => runDemoAction("reset")}
            onExitReview={reviewed ? () => setReview(null) : undefined}
          /> : null}
          {outline ? <StepsOutline s={current} current={current.demo.step} onReview={reviewAt} onClose={closeDemoPanel} trigger={stepsButton} /> : null}
        </div>
      )}
      {toastMsg ? (
        <div role="status" className="fixed inset-x-4 bottom-4 z-50 mx-auto w-fit max-w-[calc(100%-2rem)]">
          <Card className="px-5 py-3 text-sm">{toastMsg}</Card>
        </div>
      ) : null}
    </main>
  );
}
