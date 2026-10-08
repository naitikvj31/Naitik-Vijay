/* ==========================================================================
   NaiGrowth — UI behaviour
   Navigation, smooth scroll, scroll reveals, stat counters, FAQ accordion
   and the scroll-progress signal the hero scene consumes.

   Every module here is independent and returns a teardown, so the page keeps
   working if any one of them is removed.
   ========================================================================== */

import { RULES, validateAll } from "./validate.js";

const prefersReduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ==========================================================================
   Smooth scroll
   There is deliberately no JS here any more.

   This used to run Lenis: it swallowed every wheel event and re-emitted the
   page position through its own easing on a permanent rAF loop. Two things
   came out of that. The scroll never matched the trackpad, so the page felt
   like it was floating a beat behind the finger, and because Lenis drives
   `window` while `body` still carried `overflow-x: hidden` (which makes the
   body its own scroll container) the two disagreed about who owned the
   scroll position and the page would snap back toward the top mid-gesture.

   Native scrolling has none of that. It is 1:1 with the input device, keeps
   real momentum, keeps the scrollbar honest, and costs no main-thread time.
   Anchor jumps are handled in CSS by `scroll-behavior: smooth` plus
   `scroll-padding-top`, which also keeps the browser's own focus handling
   intact — something the old click handler had to reimplement by hand.

   What is left is the one scroll a visitor actually asks for: a click on an
   in-page link. `scroll-behavior` in CSS cannot be used for it, because it
   would also animate the scrolls the BROWSER starts on its own, and an
   animated scroll restoration after a reload looks exactly like the page
   sliding back to the top on its own. So the easing lives here, on a click
   handler, where nothing but a deliberate press can reach it.
   ========================================================================== */

export function initSmoothScroll() {
  function onClick(e) {
    // Let the browser handle modified clicks: new tab, download, and so on.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }

    const link = e.target.closest('a[href^="#"]');
    if (!link) return;

    const hash = link.getAttribute("href");
    if (!hash || hash === "#") return;

    let target;
    try {
      target = document.querySelector(hash);
    } catch {
      return; // not a valid selector, let the browser try
    }
    if (!target) return;

    e.preventDefault();
    target.scrollIntoView({
      behavior: prefersReduced() ? "auto" : "smooth",
      block: "start",
    });

    /* preventDefault also cancels the browser's own fragment handling, which
       is what moves keyboard focus into the target. Put it back, or the skip
       link does nothing for the only people who use it. Sections are not
       focusable by default, so give the target a programmatic-only tab stop. */
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });

    // Keep the URL shareable without re-triggering the jump we just handled.
    if (history.replaceState) history.replaceState(null, "", hash);
  }

  document.addEventListener("click", onClick);
  return {
    destroy() {
      document.removeEventListener("click", onClick);
    },
  };
}

/* ==========================================================================
   Navigation
   Condenses on scroll, hides on scroll-down / reveals on scroll-up, marks the
   section currently in view, and drives the mobile drawer.
   ========================================================================== */

export function initNav() {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return null;

  const toggle = nav.querySelector("[data-nav-toggle]");
  const drawer = nav.querySelector("[data-nav-drawer]");
  const links = Array.from(nav.querySelectorAll('a[href^="#"]'));

  let lastY = window.scrollY;
  let ticking = false;

  function update() {
    ticking = false;
    const y = window.scrollY;

    nav.classList.toggle("nav--scrolled", y > 24);

    // Never hide while the drawer is open, or the menu would vanish mid-use.
    const open = drawer && drawer.dataset.open === "true";
    const goingDown = y > lastY && y > 320;
    nav.classList.toggle("nav--hidden", goingDown && !open);

    lastY = y;
  }

  function onScroll() {
    // rAF-coalesced: at most one layout-class write per frame regardless of
    // how many scroll events the browser emits.
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }

  function closeDrawer() {
    if (!drawer || !toggle) return;
    drawer.dataset.open = "false";
    toggle.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  function onToggle() {
    if (!drawer || !toggle) return;
    const open = drawer.dataset.open === "true";
    drawer.dataset.open = open ? "false" : "true";
    toggle.setAttribute("aria-expanded", String(!open));
    document.body.style.overflow = open ? "" : "hidden";
  }

  function onDrawerClick(e) {
    if (e.target.closest("a")) closeDrawer();
  }

  function onKey(e) {
    if (e.key === "Escape") closeDrawer();
  }

  if (toggle) toggle.addEventListener("click", onToggle);
  if (drawer) drawer.addEventListener("click", onDrawerClick);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onScroll, { passive: true });
  update();

  /* Scroll-spy. An observer per section is cheaper and smoother than
     recomputing offsets on every scroll event. */
  const sections = links
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = `#${entry.target.id}`;
        for (const a of links) {
          a.toggleAttribute("aria-current", a.getAttribute("href") === id);
        }
      }
    },
    // Trigger when a section crosses the upper third of the viewport.
    { rootMargin: "-30% 0px -60% 0px", threshold: 0 }
  );
  sections.forEach((s) => spy.observe(s));

  return {
    destroy() {
      if (toggle) toggle.removeEventListener("click", onToggle);
      if (drawer) drawer.removeEventListener("click", onDrawerClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
      spy.disconnect();
    },
  };
}

