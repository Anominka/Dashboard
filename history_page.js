"use strict";

/* History page: Week / Month / All filter, totals, table of past trips. Tapping a trip opens its
 * route on a map right under it (a dropdown); tapping it again, or another trip, closes it. */

const PERIODS = [["Week", "week"], ["Month", "month"], ["All", "all"]];

function formatHoursMinutes(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 29 Oct": always three letters for the weekday and the month, so every date is as wide as the rest. */
function formatDay(day) {
  return `${WEEKDAYS[day.getDay()]} ${String(day.getDate()).padStart(2, "0")} ${MONTHS[day.getMonth()]}`;
}

class HistoryPage {
  constructor(root, { store }) {
    this.store = store;
    this.period = "week";
    this._shown = [];      // the trips in the table, in the same order
    this.openIndex = null; // the trip whose map is open
    this.map = new TripMap();

    this.filterButtons = PERIODS.map(([label, period]) =>
      h("button", { class: "seg-button", onclick: () => this.setPeriod(period) }, label));

    this.tripCount = h("div", { class: "total-value" }, NO_VALUE);
    this.distance = h("div", { class: "total-value" }, NO_VALUE);
    this.avgScore = h("div", { class: "total-value" }, NO_VALUE);
    const total = (caption, value) => h("div", { class: "total" }, h("div", { class: "label" }, caption), value);

    this.table = makeTable(["Date", "Distance", "Time", "L/100", "Score", ""], "1.45fr 1.2fr 0.8fr 0.75fr 0.85fr 0.3fr", "4px");
    this.empty = h("div", { class: "muted-text" }, "No trips in this period.");

    root.append(
      h("div", { class: "filters" }, this.filterButtons),
      h("div", { class: "panel totals" },
        total("Trips", this.tripCount), total("Distance", this.distance), total("Avg score", this.avgScore)),
      h("div", { class: "panel table-panel" }, this.table, this.empty),
    );
    window.addEventListener("resize", () => this._redrawMap());
    this.refresh();
  }

  setPeriod(period) {
    this.period = period;
    this.openIndex = null;
    this.refresh();
  }

  /** Called on every reading while the page is open; nothing to do. */
  update() {}

  /** Called when the page is shown, to pick up trips saved since it was last open. */
  show() {
    this.refresh();
  }

  _redrawMap() {
    if (this.openIndex !== null) this.map.render();
  }

  /** Opens the map under trip number `index` of the table, or closes it if it is the open one. */
  toggleTrip(index) {
    const closing = index === this.openIndex;
    this._closeDrop();
    this.openIndex = closing ? null : index;
    if (!closing) {
      const panel = this._openDrop();
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  _closeDrop() {
    const open = this.table.querySelector(".table-row.open");
    if (open) open.classList.remove("open");
    const panel = this.table.querySelector(".trip-drop");
    if (panel) panel.remove();
  }

  /** Builds the dropdown under the open trip's row and draws the map in it. */
  _openDrop() {
    const trip = this._shown[this.openIndex];
    const row = this.table.querySelectorAll(".table-row")[this.openIndex];
    const route = trip.route || [];
    const hours = trip.durationS / 3600;
    const started = route.length
      ? new Date(route[0][0]).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : NO_VALUE;
    const stat = (caption, value) =>
      h("div", { class: "stat" }, h("div", { class: "label" }, caption), h("div", { class: "stat-value small" }, value));

    const panel = h("div", { class: "trip-drop" },
      this.map.element,
      h("div", { class: "drop-stats" },
        stat("Avg speed", hours > 0 ? (trip.distanceKm / hours).toFixed(0) + " km/h" : NO_VALUE),
        stat("Started", started),
        stat("Route", route.length ? `${route.length} points` : "none"),
      ),
    );
    row.classList.add("open");
    row.after(panel);
    this.map.setRoute(route, this.store.settings.mapTiles); // drawn now that it is on screen
    return panel;
  }

  refresh() {
    PERIODS.forEach(([, period], index) => {
      this.filterButtons[index].classList.toggle("active", period === this.period);
    });
    const trips = this.store.trips(this.period);
    this._shown = trips;
    if (this.openIndex !== null && this.openIndex >= trips.length) this.openIndex = null;
    this.table.hidden = trips.length === 0;
    this.empty.hidden = trips.length > 0;
    fillTable(this.table, trips.map((trip) => [
      formatDay(trip.day),
      trip.distanceKm.toFixed(1) + " km",
      formatHoursMinutes(trip.durationS),
      trip.lPer100km === null ? NO_VALUE : trip.lPer100km.toFixed(1),
      String(trip.score),
      "›",
    ]), [], (index) => this.toggleTrip(index));
    if (this.openIndex !== null) this._openDrop(); // the table was rebuilt: put the open map back
    this.tripCount.textContent = String(trips.length);
    this.distance.textContent = trips.reduce((sum, t) => sum + t.distanceKm, 0).toFixed(1) + " km";
    this.avgScore.textContent = trips.length
      ? String(Math.round(trips.reduce((sum, t) => sum + t.score, 0) / trips.length))
      : NO_VALUE;
  }
}
