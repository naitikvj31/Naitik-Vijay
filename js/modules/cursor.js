/* ==========================================================================
   NaiGrowth — Custom cursor + magnetic hover
   A 1:1 dot and a trailing ring that swells over interactive elements and can
   carry a word ("View", "Drag"). Disabled outright on coarse pointers and
   under prefers-reduced-motion — on those inputs it is noise, not polish.
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

  const dot = document.createElement("div");
  dot.className = "cursor-dot";
  dot.setAttribute("aria-hidden", "true");
  dot.appendChild(Object.assign(document.createElement("span"), {
    className: "cursor-dot__shape",
  }));

  const ring = document.createElement("div");
  ring.className = "cursor-ring";
  ring.setAttribute("aria-hidden", "true");
  ring.appendChild(Object.assign(document.createElement("span"), {
    className: "cursor-ring__shape",
  }));

  const label = document.createElement("span");
  label.className = "cursor-ring__label";
  ring.appendChild(label);

  document.body.append(dot, ring);

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
  }

  /* Delegated hover detection: one listener covers content added later
     (nav drawer, revealed sections) with no re-binding. */
  function onOver(e) {
    if (e.target.closest && e.target.closest(textSelector)) {
      document.body.classList.add("cursor-text");
    }
    const hit = e.target.closest(hoverSelector);
    if (!hit) return;
    const word = hit.getAttribute(labelAttr);
    if (word) {
      label.textContent = word;
      document.body.classList.add("cursor-label");
      document.body.classList.remove("cursor-hover");
    } else {
      document.body.classList.add("cursor-hover");
    }
  }

  function onOut(e) {
    const field = e.target.closest && e.target.closest(textSelector);
    if (field && !(e.relatedTarget && field.contains(e.relatedTarget))) {
      document.body.classList.remove("cursor-text");
    }
    const hit = e.target.closest(hoverSelector);
    if (!hit) return;
    // Ignore moves between descendants of the same target.
    if (e.relatedTarget && hit.contains(e.relatedTarget)) return;
    document.body.classList.remove("cursor-hover", "cursor-label");
  }

  function onDown() {
    document.body.classList.add("cursor-press");
  }

  function onUp() {
    document.body.classList.remove("cursor-press");
  }

  function onLeaveWindow() {
    document.body.classList.remove("cursor-ready", "cursor-press");
  }

  function onEnterWindow() {
    if (ready) document.body.classList.add("cursor-ready");
  }

  window.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerover", onOver, { passive: true });
  document.addEventListener("pointerout", onOut, { passive: true });
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
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onUp);
      document.removeEventListener("pointerleave", onLeaveWindow);
      document.removeEventListener("pointerenter", onEnterWindow);
      dot.remove();
      ring.remove();
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
