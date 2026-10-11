/* ==========================================================================
   NaiGrowth — Custom cursor + magnetic hover
   A 1:1 dot inside a trailing focus reticle: four ticks around an open centre
   that rotate and lock when the pointer is over something interactive. Any
   word ("Open", "Drag") rides outside it as a chip, so the cursor never
   covers the thing being pointed at. Disabled outright on coarse pointers and
   under prefers-reduced-motion, where it is noise rather than polish.
   ========================================================================== */

const CAN_RUN =
  window.matchMedia("(hover: hover)").matches &&
  window.matchMedia("(pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * @param {object} [opts]
 * @param {string} [opts.hoverSelector] elements that make the ring swell
 * @param {string} [opts.labelAttr]     attribute holding the ring's word
 */
export function initCursor(opts = {}) {
  if (!CAN_RUN) return { enabled: false, destroy() {} };

  const hoverSelector =
    opts.hoverSelector ||
    'a, button, [role="button"], input, textarea, select, summary, [data-cursor]';
  const labelAttr = opts.labelAttr || "data-cursor";
  /* Fields the visitor types into. Over these the custom cursor hides and the
     native caret returns — an I-beam you can place is worth more than a ring. */
  const textSelector =
    'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]';

  function el(tag, cls, attrs) {
    const node = document.createElement(tag);
    node.className = cls;
    for (const k in attrs || {}) node.setAttribute(k, attrs[k]);
    return node;
  }

  const dot = el("div", "cursor-dot", { "aria-hidden": "true" });
  dot.appendChild(el("span", "cursor-dot__shape"));

  /* Four ticks around an open centre rather than a filled disc, so whatever
     the pointer is over stays readable. The frame is a separate element: CSS
     rotates it while JS keeps writing position to the wrapper. */
  const ring = el("div", "cursor-reticle", { "aria-hidden": "true" });
  const frame = el("div", "cursor-reticle__frame");
  for (const side of ["n", "e", "s", "w"]) {
    frame.appendChild(el("span", "cursor-tick", { "data-side": side }));
  }
  ring.appendChild(frame);

  /* The word rides outside the reticle, below and right, as a chip. */
  const labelWrap = el("div", "cursor-label", { "aria-hidden": "true" });
  const label = el("span", "cursor-label__chip");
  labelWrap.appendChild(label);

  document.body.append(dot, ring, labelWrap);

  // Target position (raw pointer) and the ring's lagging position.
  let tx = window.innerWidth / 2;
  let ty = window.innerHeight / 2;
  let rx = tx;
  let ry = ty;
  let raf = 0;
  let ready = false;

  function onMove(e) {
    tx = e.clientX;
    ty = e.clientY;
    if (!ready) {
      ready = true;
      rx = tx;
      ry = ty;
      document.body.classList.add("cursor-ready");
    }
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    // The dot is exact; the ring eases toward it, which reads as weight.
    rx += (tx - rx) * 0.16;
    ry += (ty - ry) * 0.16;
    dot.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    /* The chip tracks the dot, not the lagging reticle: a label that trails
       behind the pointer reads as lag rather than as weight. */
    labelWrap.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    maybeResolveHover();
  }

  /* Hover detection, resolved from the pointer position in the frame loop.

     This used to be two delegated listeners, `pointerover` and `pointerout`
     on `document`. They were elegant — one pair covered content added later
     with no re-binding — and they broke scrolling on this page.

     The symptom: wheel-scrolling past roughly 1700px snapped the page back to
     the top, over and over, in Chrome. Measured frame by frame, the document
     collapsed for exactly one frame — documentElement.scrollHeight went from
     12512 to 900, which is body's `min-height: 100vh` with nothing else
     contributing. With a maximum scroll of zero for that frame the browser
     clamped the position to 0, and the next frame restored the height with
     the scroll already lost.

     It was bisected to this pair and nothing else: disable initCursor and the
     page scrolls; disable any other init and it still jumps; take out just
     these two registrations and it scrolls. A delegated pointerover on
     `document` fires for every element the pointer crosses while the page
     moves underneath it, and on a document this size that is a hit test and a
     `closest()` walk inside the scroll frame.

     Resolving hover from the position we already track costs one
     elementFromPoint at most every fourth frame, and only when the pointer or
     the scroll has actually moved — and it cannot interleave with the
     browser's own scrolling the way a pointer event can. */
  let lastHover = null;
  let lastText = false;
  let scrolling = 0;
  let lastResolvedX = NaN;
  let lastResolvedY = NaN;

  function clearHoverState() {
    lastHover = null;
    lastText = false;
    document.body.classList.remove("cursor-hover", "cursor-label", "cursor-text");
  }

  function resolveHover() {
    const el = document.elementFromPoint(tx, ty);
    const hit = el && el.closest ? el.closest(hoverSelector) : null;
    const text = !!(el && el.closest && el.closest(textSelector));

    // Nothing changed: no class writes, so no style recalculation either.
    if (hit === lastHover && text === lastText) return;
    lastHover = hit;
    lastText = text;

    document.body.classList.toggle("cursor-text", text);
    if (!hit || text) {
      document.body.classList.remove("cursor-hover", "cursor-label");
      return;
    }

    const word = hit.getAttribute(labelAttr);
    document.body.classList.toggle("cursor-label", !!word);
    document.body.classList.toggle("cursor-hover", !word);
    if (word) label.textContent = word;
  }

  function maybeResolveHover() {
    if (!ready) return;

    /* Never while the page is moving. This is the whole fix: a hit test
       interleaved with the browser's own scrolling is what collapsed the
       document, and hover feedback during a scroll is worthless anyway —
       the pointer is not pointing at anything, the page is sliding past it.
       Resolution resumes a beat after the page settles. */
    if (scrolling) return;

    if (tx === lastResolvedX && ty === lastResolvedY) return;
    lastResolvedX = tx;
    lastResolvedY = ty;
    resolveHover();
  }

  function onScrollStart() {
    if (!scrolling) clearHoverState();
    clearTimeout(scrolling);
    // Long enough that a wheel's inertia does not look like a stop.
    scrolling = setTimeout(() => {
      scrolling = 0;
      lastResolvedX = NaN;
      resolveHover();
    }, 140);
  }

  function onDown() {
    document.body.classList.add("cursor-press");
  }

  function onUp() {
    document.body.classList.remove("cursor-press");
  }

  function onLeaveWindow() {
    document.body.classList.remove("cursor-ready", "cursor-press");
    clearHoverState();
  }

  function onEnterWindow() {
    if (ready) document.body.classList.add("cursor-ready");
  }

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("scroll", onScrollStart, { passive: true });
  document.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("blur", onUp);
  document.addEventListener("pointerleave", onLeaveWindow);
  document.addEventListener("pointerenter", onEnterWindow);
  raf = requestAnimationFrame(tick);

  return {
    enabled: true,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScrollStart);
      clearTimeout(scrolling);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onUp);
      document.removeEventListener("pointerleave", onLeaveWindow);
      document.removeEventListener("pointerenter", onEnterWindow);
      dot.remove();
      ring.remove();
      labelWrap.remove();
      document.body.classList.remove(
        "cursor-ready",
        "cursor-hover",
        "cursor-label",
        "cursor-text",
        "cursor-press"
      );
    },
  };
}

