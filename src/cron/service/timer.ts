import type { HeartbeatRunResult } from "../../infra/heartbeat-wake.js";
import type { CronJob } from "../types.js";
import type { CronEvent, CronServiceState } from "./state.js";
import { resolveCronDeliveryPlan } from "../delivery.js";
import {
  computeJobNextRunAtMs,
  nextWakeAtMs,
  recomputeNextRuns,
  resolveJobPayloadTextForMain,
} from "./jobs.js";
import { locked } from "./locked.js";
import { ensureLoaded, persist } from "./store.js";

const MAX_TIMER_DELAY_MS = 60_000;

/**
 * Maximum wall-clock time for a single job execution. Acts as a safety net
 * on top of the per-provider / per-agent timeouts to prevent one stuck job
 * from wedging the entire cron lane.
 */
const DEFAULT_JOB_TIMEOUT_MS = 10 * 60_000; // 10 minutes

/**
 * Maximum number of consecutive errors before an "at" (one-shot) job is
 * automatically disabled.  Recurring jobs keep retrying with backoff.
 */
const MAX_CONSECUTIVE_ERRORS_AT = 5;

/**
 * Exponential backoff delays (in ms) indexed by consecutive error count.
 * After the last entry the delay stays constant.
 */
const ERROR_BACKOFF_SCHEDULE_MS = [
  30_000, // 1st error  →  30 s
  60_000, // 2nd error  →   1 min
  5 * 60_000, // 3rd error  →   5 min
  15 * 60_000, // 4th error  →  15 min
  60 * 60_000, // 5th+ error →  60 min
];

function errorBackoffMs(consecutiveErrors: number): number {
  const idx = Math.min(consecutiveErrors - 1, ERROR_BACKOFF_SCHEDULE_MS.length - 1);
  return ERROR_BACKOFF_SCHEDULE_MS[Math.max(0, idx)];
}

/**
 * Returns true if the error message indicates a permanent, non-retryable
 * failure (e.g. "model not allowed").  Used to disable one-shot jobs early.
 */
function isPermanentError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes("model not allowed") ||
    lower.includes("invalid api key") ||
    lower.includes("authentication failed")
  );
}

export function armTimer(state: CronServiceState) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
  if (!state.deps.cronEnabled) {
    state.deps.log.debug({}, "cron: armTimer skipped - scheduler disabled");
    return;
  }
  const nextAt = nextWakeAtMs(state);
  if (!nextAt) {
    const jobCount = state.store?.jobs.length ?? 0;
    const enabledCount = state.store?.jobs.filter((j) => j.enabled).length ?? 0;
    const withNextRun =
      state.store?.jobs.filter((j) => j.enabled && typeof j.state.nextRunAtMs === "number")
        .length ?? 0;
    state.deps.log.debug(
      { jobCount, enabledCount, withNextRun },
      "cron: armTimer skipped - no jobs with nextRunAtMs",
    );
    return;
  }
  const now = state.deps.nowMs();
  const delay = Math.max(nextAt - now, 0);
  // Wake at least once a minute to avoid schedule drift and recover quickly
  // when the process was paused or wall-clock time jumps.
  const clampedDelay = Math.min(delay, MAX_TIMER_DELAY_MS);
  state.timer = setTimeout(async () => {
    try {
      await onTimer(state);
    } catch (err) {
      state.deps.log.error({ err: String(err) }, "cron: timer tick failed");
    }
  }, clampedDelay);
  state.deps.log.debug(
    { nextAt, delayMs: clampedDelay, clamped: delay > MAX_TIMER_DELAY_MS },
    "cron: timer armed",
  );
}

