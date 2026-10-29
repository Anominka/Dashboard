"use strict";

/* History page: Week / Month / All filter, totals, table of past trips. Tapping a trip opens its
 * route on a map with the trip's numbers. */

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
    this._shown = []; // the trips in the table, in the same order

    this.filterButtons = PERIODS.map(([label, period]) =>
      h("button", { class: "seg-button", onclick: () => this.setPeriod(period) }, label));

    this.tripCount = h("div", { class: "total-value" }, NO_VALUE);
    this.distance = h("div", { class: "total-value" }, NO_VALUE);
    this.avgScore = h("div", { class: "total-value" }, NO_VALUE);
    const total = (caption, value) => h("div", { class: "total" }, h("div", { class: "label" }, caption), value);

    this.table = makeTable(["Date", "Distance", "Time", "L/100", "Score", ""], "1.4fr 1.2fr 0.9fr 0.9fr 0.8fr 0.35fr");
    this.empty = h("div", { class: "muted-text" }, "No trips in this period.");

    this.list = h("div", { class: "history-list" },
      h("div", { class: "filters" }, this.filterButtons),
      h("div", { class: "panel totals" },
        total("Trips", this.tripCount), total("Distance", this.distance), total("Avg score", this.avgScore)),
      h("div", { class: "panel table-panel" }, this.table, this.empty),
    );

    // the detail view of one trip
    this.map = new TripMap();
    this.detailTitle = h("div", { class: "detail-title" });
    this.detailStats = {};
    const stat = (caption) => {
      this.detailStats[caption] = h("div", { class: "stat-value small" }, NO_VALUE);
      return h("div", { class: "stat" }, h("div", { class: "label" }, caption), this.detailStats[caption]);
    };
    this.detail = h("div", { class: "trip-detail", hidden: "" },
      h("div", { class: "detail-header" },
        h("button", { class: "action-button small", onclick: () => this.closeTrip() }, "‹ Back"),
        this.detailTitle),
      this.map.element,
      h("div", { class: "panel stats three" },
        stat("Distance"), stat("Time"), stat("Avg speed"), stat("L/100 km"), stat("Score"), stat("Route")),
    );

    root.append(this.list, this.detail);
    window.addEventListener("resize", () => this._redrawMap());
    this.refresh();
  }

  setPeriod(period) {
    this.period = period;
    this.refresh();
  }

  /** Called on every reading while the page is open; nothing to do. */
  update() {}

  /** Called when the page is shown, to pick up trips saved since it was last open. */
  show() {
    this.refresh();
    this._redrawMap(); // a map drawn while the page was hidden had no size
  }

  _redrawMap() {
    if (!this.detail.hidden) this.map.render();
  }

  openTrip(trip) {
    this.list.hidden = true;
    this.detail.hidden = false;
    this.detailTitle.textContent = formatDay(trip.day);
    const hours = trip.durationS / 3600;
    const route = trip.route || [];
    const stats = this.detailStats;
    stats["Distance"].textContent = trip.distanceKm.toFixed(1) + " km";
    stats["Time"].textContent = formatHoursMinutes(trip.durationS);
    stats["Avg speed"].textContent = hours > 0 ? (trip.distanceKm / hours).toFixed(0) + " km/h" : NO_VALUE;
    stats["L/100 km"].textContent = trip.lPer100km === null ? NO_VALUE : trip.lPer100km.toFixed(1);
    stats["Score"].textContent = String(trip.score);
    stats["Route"].textContent = route.length ? `${route.length} points` : "none";
    this.map.setRoute(route, this.store.settings.mapTiles); // drawn now that the view is on screen
  }

  closeTrip() {
    this.detail.hidden = true;
    this.list.hidden = false;
    this.refresh();
  }

  refresh() {
    PERIODS.forEach(([, period], index) => {
      this.filterButtons[index].classList.toggle("active", period === this.period);
    });
    const trips = this.store.trips(this.period);
    this._shown = trips;
    this.table.hidden = trips.length === 0;
    this.empty.hidden = trips.length > 0;
    fillTable(this.table, trips.map((trip) => [
      formatDay(trip.day),
      trip.distanceKm.toFixed(1) + " km",
      formatHoursMinutes(trip.durationS),
      trip.lPer100km === null ? NO_VALUE : trip.lPer100km.toFixed(1),
      String(trip.score),
      "›",
    ]), [], (index) => this.openTrip(this._shown[index]));
    this.tripCount.textContent = String(trips.length);
    this.distance.textContent = trips.reduce((sum, t) => sum + t.distanceKm, 0).toFixed(1) + " km";
    this.avgScore.textContent = trips.length
      ? String(Math.round(trips.reduce((sum, t) => sum + t.score, 0) / trips.length))
      : NO_VALUE;
  }
}
