"use strict";

/* Makes the app fill the whole iPhone screen, and says what sizes the phone reports.
 *
 * In a Home Screen app on iPhone the page can be told it is shorter than the screen (by the height of
 * the status bar area), which leaves a strip under the bottom buttons. When that happens the app is
 * given the screen's own height instead. Only for iPhone Home Screen apps in portrait: Safari shows the
 * flag `navigator.standalone` only there.
 */

// Change this on every update that is pushed, so Settings shows which version the phone is running.
const APP_VERSION = "v7";

const MIN_MISSING_PX = 20;  // the page is shorter than the screen by more than this...
const MAX_MISSING_PX = 80;  // ...but by less than this (about a status bar), or it is left alone

function fitToScreen() {
  const app = document.getElementById("app");
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const missing = full - window.innerHeight;
  const homeScreenApp = navigator.standalone === true;
  if (homeScreenApp && portrait && missing > MIN_MISSING_PX && missing < MAX_MISSING_PX) {
    app.style.height = full + "px";
  } else {
    app.style.height = "";
  }
}

/** One line for the Settings page: version, window and screen sizes, the app's height, safe-area margins. */
function describeScreen() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const insets = `${style.paddingTop}/${style.paddingBottom}`;
  probe.remove();
  const appHeight = Math.round(document.getElementById("app").getBoundingClientRect().height);
  return `${APP_VERSION} · window ${innerWidth}x${innerHeight} · screen ${screen.width}x${screen.height} · app ${appHeight} · margins ${insets}`;
}