export async function onTimer(state: CronServiceState) {
  if (state.running) {
    return;
  }
  state.running = true;
  try {
    const dueJobs = await locked(state, async () => {
      await ensureLoaded(state, { forceReload: true, skipRecompute: true });
      const due = findDueJobs(state);

      if (due.length === 0) {
        const changed = recomputeNextRuns(state);
        if (changed) {
          await persist(state);
        }
        return [];
      }

      const now = state.deps.nowMs();
      for (const job of due) {
        job.state.runningAtMs = now;
        job.state.lastError = undefined;
      }
      await persist(state);

      return due.map((j) => ({
        id: j.id,
        job: j,
      }));
    });

    const results: Array<{
      jobId: string;
      status: "ok" | "error" | "skipped";
      error?: string;
      summary?: string;
      sessionId?: string;
      sessionKey?: string;
      startedAt: number;
      endedAt: number;
    }> = [];

    for (const { id, job } of dueJobs) {
      const startedAt = state.deps.nowMs();
      job.state.runningAtMs = startedAt;
      emit(state, { jobId: job.id, action: "started", runAtMs: startedAt });

      const jobTimeoutMs =
        job.payload.kind === "agentTurn" && typeof job.payload.timeoutSeconds === "number"
          ? job.payload.timeoutSeconds * 1_000
          : DEFAULT_JOB_TIMEOUT_MS;

      try {
        const result = await Promise.race([
          executeJobCore(state, job),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("cron: job execution timed out")), jobTimeoutMs),
          ),
        ]);
        results.push({ jobId: id, ...result, startedAt, endedAt: state.deps.nowMs() });
      } catch (err) {
        state.deps.log.warn(
          { jobId: id, jobName: job.name, timeoutMs: jobTimeoutMs },
          `cron: job failed: ${String(err)}`,
        );
        results.push({
          jobId: id,
          status: "error",
          error: String(err),
          startedAt,
          endedAt: state.deps.nowMs(),
        });
      }
    }

    if (results.length > 0) {
      await locked(state, async () => {
        await ensureLoaded(state, { forceReload: true, skipRecompute: true });

        for (const result of results) {
          const job = state.store?.jobs.find((j) => j.id === result.jobId);
          if (!job) {
            continue;
          }

          const startedAt = result.startedAt;
          job.state.runningAtMs = undefined;
          job.state.lastRunAtMs = startedAt;
          job.state.lastStatus = result.status;
          job.state.lastDurationMs = Math.max(0, result.endedAt - startedAt);
          job.state.lastError = result.error;

          // Track consecutive errors for backoff / auto-disable.
          if (result.status === "error") {
            job.state.consecutiveErrors = (job.state.consecutiveErrors ?? 0) + 1;
          } else {
            job.state.consecutiveErrors = 0;
          }

          const shouldDelete =
            job.schedule.kind === "at" && result.status === "ok" && job.deleteAfterRun === true;

          if (!shouldDelete) {
            if (job.schedule.kind === "at" && result.status === "ok") {
              job.enabled = false;
              job.state.nextRunAtMs = undefined;
            } else if (
              result.status === "error" &&
              job.schedule.kind === "at" &&
              ((job.state.consecutiveErrors ?? 0) >= MAX_CONSECUTIVE_ERRORS_AT ||
                isPermanentError(result.error))
            ) {
              // One-shot jobs: disable after too many errors or a permanent error.
              job.enabled = false;
              job.state.nextRunAtMs = undefined;
              state.deps.log.warn(
                {
                  jobId: job.id,
                  jobName: job.name,
                  consecutiveErrors: job.state.consecutiveErrors,
                  permanent: isPermanentError(result.error),
                },
                "cron: disabling one-shot job after repeated/permanent errors",
              );
            } else if (result.status === "error" && job.enabled) {
              // Apply exponential backoff for errored jobs to prevent retry storms.
              const backoff = errorBackoffMs(job.state.consecutiveErrors ?? 1);
              const normalNext = computeJobNextRunAtMs(job, result.endedAt);
              const backoffNext = result.endedAt + backoff;
              // Use whichever is later: the natural next run or the backoff delay.
              job.state.nextRunAtMs =
                normalNext !== undefined ? Math.max(normalNext, backoffNext) : backoffNext;
              state.deps.log.info(
                {
                  jobId: job.id,
                  consecutiveErrors: job.state.consecutiveErrors,
                  backoffMs: backoff,
                  nextRunAtMs: job.state.nextRunAtMs,
                },
                "cron: applying error backoff",
              );
            } else if (job.enabled) {
              job.state.nextRunAtMs = computeJobNextRunAtMs(job, result.endedAt);
            } else {
              job.state.nextRunAtMs = undefined;
            }
          }

          emit(state, {
            jobId: job.id,
            action: "finished",
            status: result.status,
            error: result.error,
            summary: result.summary,
            sessionId: result.sessionId,
            sessionKey: result.sessionKey,
            runAtMs: startedAt,
            durationMs: job.state.lastDurationMs,
            nextRunAtMs: job.state.nextRunAtMs,
          });

          if (shouldDelete && state.store) {
            state.store.jobs = state.store.jobs.filter((j) => j.id !== job.id);
            emit(state, { jobId: job.id, action: "removed" });
          }

          job.updatedAtMs = result.endedAt;
        }

        recomputeNextRuns(state);
        await persist(state);
      });
    }
  } finally {
    state.running = false;
    armTimer(state);
  }
}

