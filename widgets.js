"use strict";

/* Small helpers shared by the pages. Web counterpart of widgets.py. */

const NO_VALUE = "--";

/** Creates an element: h("div", {class: "panel"}, child, ...). Props starting with "on" are listeners. */
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === "class") element.className = value;
    else if (name.startsWith("on")) element.addEventListener(name.slice(2), value);
    else element.setAttribute(name, value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined) element.append(child);
  }
  return element;
}

function formatDuration(seconds) {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** CSS class that colors text for a connection state from telemetry. */
function stateClass(state) {
  if (state === CONNECTED) return "state-connected";
  if (state === NO_FIX) return "state-warning";
  return "state-muted";
}

/** Table with a header row. `rows` are arrays of cell texts; `cellClasses` (optional)
 *  are arrays of extra classes with the same shape. */
function fillTable(table, rows, cellClasses = []) {
  const body = table.querySelector(".table-body");
  body.replaceChildren(
    ...rows.map((row, r) =>
      h("div", { class: "table-row" },
        row.map((text, c) => h("div", { class: "cell " + ((cellClasses[r] || [])[c] || "") }, text))),
    ),
  );
}

function makeTable(headers, columns) {
  return h("div", { class: "table", style: `--columns: ${columns}` },
    h("div", { class: "table-header" }, headers.map((text) => h("div", { class: "cell" }, text))),
    h("div", { class: "table-body" }),
  );
}
