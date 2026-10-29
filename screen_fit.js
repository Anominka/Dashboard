"use strict";

/* Fits the bottom bar to the window an iPhone Home Screen app really gets, and says what sizes the
 * phone reports.
 *
 * On some iPhones a Home Screen app is given a window that is shorter than the screen by about the
 * height of the status bar (390x797 on a 390x844 screen) and it ends there: nothing is drawn below it,
 * and what is drawn beyond it is cut off. The window then already ends above the home indicator, so the
 * safe-area margin at the bottom must not be added again, or the bottom buttons float high above the
 * edge. In that case the bottom margin is set to 0. Only for iPhone Home Screen apps in portrait:
 * Safari shows the flag `navigator.standalone` only there.
 */

// Change this on every update that is pushed, so Settings shows which version the phone is running.
const APP_VERSION = "v9";

const MIN_MISSING_PX = 20;  // the window is shorter than the screen by more than this...
const MAX_MISSING_PX = 80;  // ...but by less than this (about a status bar), or it is left alone

/** Sets `--bottom-inset` (see style.css) to 0 when the window ends early; otherwise leaves the phone's own value. */
function fitToScreen() {
  const root = document.documentElement;
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const missing = full - window.innerHeight;
  const homeScreenApp = navigator.standalone === true;
  if (homeScreenApp && portrait && missing > MIN_MISSING_PX && missing < MAX_MISSING_PX) {
    root.style.setProperty("--bottom-inset", "0px");
  } else {
    root.style.removeProperty("--bottom-inset");
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
  const forced = document.documentElement.style.getPropertyValue("--bottom-inset") !== "";
  return `${APP_VERSION} · window ${innerWidth}x${innerHeight} · screen ${screen.width}x${screen.height} · app ${appHeight} · margins ${insets}${forced ? " (bottom ignored)" : ""}`;
}