/* ==========================================================================
   Scroll reveals
   Adds a class once, then stops observing. Content is visible in the DOM from
   first byte — this only animates its arrival.
   ========================================================================== */

export function initReveals(selector = "[data-reveal]") {
  const nodes = Array.from(document.querySelectorAll(selector));
  if (!nodes.length) return null;

  if (prefersReduced() || !("IntersectionObserver" in window)) {
    nodes.forEach((n) => n.classList.add("is-revealed"));
    return null;
  }

  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        // Optional per-element stagger, declared in markup.
        const delay = parseInt(el.dataset.revealDelay || "0", 10);
        if (delay) el.style.transitionDelay = `${delay}ms`;
        el.classList.add("is-revealed");
        obs.unobserve(el);
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
  );

  nodes.forEach((n) => io.observe(n));
  return { destroy: () => io.disconnect() };
}

/* ==========================================================================
   Stat counters
   Counts to [data-count-to] when the number scrolls into view. The final
   value is already in the markup, so crawlers and no-JS readers see the real
   figure; this only replaces it briefly while animating.
   ========================================================================== */

export function initCounters(selector = "[data-count-to]") {
  const nodes = Array.from(document.querySelectorAll(selector));
  if (!nodes.length) return null;

  if (prefersReduced() || !("IntersectionObserver" in window)) return null;

  const format = (n) => n.toLocaleString("en-US");

  function run(el) {
    const to = parseFloat(el.dataset.countTo || "0");
    const suffix = el.dataset.countSuffix || "";
    const duration = parseInt(el.dataset.countDuration || "1600", 10);
    const start = performance.now();

    function step(now) {
      const p = Math.min(1, (now - start) / duration);
      // easeOutExpo — fast out of the gate, long gentle settle.
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      el.textContent = format(Math.round(to * eased)) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        run(entry.target);
        obs.unobserve(entry.target);
      }
    },
    { threshold: 0.5 }
  );

  nodes.forEach((n) => io.observe(n));
  return { destroy: () => io.disconnect() };
}

/* ==========================================================================
   FAQ accordion
   Answers stay in the DOM at all times (the panel animates via
   grid-template-rows), so FAQPage structured data always matches what is
   rendered — which is what Google requires for the rich result.
   ========================================================================== */

export function initFaq(selector = "[data-faq]") {
  const root = document.querySelector(selector);
  if (!root) return null;

  function onClick(e) {
    const btn = e.target.closest("[data-faq-q]");
    if (!btn || !root.contains(btn)) return;

    const item = btn.closest("[data-faq-item]");
    if (!item) return;

    const open = item.dataset.open === "true";

    // Single-open accordion: collapse siblings first.
    for (const other of root.querySelectorAll('[data-faq-item][data-open="true"]')) {
      if (other === item) continue;
      other.dataset.open = "false";
      const q = other.querySelector("[data-faq-q]");
      if (q) q.setAttribute("aria-expanded", "false");
    }

    item.dataset.open = open ? "false" : "true";
    btn.setAttribute("aria-expanded", String(!open));
  }

  root.addEventListener("click", onClick);
  return { destroy: () => root.removeEventListener("click", onClick) };
}

