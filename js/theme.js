/* ==========================================================================
   NaiGrowth — Theme switch
   Loaded as a BLOCKING classic script in <head>, deliberately: a deferred or
   module script runs after first paint, so a visitor who chose dark would see
   a flash of the light page on every navigation.

   Light is the default. Nothing is inferred from prefers-color-scheme — an
   explicit, remembered choice beats a guess that changes under the visitor
   when their OS flips at sunset.
   ========================================================================== */

(function () {
  "use strict";

  var KEY = "naigrowth-theme";
  /* Light is the default and is represented by the ABSENCE of the attribute,
     so a first paint with no stored choice needs no JS at all. */
  var ORDER = ["light", "dark", "gold"];
  var root = document.documentElement;

  function read() {
    try {
      return localStorage.getItem(KEY);
    } catch (err) {
      /* Private mode, or storage blocked. The page still works. */
      return null;
    }
  }

  var stored = read();
  if (stored === "dark" || stored === "gold") root.setAttribute("data-theme", stored);

  function current() {
    var attr = root.getAttribute("data-theme");
    return ORDER.indexOf(attr) > 0 ? attr : "light";
  }

  function next() {
    return ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length];
  }

  var LABEL = { light: "light", dark: "dark", gold: "gold" };
  var CHROME = { light: "#f6f7fc", dark: "#04050c", gold: "#0b0906" };

  function sync() {
    var theme = current();
    var upcoming = next();
    var buttons = document.querySelectorAll("[data-theme-toggle]");

    for (var i = 0; i < buttons.length; i += 1) {
      /* Three states, so this is a cycling control rather than a two-state
         toggle: aria-pressed would be a lie. The label names what the next
         press does, which is what a screen reader user needs to hear. */
      buttons[i].removeAttribute("aria-pressed");
      buttons[i].setAttribute("data-theme-state", theme);
      buttons[i].setAttribute("aria-label", "Theme: " + LABEL[theme] + ". Switch to " + LABEL[upcoming] + ".");
      /* No `title`: a native tooltip under a custom cursor reads as a glitch,
         and aria-label already carries the same text for assistive tech. */
      buttons[i].removeAttribute("title");
    }

    root.setAttribute("data-theme-name", theme);

    /* The browser chrome on mobile matches the page it frames. */
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", CHROME[theme]);
  }

  function apply(value) {
    /* Suppress every transition for the duration of the swap: letting a few
       hundred declarations ease at once reads as lag, not as polish. */
    root.classList.add("theme-switching");

    if (value === "light") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", value);

    try {
      localStorage.setItem(KEY, value);
    } catch (err) {
      /* Not fatal — the choice simply will not survive the session. */
    }

    sync();

    // Two frames: one for the attribute to land, one for styles to settle.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.classList.remove("theme-switching");
      });
    });
  }

  function onClick(event) {
    var button = event.target.closest && event.target.closest("[data-theme-toggle]");
    if (!button) return;
    apply(next());
  }

  function wire() {
    document.addEventListener("click", onClick);
    sync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  /* Exposed so other modules (and the console) can read the active scheme. */
  window.NaiGrowthTheme = { get: current, set: apply };
})();
