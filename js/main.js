/* ==========================================================================
   NaiGrowth — Entry point
   Boots UI behaviour immediately, then lazy-loads the WebGL hero so the
   shader never competes with the LCP text for bandwidth or main-thread time.
   ========================================================================== */

import {
  initSmoothScroll,
  initNav,
  initReveals,
  initCounters,
  initFaq,
  initHeroDriver,
  initOrbit,
  initContactForm,
  initSerp,
} from "./modules/ui.js";
import { initCursor } from "./modules/cursor.js";

/* --- Cheap, text-facing behaviour first ---------------------------------- */

initSmoothScroll();
initNav();
initReveals();
initCounters();
initFaq();
initContactForm();
initSerp();
initCursor();

document.documentElement.classList.add("js-ready");

/* --- Hero scene ----------------------------------------------------------
   Gated three ways before a single byte of shader code is fetched:
     1. the hero must be on screen,
     2. the browser must be idle,
     3. the device must not be in data-saver or very-low-core territory.
   Without WebGL2 the CSS gradient in .scene__fallback simply stays put — it
   is a designed state, not a blank box.
   ========================================================================== */

const heroEl = document.querySelector("[data-hero]");
const sceneEl = document.querySelector("[data-scene]");
const canvasEl = document.querySelector("[data-scene-canvas]");
const orbitEl = document.querySelector("[data-orbit-toggle]");

function deviceCanAfford3D() {
  const conn = navigator.connection;
  if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ""))) {
    return false;
  }
  if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 2) {
    return false;
  }
  if (typeof navigator.deviceMemory === "number" && navigator.deviceMemory < 2) {
    return false;
  }
  return true;
}

const whenIdle =
  window.requestIdleCallback || ((fn) => setTimeout(() => fn(), 180));

async function bootScene() {
  if (!canvasEl || !sceneEl || !deviceCanAfford3D()) return;

  let scene;
  try {
    const { createNebula } = await import("./gl/nebula.js");
    scene = createNebula(canvasEl);
  } catch (err) {
    console.warn("[hero] scene unavailable, keeping gradient:", err);
    return;
  }

  if (!scene.supported) return;

  scene.start();
  // Cross-fades the CSS gradient out from under the live canvas.
  sceneEl.classList.add("scene--live");

  initHeroDriver(heroEl, scene);
  if (orbitEl) {
    orbitEl.hidden = false;
    initOrbit(orbitEl, canvasEl, scene);
  }

  /* Stop rendering whenever the scene cannot be seen: off-screen, or the tab
     is in the background. This is the single biggest battery win. */
  let onScreen = true;

  const vis = new IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting;
      if (onScreen && !document.hidden) scene.start();
      else scene.stop();
    },
    { threshold: 0 }
  );
  vis.observe(sceneEl);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) scene.stop();
    else if (onScreen) scene.start();
  });

  // Dropped GPU contexts (tab suspension, driver reset) must not leave a
  // frozen canvas sitting over the gradient.
  canvasEl.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    scene.stop();
    sceneEl.classList.remove("scene--live");
  });
}

if (heroEl && sceneEl) {
  const start = new IntersectionObserver(
    (entries, obs) => {
      if (!entries[0].isIntersecting) return;
      obs.disconnect();
      whenIdle(() => bootScene());
    },
    { rootMargin: "200px" }
  );
  start.observe(sceneEl);
}