/* ==========================================================================
   Hero scroll progress
   Reports 0 -> 1 as the hero scrolls out, and a normalised pointer position,
   both consumed by the WebGL camera. Pointer events are rAF-coalesced so a
   high-rate mouse cannot outpace the renderer.
   ========================================================================== */

export function initHeroDriver(heroEl, scene) {
  if (!heroEl || !scene) return null;

  let pending = false;
  let px = 0;
  let py = 0;

  function pushScroll() {
    const rect = heroEl.getBoundingClientRect();
    const total = rect.height || 1;
    const progress = Math.min(1, Math.max(0, -rect.top / total));
    scene.setScroll(progress);
  }

  function onScroll() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      pushScroll();
    });
  }

  function onPointer(e) {
    // -1..1 across the viewport, y inverted so "up" raises the camera.
    px = (e.clientX / window.innerWidth) * 2 - 1;
    py = -((e.clientY / window.innerHeight) * 2 - 1);
    scene.setPointer(px, py);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  if (window.matchMedia("(pointer: fine)").matches) {
    window.addEventListener("pointermove", onPointer, { passive: true });
  }
  pushScroll();

  return {
    destroy() {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("pointermove", onPointer);
    },
  };
}

/* ==========================================================================
   Orbit toggle
   Opt-in drag-to-orbit. Off by default so a drag is never stolen from the
   page scroll; while on, the canvas accepts pointer events.
   ========================================================================== */

export function initOrbit(toggleEl, canvasEl, scene) {
  if (!toggleEl || !canvasEl || !scene) return null;

  let on = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;
  let ox = 0;
  let oy = 0;

  function setOn(next) {
    on = next;
    toggleEl.setAttribute("aria-pressed", String(on));
    scene.orbitEnabled = on;
    canvasEl.style.pointerEvents = on ? "auto" : "none";
    canvasEl.style.cursor = on ? "grab" : "";
    if (!on) {
      ox = 0;
      oy = 0;
      scene.setOrbit(0, 0);
    }
  }

  function onToggle() {
    setOn(!on);
  }

  function onDown(e) {
    if (!on) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    baseX = ox;
    baseY = oy;
    canvasEl.setPointerCapture(e.pointerId);
    canvasEl.style.cursor = "grabbing";
  }

  function onMove(e) {
    if (!dragging) return;
    ox = baseX + ((e.clientX - startX) / window.innerWidth) * 3.2;
    oy = baseY - ((e.clientY - startY) / window.innerHeight) * 2.0;
    scene.setOrbit(ox, oy);
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    if (canvasEl.hasPointerCapture(e.pointerId)) {
      canvasEl.releasePointerCapture(e.pointerId);
    }
    canvasEl.style.cursor = on ? "grab" : "";
  }

  toggleEl.addEventListener("click", onToggle);
  canvasEl.addEventListener("pointerdown", onDown);
  canvasEl.addEventListener("pointermove", onMove, { passive: true });
  canvasEl.addEventListener("pointerup", onUp);
  canvasEl.addEventListener("pointercancel", onUp);
  setOn(false);

  return {
    destroy() {
      toggleEl.removeEventListener("click", onToggle);
      canvasEl.removeEventListener("pointerdown", onDown);
      canvasEl.removeEventListener("pointermove", onMove);
      canvasEl.removeEventListener("pointerup", onUp);
      canvasEl.removeEventListener("pointercancel", onUp);
    },
  };
}

/* ==========================================================================
   Contact form
   Progressive enhancement over the existing /api/contact endpoint: the form
   posts normally without JS, and asynchronously with it.
   ========================================================================== */

