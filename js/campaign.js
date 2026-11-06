/* ==========================================================================
   NaiGrowth — Diwali 2026 campaign

   TEMPORARY, and it retires itself. Once END has passed this script stops
   showing the announcement bar and hides the #diwali band, so the worst case
   if nobody cleans up is a stale block of markup nobody is served, rather
   than a festive offer still being advertised in February.

   Loaded as a BLOCKING classic script in <head>, immediately after
   js/theme.js, for two reasons:

     1. The bar is fixed above the navigation and the two page headers pad
        themselves by its height. Deciding that after first paint would move
        the whole page down a notch in front of the visitor.
     2. The lamp switch below calls window.NaiGrowthTheme, which theme.js
        defines. Script order in the head is the dependency.

   Nothing here is a module and nothing is inlined: the CSP is
   script-src 'self' with no unsafe-inline, and the test suite asserts that
   no page carries an inline script block.
   ========================================================================== */

(function () {
  "use strict";

  /* The offer window. Both dates carry +05:30 explicitly: a bare date string
     is parsed as UTC, which would have retired the campaign five and a half
     hours early for everyone reading it in India. */
  var END = new Date("2026-11-30T23:59:59+05:30");
  var KEY = "naigrowth-promo-diwali-2026";

  var root = document.documentElement;
  var now = new Date();
  var live = now <= END;

  function dismissed() {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch (err) {
      /* Private mode, or storage blocked. Show the bar; it stays dismissable
         for this page view, it just will not remember. */
      return false;
    }
  }

  /* --- Pre-paint ---------------------------------------------------------
     Two attributes, read by css/campaign.css. The bar and the band are both
     absent from the page until this runs, which is also the no-JavaScript
     state: the announcement bar is a dismissable overlay, and an overlay
     that cannot be dismissed should not appear at all. */
  if (!live) {
    root.setAttribute("data-campaign", "over");
  } else if (!dismissed()) {
    root.setAttribute("data-promo", "on");
  }

  if (!live) return;

  /* --- Days remaining ----------------------------------------------------
     Rendered as whole days and only while the number is still useful. The
     markup carries the closing date on its own, so if this never runs the
     sentence still reads correctly. */
  function daysLeft() {
    var ms = END - new Date();
    if (ms <= 0) return 0;
    return Math.ceil(ms / 86400000);
  }

  function fillCountdown() {
    var slots = document.querySelectorAll("[data-diwali-days]");
    var d = daysLeft();
    if (!slots.length || d < 1 || d > 60) return;

    var text = d === 1 ? ", closing tomorrow" : ", " + d + " days left";
    for (var i = 0; i < slots.length; i += 1) {
      /* textContent, never innerHTML: the admin audit bans HTML sinks and a
         number has no business being parsed as markup. */
      slots[i].textContent = text;
    }
  }

  /* --- Dismiss ----------------------------------------------------------- */
  function closeBar() {
    root.removeAttribute("data-promo");
    try {
      localStorage.setItem(KEY, "1");
    } catch (err) {
      /* Not fatal. The bar is gone for this page view either way. */
    }
  }

  /* --- The lamp switch ---------------------------------------------------
     The gold scheme already exists in tokens.css and is already AA-measured,
     so the festive version of the whole site costs one attribute. It stays
     opt-in: light is the site's deliberate default and repainting it for
     every visitor is a bigger decision than a campaign band. */
  var LABEL_ON = "Light the lamps";
  var LABEL_OFF = "Dim the lamps";

  function theme() {
    if (window.NaiGrowthTheme && window.NaiGrowthTheme.get) {
      return window.NaiGrowthTheme.get();
    }
    return root.getAttribute("data-theme") || "light";
  }

  function syncToggles() {
    var gold = theme() === "gold";
    var buttons = document.querySelectorAll("[data-lamp-toggle]");

    for (var i = 0; i < buttons.length; i += 1) {
      var label = buttons[i].querySelector("[data-lamp-label]");
      if (label) label.textContent = gold ? LABEL_OFF : LABEL_ON;
      /* A two-state control, unlike the navigation's three-way cycle, so
         aria-pressed is the honest attribute here. */
      buttons[i].setAttribute("aria-pressed", gold ? "true" : "false");
    }
  }

  function toggleLamps() {
    if (!window.NaiGrowthTheme || !window.NaiGrowthTheme.set) return;
    window.NaiGrowthTheme.set(theme() === "gold" ? "light" : "gold");
    syncToggles();
  }

  function onClick(event) {
    if (!event.target.closest) return;

    if (event.target.closest("[data-promo-close]")) {
      closeBar();
      return;
    }

    if (event.target.closest("[data-lamp-toggle]")) {
      toggleLamps();
    }
  }

  function wire() {
    document.addEventListener("click", onClick);
    fillCountdown();
    syncToggles();

    /* The navigation's own theme cycle can reach gold without going through
       the lamp switch, and then the switch would be offering to light lamps
       that are already lit. theme.js stamps data-theme-name on every change,
       so one observer keeps the label honest. */
    if (window.MutationObserver) {
      new MutationObserver(syncToggles).observe(root, {
        attributes: true,
        attributeFilter: ["data-theme-name"],
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
