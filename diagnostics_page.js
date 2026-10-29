"use strict";

/* Diagnostics page: live OBD-II parameters and whether the car supports them. */

function formatParameter(parameter) {
  if (!parameter.supported || parameter.value === null) return "not available";
  const decimals = parameter.unit === "L/h" ? 1 : 0;
  return `${parameter.value.toFixed(decimals)} ${parameter.unit}`;
}

class DiagnosticsPage {
  constructor(root) {
    this.table = makeTable(["Parameter", "Value", "Status"], "2fr 1.3fr 1.3fr");
    this.message = h("div", { class: "muted-text" }, "OBD adapter not connected.");
    root.append(h("div", { class: "panel table-panel" }, this.table, this.message));
    this.update({ parameters: [] });
  }

  update(snap) {
    const parameters = snap.parameters;
    this.table.hidden = parameters.length === 0;
    this.message.hidden = parameters.length > 0;
    fillTable(
      this.table,
      parameters.map((p) => [p.name, formatParameter(p), p.supported ? "Supported" : "Not supported"]),
      parameters.map((p) => [
        "",
        p.supported && p.value !== null ? "" : "muted",
        "small " + (p.supported ? "state-connected" : "muted"),
      ]),
    );
  }
}