function findDueJobs(state: CronServiceState): CronJob[] {
  if (!state.store) {
    return [];
  }
  const now = state.deps.nowMs();
  return state.store.jobs.filter((j) => {
    if (!j.state) {
      j.state = {};
    }
    if (!j.enabled) {
      return false;
    }
    if (typeof j.state.runningAtMs === "number") {
      return false;
    }
    const next = j.state.nextRunAtMs;
    return typeof next === "number" && now >= next;
  });
}

export async function runMissedJobs(state: CronServiceState) {
  if (!state.store) {
    return;
  }
  const now = state.deps.nowMs();
  const missed = state.store.jobs.filter((j) => {
    if (!j.state) {
      j.state = {};
    }
    if (!j.enabled) {
      return false;
    }
    if (typeof j.state.runningAtMs === "number") {
      return false;
    }
    const next = j.state.nextRunAtMs;
    if (j.schedule.kind === "at" && j.state.lastStatus === "ok") {
      return false;
    }
    return typeof next === "number" && now >= next;
  });

  if (missed.length > 0) {
    state.deps.log.info(
      { count: missed.length, jobIds: missed.map((j) => j.id) },
      "cron: running missed jobs after restart",
    );
    for (const job of missed) {
      await executeJob(state, job, now, { forced: false });
    }
  }
}

export async function runDueJobs(state: CronServiceState) {
  if (!state.store) {
    return;
  }
  const now = state.deps.nowMs();
  const due = state.store.jobs.filter((j) => {
    if (!j.state) {
      j.state = {};
    }
    if (!j.enabled) {
      return false;
    }
    if (typeof j.state.runningAtMs === "number") {
      return false;
    }
    const next = j.state.nextRunAtMs;
    return typeof next === "number" && now >= next;
  });
  for (const job of due) {
    await executeJob(state, job, now, { forced: false });
  }
}

async function executeJobCore(
  state: CronServiceState,
  job: CronJob,
): Promise<{
  status: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
}> {
  if (job.sessionTarget === "main") {
    const text = resolveJobPayloadTextForMain(job);
    if (!text) {
      const kind = job.payload.kind;
      return {
        status: "skipped",
        error:
          kind === "systemEvent"
            ? "main job requires non-empty systemEvent text"
            : 'main job requires payload.kind="systemEvent"',
      };
    }
    state.deps.enqueueSystemEvent(text, { agentId: job.agentId });
    if (job.wakeMode === "now" && state.deps.runHeartbeatOnce) {
      const reason = `cron:${job.id}`;
      const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      const maxWaitMs = 2 * 60_000;
      const waitStartedAt = state.deps.nowMs();

      let heartbeatResult: HeartbeatRunResult;
      for (;;) {
        heartbeatResult = await state.deps.runHeartbeatOnce({ reason });
        if (
          heartbeatResult.status !== "skipped" ||
          heartbeatResult.reason !== "requests-in-flight"
        ) {
          break;
        }
        if (state.deps.nowMs() - waitStartedAt > maxWaitMs) {
          state.deps.requestHeartbeatNow({ reason });
          return { status: "ok", summary: text };
        }
        await delay(250);
      }

      if (heartbeatResult.status === "ran") {
        return { status: "ok", summary: text };
      } else if (heartbeatResult.status === "skipped") {
        return { status: "skipped", error: heartbeatResult.reason, summary: text };
      } else {
        return { status: "error", error: heartbeatResult.reason, summary: text };
      }
    } else {
      state.deps.requestHeartbeatNow({ reason: `cron:${job.id}` });
      return { status: "ok", summary: text };
    }
  }

  if (job.payload.kind !== "agentTurn") {
    return { status: "skipped", error: "isolated job requires payload.kind=agentTurn" };
  }

  const res = await state.deps.runIsolatedAgentJob({
    job,
    message: job.payload.message,
  });

  // Post a short summary back to the main session.
  const summaryText = res.summary?.trim();
  const deliveryPlan = resolveCronDeliveryPlan(job);
  if (summaryText && deliveryPlan.requested) {
    const prefix = "Cron";
    const label =
      res.status === "error" ? `${prefix} (error): ${summaryText}` : `${prefix}: ${summaryText}`;
    state.deps.enqueueSystemEvent(label, { agentId: job.agentId });
    if (job.wakeMode === "now") {
      state.deps.requestHeartbeatNow({ reason: `cron:${job.id}` });
    }
  }

  return {
    status: res.status,
    error: res.error,
    summary: res.summary,
    sessionId: res.sessionId,
    sessionKey: res.sessionKey,
  };
}

