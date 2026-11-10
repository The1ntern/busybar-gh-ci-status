import { device } from "@shared/device";
import { loadValues } from "@shared/settings";
import { column, render, textWidth, type Node, type RectangleElement } from "@busy-app/busy-lib";
import manifest from "./appmeta/manifest.json";

/** The name the app draws under; the device clears elements by this id. */
const APP = manifest.id;

const API = "https://api.github.com";
const API_VERSION = "2026-03-10";

/** Poll intervals. Without a token GitHub allows 60 requests an hour, so poll more slowly. */
const ACTIVE_MS = { token: 30 * 1000, anon: 90 * 1000 };
const IDLE_MS = { token: 2 * 60 * 1000, anon: 5 * 60 * 1000 };
/** Failure backoff: 1, 2, 4 … minutes, capped at an hour. */
const RETRY_MIN_MS = 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;

const SCREEN_W = 72;
const GREEN = "#3FB950FF";
const RED = "#F85149FF";
const AMBER = "#D29922FF";
const GREY = "#8B949EFF";
const WHITE = "#FFFFFFFF";
const SUBTLE_WHITE = "#FFFFFF80";

interface Config {
  repo: string;
  branch: string;
  token: string;
}

/** The few fields of a workflow run the app reads. */
interface Run {
  status: string | null;
  conclusion: string | null;
  run_number: number;
}

/** What the screen shows: a state word and its color. */
interface State {
  word: string;
  color: string;
  active: boolean;
  runNumber: number | null;
}

class HttpError extends Error {
  readonly status: number;
  /** When GitHub says to wait, in ms from now; 0 when it doesn't say. */
  readonly waitMs: number;
  constructor(status: number, waitMs: number) {
    super(`HTTP ${status}`);
    this.status = status;
    this.waitMs = waitMs;
  }
}

const report = (err: unknown) =>
  console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);

// ---------- settings ----------

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** How often to re-read settings while no usable repo is set. */
const UNSET_RECHECK_MS = 30 * 1000;

type ConfigResult = { cfg: Config } | { problem: "Set repo" | "Bad repo" };

