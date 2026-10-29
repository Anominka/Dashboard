"use strict";

/* Performance page: status line, 0-100 / 0-50 km/h timers, recent runs. */

const STATUS_TEXT = {
  [WAITING]: "Ready. Come to a stop to arm the timers.",
  [ARMED]: "Armed. Accelerate only when it is safe and legal.",
  [RUNNING]: "Timing...",
  [FINISHED]: "Run complete. Come to a stop to run again.",
};

const TIMER_ORDER = [100, 50]; // top to bottom; each must be in TARGETS_KMH
const RECENT_RUNS_SHOWN = 5;

function formatSeconds(seconds) {
  return seconds === null ? NO_VALUE : seconds.toFixed(1) + " s";
}

function formatWhen(moment, now = new Date()) {
  const startOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOf(now) - startOf(moment)) / 86400000);
  if (days === 0) {
    return "Today " + moment.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  if (days === 1) return "Yesterday";
  return moment.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }).replace(",", "");
}

class PerformancePage {
  constructor(root, { store }) {
    this.store = store;
    this.timer = new AccelerationTimer({
      recentRuns: store.recentRuns(MAX_RECENT_RUNS),
      best: store.bestTimes(),
      onRun: (run) => store.addRun(run),
    });

    this.status = h("div", { class: "status-line" });
    this.timerViews = TIMER_ORDER.map((target) => {
      const time = h("div", { class: "timer-value" }, NO_VALUE);
      const best = h("div", { class: "timer-best" }, "Best --");
      const panel = h("div", { class: "panel timer-panel" },
        h("div", { class: "timer-left" }, h("div", { class: "label" }, `0–${target} km/h`), best),
        time,
      );
      return { target, time, best, panel };
    });

    this.clearButton = h("button", { class: "action-button small", onclick: () => this.clearRuns() }, "Clear runs");
    this.empty = h("div", { class: "muted-text" }, "No runs yet.");
    this.runList = h("div", { class: "run-list" });

    root.append(
      h("div", { class: "panel status-panel" }, this.status),
      ...this.timerViews.map((view) => view.panel),
      h("div", { class: "panel runs-panel" },
        h("div", { class: "panel-header" }, h("div", { class: "label" }, "Recent runs"), this.clearButton),
        this.empty,
        this.runList,
      ),
    );
    this.refresh();
  }

  /** The timer itself is fed by app.js on every reading; this only redraws the page. */
  update() {
    this.refresh();
  }

  clearRuns() {
    this.timer.clear();
    this.store.clearRuns();
    this.refresh();
  }

  refresh() {
    const timer = this.timer;
    this.status.textContent = STATUS_TEXT[timer.state];
    this.clearButton.disabled = !(timer.recentRuns.length || Object.values(timer.best).some((b) => b));
    for (const view of this.timerViews) {
      view.time.textContent = formatSeconds(timer.displaySeconds(view.target));
      view.best.textContent = "Best " + formatSeconds(timer.best[view.target]);
    }
    const runs = timer.recentRuns.slice(0, RECENT_RUNS_SHOWN);
    this.empty.hidden = runs.length > 0;
    this.runList.replaceChildren(
      ...runs.map((run) =>
        h("div", { class: "run-row" },
          h("span", { class: "run-kind" }, `0–${run.targetKmh} km/h`),
          h("span", { class: "run-time" }, formatSeconds(run.seconds)),
          h("span", { class: "run-when" }, formatWhen(run.finishedAt)),
        )),
    );
  }
}