/* ==========================================================================
   Magnetic hover
   Elements marked [data-magnetic] drift toward the pointer while it is within
   their padded bounding box, then spring back on leave. The transform is on a
   wrapper, so layout never shifts.
   ========================================================================== */

export function initMagnetic(selector = "[data-magnetic]") {
  if (!CAN_RUN) return { enabled: false, destroy() {} };

  const nodes = Array.from(document.querySelectorAll(selector));
  if (!nodes.length) return { enabled: false, destroy() {} };

  /* One pointer listener and one rAF loop serve every magnet. Rects are
     measured once and re-measured only on scroll/resize, so pointermove never
     forces a synchronous layout. */
  const magnets = nodes.map((el) => ({
    el,
    strength: parseFloat(el.dataset.magneticStrength || "0.34"),
    radius: parseFloat(el.dataset.magneticRadius || "90"),
    rect: null,
    cx: 0,
    cy: 0,
    tx: 0,
    ty: 0,
  }));

  let frame = 0;
  let measureFrame = 0;
  let pointerX = -9999;
  let pointerY = -9999;

  function measure() {
    measureFrame = 0;
    for (const m of magnets) m.rect = m.el.getBoundingClientRect();
  }

  function scheduleMeasure() {
    if (!measureFrame) measureFrame = requestAnimationFrame(measure);
  }

  function animate() {
    let active = false;

    for (const m of magnets) {
      if (m.rect) {
        const cxr = m.rect.left + m.rect.width / 2;
        const cyr = m.rect.top + m.rect.height / 2;
        const dx = pointerX - cxr;
        const dy = pointerY - cyr;
        const dist = Math.hypot(dx, dy);
        const reach = Math.max(m.rect.width, m.rect.height) / 2 + m.radius;

        if (dist > reach) {
          m.tx = 0;
          m.ty = 0;
        } else {
          // Pull falls off toward the edge of reach rather than clipping hard.
          const falloff = 1 - dist / reach;
          m.tx = dx * m.strength * falloff;
          m.ty = dy * m.strength * falloff;
        }
      }

      m.cx += (m.tx - m.cx) * 0.18;
      m.cy += (m.ty - m.cy) * 0.18;

      if (Math.abs(m.tx - m.cx) < 0.05 && Math.abs(m.ty - m.cy) < 0.05) {
        m.cx = m.tx;
        m.cy = m.ty;
      } else {
        active = true;
      }

      m.el.style.transform =
        m.cx === 0 && m.cy === 0
          ? ""
          : `translate3d(${m.cx.toFixed(2)}px, ${m.cy.toFixed(2)}px, 0)`;
    }

    // Idle magnets cost nothing: the loop stops once everything has settled.
    frame = active ? requestAnimationFrame(animate) : 0;
  }

  function kick() {
    if (!frame) frame = requestAnimationFrame(animate);
  }

  function onMove(e) {
    pointerX = e.clientX;
    pointerY = e.clientY;
    kick();
  }

  measure();
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("scroll", scheduleMeasure, { passive: true });
  window.addEventListener("resize", scheduleMeasure, { passive: true });

  return {
    enabled: true,
    remeasure: scheduleMeasure,
    destroy() {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(measureFrame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      for (const m of magnets) m.el.style.transform = "";
    },
  };
}