/**
 * Execute a job. This version is used by the `run` command and other
 * places that need the full execution with state updates.
 */
export async function executeJob(
  state: CronServiceState,
  job: CronJob,
  nowMs: number,
  opts: { forced: boolean },
) {
  if (!job.state) {
    job.state = {};
  }
  const startedAt = state.deps.nowMs();
  job.state.runningAtMs = startedAt;
  job.state.lastError = undefined;
  emit(state, { jobId: job.id, action: "started", runAtMs: startedAt });

  let deleted = false;

  const finish = async (
    status: "ok" | "error" | "skipped",
    err?: string,
    summary?: string,
    session?: { sessionId?: string; sessionKey?: string },
  ) => {
    const endedAt = state.deps.nowMs();
    job.state.runningAtMs = undefined;
    job.state.lastRunAtMs = startedAt;
    job.state.lastStatus = status;
    job.state.lastDurationMs = Math.max(0, endedAt - startedAt);
    job.state.lastError = err;

    // Track consecutive errors for backoff / auto-disable.
    if (status === "error") {
      job.state.consecutiveErrors = (job.state.consecutiveErrors ?? 0) + 1;
    } else {
      job.state.consecutiveErrors = 0;
    }

    const shouldDelete =
      job.schedule.kind === "at" && status === "ok" && job.deleteAfterRun === true;

    if (!shouldDelete) {
      if (job.schedule.kind === "at" && status === "ok") {
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
      } else if (
        status === "error" &&
        job.schedule.kind === "at" &&
        ((job.state.consecutiveErrors ?? 0) >= MAX_CONSECUTIVE_ERRORS_AT || isPermanentError(err))
      ) {
        // One-shot jobs: disable after too many errors or a permanent error.
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
        state.deps.log.warn(
          {
            jobId: job.id,
            jobName: job.name,
            consecutiveErrors: job.state.consecutiveErrors,
            permanent: isPermanentError(err),
          },
          "cron: disabling one-shot job after repeated/permanent errors",
        );
      } else if (status === "error" && job.enabled) {
        // Apply exponential backoff for errored jobs to prevent retry storms.
        const backoff = errorBackoffMs(job.state.consecutiveErrors ?? 1);
        const normalNext = computeJobNextRunAtMs(job, endedAt);
        const backoffNext = endedAt + backoff;
        job.state.nextRunAtMs =
          normalNext !== undefined ? Math.max(normalNext, backoffNext) : backoffNext;
      } else if (job.enabled) {
        job.state.nextRunAtMs = computeJobNextRunAtMs(job, endedAt);
      } else {
        job.state.nextRunAtMs = undefined;
      }
    }

    emit(state, {
      jobId: job.id,
      action: "finished",
      status,
      error: err,
      summary,
      sessionId: session?.sessionId,
      sessionKey: session?.sessionKey,
      runAtMs: startedAt,
      durationMs: job.state.lastDurationMs,
      nextRunAtMs: job.state.nextRunAtMs,
    });

    if (shouldDelete && state.store) {
      state.store.jobs = state.store.jobs.filter((j) => j.id !== job.id);
      deleted = true;
      emit(state, { jobId: job.id, action: "removed" });
    }
  };

  try {
    const result = await executeJobCore(state, job);
    await finish(result.status, result.error, result.summary, {
      sessionId: result.sessionId,
      sessionKey: result.sessionKey,
    });
  } catch (err) {
    await finish("error", String(err));
  } finally {
    job.updatedAtMs = nowMs;
    if (!opts.forced && job.enabled && !deleted) {
      job.state.nextRunAtMs = computeJobNextRunAtMs(job, state.deps.nowMs());
    }
  }
}

export function wake(
  state: CronServiceState,
  opts: { mode: "now" | "next-heartbeat"; text: string },
) {
  const text = opts.text.trim();
  if (!text) {
    return { ok: false } as const;
  }
  state.deps.enqueueSystemEvent(text);
  if (opts.mode === "now") {
    state.deps.requestHeartbeatNow({ reason: "wake" });
  }
  return { ok: true } as const;
}

export function stopTimer(state: CronServiceState) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
}

export function emit(state: CronServiceState, evt: CronEvent) {
  try {
    state.deps.onEvent?.(evt);
  } catch {
    /* ignore */
  }
}