export function initContactForm(selector = "[data-contact-form]") {
  const form = document.querySelector(selector);
  if (!form) return null;

  const status = form.querySelector("[data-form-status]");
  const submit = form.querySelector('button[type="submit"]');

  /* The endpoint's time-trap rejects submissions with no timestamp or one
     under two seconds old. Stamping it here (rather than in markup) is what
     makes it a bot filter: a direct POST never runs this. */
  const stamp = form.querySelector('input[name="fts"]');
  if (stamp) stamp.value = String(Date.now());

  /* ------------------------------------------------------------------
     Per-field validation.
     The rules live in ./validate.js and the server applies the identical
     set, so a field can never pass here and fail there (or the reverse).
     ------------------------------------------------------------------ */

  const fields = Object.keys(RULES)
    .map((name) => ({
      name,
      input: form.elements[name],
      error: form.querySelector(`[data-error-for="${name}"]`),
    }))
    .filter((f) => f.input);

  function showError(field, message) {
    if (message) {
      field.input.setAttribute("aria-invalid", "true");
      if (field.error) field.error.textContent = message;
    } else {
      field.input.removeAttribute("aria-invalid");
      if (field.error) field.error.textContent = "";
    }
  }

  function check(field) {
    const message = RULES[field.name](field.input.value);
    showError(field, message);
    return message;
  }

  /* Validate on blur, not on every keystroke: flagging an address as invalid
     while someone is still halfway through typing it is just noise. */
  function onBlur(e) {
    const field = fields.find((f) => f.input === e.target);
    if (field) check(field);
  }

  /* Clear a field's error as soon as the visitor starts fixing it. */
  function onInput(e) {
    const field = fields.find((f) => f.input === e.target);
    if (field && field.input.getAttribute("aria-invalid") === "true") {
      if (!RULES[field.name](field.input.value)) showError(field, null);
    }
  }

  for (const field of fields) {
    field.input.addEventListener("blur", onBlur);
    field.input.addEventListener("input", onInput);
    if (field.input.tagName === "SELECT") {
      field.input.addEventListener("change", onInput);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();

    /* The form carries `novalidate` so we can style our own messaging, which
       also means nothing stops a bad submit reaching the endpoint and bouncing
       back as a 400. Run every rule, mark each failing field, and put the
       visitor on the first one. */
    const values = Object.fromEntries(new FormData(form));
    const errors = validateAll(values);
    const failing = fields.filter((f) => errors[f.name]);

    for (const field of fields) showError(field, errors[field.name] || null);

    if (failing.length) {
      failing[0].input.focus({ preventScroll: false });
      if (status) {
        status.hidden = false;
        status.dataset.state = "error";
        status.textContent =
          failing.length === 1
            ? errors[failing[0].name]
            : `Please check ${failing.length} fields above before sending.`;
      }
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.dataset.label = submit.textContent;
      submit.textContent = "Sending…";
    }
    if (status) {
      status.hidden = false;
      status.textContent = "Sending your enquiry…";
      status.dataset.state = "pending";
    }

    try {
      const res = await fetch(form.action || "/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      form.reset();
      for (const field of fields) showError(field, null);
      if (stamp) stamp.value = String(Date.now());
      if (status) {
        status.textContent =
          "Thanks — your enquiry is in. We reply to every message within one business day.";
        status.dataset.state = "ok";
      }
    } catch (err) {
      if (status) {
        status.textContent =
          "That did not send. Please email admin@naigrowth.com or message us on WhatsApp and we will pick it up right away.";
        status.dataset.state = "error";
      }
      console.warn("[contact]", err);
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submit.dataset.label || "Send enquiry";
      }
    }
  }

  form.addEventListener("submit", onSubmit);
  return { destroy: () => form.removeEventListener("submit", onSubmit) };
}

/* ==========================================================================
   Page-one panel
   Flips the hero's search results between the before and after states. Both
   lists are in the DOM at all times, so the content is there without JS and
   the switch only toggles which one is hidden.
   ========================================================================== */

export function initSerp(selector = "[data-serp]") {
  const panel = document.querySelector(selector);
  if (!panel) return null;

  const buttons = Array.from(panel.querySelectorAll("[data-serp-state]"));
  const lists = Array.from(panel.querySelectorAll("[data-serp-list]"));
  if (!buttons.length || !lists.length) return null;

  function show(state) {
    for (const list of lists) list.hidden = list.dataset.state !== state;
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.serpState === state));
    }
  }

  function onClick(e) {
    const button = e.target.closest("[data-serp-state]");
    if (button) show(button.dataset.serpState);
  }

  panel.addEventListener("click", onClick);
  show("before");

  return {
    show,
    destroy() {
      panel.removeEventListener("click", onClick);
    },
  };
}