/** Accepts owner/name, github.com/owner/name, full URLs, .git suffixes and trailing paths. */
function normaliseRepo(raw: string): string | null {
  const parts = raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^github\.com\//i, "")
    .split(/[/?#]/)
    .filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  const repo = `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null;
}

/**
 * Reads settings through the runtime global first, then the documented settings API,
 * since the global is not available on every firmware.
 */
async function readValues(): Promise<Record<string, unknown>> {
  const local = await loadValues();
  if (local && str(local.repo)) return local;
  try {
    const doc = await device.AppsSettingsGet({ app_id: APP });
    if (doc && doc.values) return doc.values;
  } catch (err) {
    report(err);
  }
  return local ?? {};
}

async function loadConfig(): Promise<ConfigResult> {
  const values = await readValues();
  const raw = str(values.repo);
  if (!raw) return { problem: "Set repo" };
  const repo = normaliseRepo(raw);
  if (!repo) {
    console.error(`${APP}: repo setting is not owner/name: ${raw}`);
    return { problem: "Bad repo" };
  }
  return { cfg: { repo, branch: str(values.branch), token: str(values.token) } };
}

// ---------- GitHub ----------

/** Seconds GitHub asks us to wait, from retry-after or the rate-limit reset; 0 when neither applies. */
function waitFrom(res: Response): number {
  const retry = Number(res.headers.get("retry-after"));
  if (retry > 0) return retry * 1000;
  if (res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (reset > 0) return Math.max(reset * 1000 - Date.now(), 0) + 1000;
  }
  return 0;
}

function stateOf(run: Run | null): State {
  if (!run) return { word: "NO RUNS", color: GREY, active: false, runNumber: null };
  const n = run.run_number;
  if (run.status !== "completed") {
    const queued = run.status === "queued" || run.status === "waiting" || run.status === "pending" || run.status === "requested";
    return { word: queued ? "QUEUED" : "RUNNING", color: AMBER, active: true, runNumber: n };
  }
  switch (run.conclusion) {
    case "success":
      return { word: "PASS", color: GREEN, active: false, runNumber: n };
    case "failure":
    case "timed_out":
    case "startup_failure":
      return { word: "FAIL", color: RED, active: false, runNumber: n };
    case "cancelled":
      return { word: "CANCEL", color: GREY, active: false, runNumber: n };
    case "skipped":
      return { word: "SKIP", color: GREY, active: false, runNumber: n };
    case "action_required":
      return { word: "ACTION", color: AMBER, active: false, runNumber: n };
    default:
      return { word: "DONE", color: GREY, active: false, runNumber: n };
  }
}

// ---------- display ----------

/** Cuts text from the end until it fits the screen in the small font. */
function fit(text: string): string {
  let t = text;
  while (t.length > 1 && textWidth(t, "small") > SCREEN_W) t = t.slice(0, -1);
  return t;
}

interface Screen {
  top: string;
  topColor: string;
  bottom: string;
  alert: boolean;
}

/**
 * A 2×2 dot in the top-right corner, sent each time the app checks GitHub.
 * The bar removes it after `timeout` seconds, so it blinks with a single draw.
 */
const PULSE: RectangleElement = {
  type: "rectangle",
  id: "pulse",
  x: SCREEN_W - 1,
  y: 0,
  align: "top_right",
  width: 2,
  height: 2,
  fill: "solid",
  fill_colors: [WHITE],
  border_width: 0,
  timeout: 1,
};

/** Two lines. Fonts stay string literals: the build bundles glyph maps only for `font:` literals it can see. */
function frame(s: Screen): Node {
  return column({ justify: "center", align: "center" }, [
    { type: "text", id: "state", text: s.top, font: "bold", color: s.topColor },
    { type: "text", id: "detail", text: fit(s.bottom), font: "small", color: s.alert ? AMBER : SUBTLE_WHITE },
  ]);
}

function main(): void {
  let stopped = false;
  let busy = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Last good result, kept on screen through errors, and the ETag that produced it.
  let last: State | null = null;
  let etag: string | null = null;
  let etagUrl = "";

  // Display: one request in flight; a newer screen replaces a pending one; only changed elements are sent.
  const sent = new Map<string, string>();
  let wanted: Screen | null = null;
  let pulse = false;
  let drawing = false;

  const flush = async (): Promise<void> => {
    drawing = true;
    try {
      while ((wanted || pulse) && !stopped) {
        const s = wanted;
        wanted = null;
        const changed = s
          ? render(frame(s)).filter((el) => {
              const json = JSON.stringify(el);
              const id = String((el as { id?: unknown }).id);
              if (sent.get(id) === json) return false;
              sent.set(id, json);
              return true;
            })
          : [];
        // The dot is not tracked in `sent`: it is sent on every check and not retried.
        const elements = pulse ? [...changed, PULSE] : changed;
        pulse = false;
        if (elements.length === 0) continue;
        try {
          await device.DisplayDraw({ application_name: APP, priority: 50, elements });
        } catch (err) {
          // Forget what failed so the next screen resends it.
          for (const el of changed) sent.delete(String((el as { id?: unknown }).id));
          throw err;
        }
      }
    } finally {
      drawing = false;
    }
  };

  const show = (s: Screen) => {
    if (stopped) return;
    wanted = s;
    if (!drawing) void flush().catch(report);
  };

  /** Blinks the corner dot to show a GitHub check is happening. */
  const blink = () => {
    if (stopped) return;
    pulse = true;
    if (!drawing) void flush().catch(report);
  };

  /** A message on line 2; line 1 keeps the last known state, or a neutral title. */
  const notice = (cfg: Config | null, message: string) =>
    show({
      top: last ? last.word : "CI",
      topColor: last ? last.color : WHITE,
      bottom: cfg && !last ? `${message} ${cfg.repo}` : message,
      alert: true,
    });

  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void refresh().catch(report);
    }, ms);
  };

  const backoff = (): number => {
    const ms = Math.min(RETRY_MIN_MS * Math.pow(2, failures), RETRY_MAX_MS);
    failures += 1;
    return ms;
  };

  /** One request for the latest run. Returns null on a 304 (nothing changed). */
  const fetchState = async (cfg: Config): Promise<State | null> => {
    let url = `${API}/repos/${cfg.repo}/actions/runs?per_page=1&exclude_pull_requests=true`;
    if (cfg.branch) url += `&branch=${encodeURIComponent(cfg.branch)}`;
    if (url !== etagUrl) {
      etag = null;
      etagUrl = url;
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "busy-bar-ci-status",
    };
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    if (etag) headers["If-None-Match"] = etag;

    const res = await fetch(url, { headers });
    if (res.status === 304) return null;
    if (!res.ok) throw new HttpError(res.status, waitFrom(res));

    const body = (await res.json()) as { workflow_runs?: Run[] };
    const first = body.workflow_runs?.[0];
    // Keep only the three fields; the rest of the payload is dropped here.
    const run: Run | null = first
      ? { status: first.status, conclusion: first.conclusion, run_number: first.run_number }
      : null;
    etag = res.headers.get("etag");
    return stateOf(run);
  };

  const refresh = async (): Promise<void> => {
    if (busy || stopped) return;
    busy = true;
    let cfg: Config | null = null;
    try {
      const loaded = await loadConfig();
      if ("problem" in loaded) {
        // Re-read settings slowly so a newly saved repo is picked up; ok checks at once.
        notice(null, loaded.problem);
        schedule(UNSET_RECHECK_MS);
        return;
      }
      cfg = loaded.cfg;

      const online = await device
        .WifiStatusGet()
        .then((s) => s.state === "connected")
        .catch(() => true);
      if (!online) {
        notice(cfg, "Offline");
        schedule(backoff());
        return;
      }

      blink();
      const next = await fetchState(cfg);
      if (next) last = next;
      failures = 0;

      if (last) {
        const name = cfg.repo.split("/")[1];
        show({
          top: last.word,
          topColor: last.color,
          bottom: last.runNumber === null ? name : `${name} #${last.runNumber}`,
          alert: false,
        });
      }

      const rate = cfg.token ? "token" : "anon";
      schedule(last && last.active ? ACTIVE_MS[rate] : IDLE_MS[rate]);
    } catch (err) {
      report(err);
      if (err instanceof HttpError) {
        if (err.status === 401) {
          // A wrong token will not fix itself: stop polling until ok is pressed.
          notice(cfg, "Bad token");
          return;
        }
        if (err.status === 404) {
          notice(cfg, "Not found");
          schedule(backoff());
          return;
        }
        if ((err.status === 403 || err.status === 429) && err.waitMs > 0) {
          notice(cfg, "Rate limit");
          schedule(Math.min(Math.max(err.waitMs, RETRY_MIN_MS), RETRY_MAX_MS));
          return;
        }
      }
      notice(cfg, "Error");
      schedule(backoff());
    } finally {
      busy = false;
    }
  };

  void refresh().catch(report);

  const unbind = listen("input", (event) => {
    if (stopped || event.action !== "short") return;

    if (event.key === "ok") {
      // Manual refresh; skipped when one is already running.
      failures = 0;
      void refresh().catch(report);
      return;
    }

    if (event.key !== "back") return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    // An in-flight fetch settles on its own and schedules nothing once stopped.
    // Not detached from inside the handler: with nothing else left the unbind stops the app on the spot.
    setTimeout(unbind, 0);
  });
}

main();

