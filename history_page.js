"use strict";

/* History page: Week / Month / All filter, totals, table of past trips. */

const PERIODS = [["Week", "week"], ["Month", "month"], ["All", "all"]];

function formatHoursMinutes(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatDay(day) {
  return day.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }).replace(",", "");
}

class HistoryPage {
  constructor(root, { store }) {
    this.store = store;
    this.period = "week";

    this.filterButtons = PERIODS.map(([label, period]) =>
      h("button", { class: "seg-button", onclick: () => this.setPeriod(period) }, label));

    this.tripCount = h("div", { class: "total-value" }, NO_VALUE);
    this.distance = h("div", { class: "total-value" }, NO_VALUE);
    this.avgScore = h("div", { class: "total-value" }, NO_VALUE);
    const total = (caption, value) => h("div", { class: "total" }, h("div", { class: "label" }, caption), value);

    this.table = makeTable(["Date", "Distance", "Time", "L/100", "Score"], "1.4fr 1.2fr 0.9fr 0.9fr 0.8fr");
    this.empty = h("div", { class: "muted-text" }, "No trips in this period.");

    root.append(
      h("div", { class: "filters" }, this.filterButtons),
      h("div", { class: "panel totals" },
        total("Trips", this.tripCount), total("Distance", this.distance), total("Avg score", this.avgScore)),
      h("div", { class: "panel table-panel" }, this.table, this.empty),
    );
    this.refresh();
  }

  setPeriod(period) {
    this.period = period;
    this.refresh();
  }

  /** Called when the page is shown, to pick up trips saved since it was last open. */
  update() {}

  show() {
    this.refresh();
  }

  refresh() {
    PERIODS.forEach(([, period], index) => {
      this.filterButtons[index].classList.toggle("active", period === this.period);
    });
    const trips = this.store.trips(this.period);
    this.table.hidden = trips.length === 0;
    this.empty.hidden = trips.length > 0;
    fillTable(this.table, trips.map((trip) => [
      formatDay(trip.day),
      trip.distanceKm.toFixed(1) + " km",
      formatHoursMinutes(trip.durationS),
      trip.lPer100km === null ? NO_VALUE : trip.lPer100km.toFixed(1),
      String(trip.score),
    ]));
    this.tripCount.textContent = String(trips.length);
    this.distance.textContent = trips.reduce((sum, t) => sum + t.distanceKm, 0).toFixed(1) + " km";
    this.avgScore.textContent = trips.length
      ? String(Math.round(trips.reduce((sum, t) => sum + t.score, 0) / trips.length))
      : NO_VALUE;
  }
}
