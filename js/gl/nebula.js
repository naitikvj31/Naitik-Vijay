/* ==========================================================================
   NaiGrowth — Hero scene ("Nebula")
   A purpose-built WebGL2 renderer for the hero: a glowing plasma sphere, an
   accretion ring of light trails, a parallax starfield and volumetric haze.

   Why not three.js: the scene is entirely procedural — no meshes, no glTF,
   no PBR materials, no loaders — so a scene graph would add ~2 MB of
   un-tree-shakeable payload (there is no bundler in this static build) to
   draw what one fragment shader draws in ~14 KB. The exported interface is
   deliberately generic, so swapping in a mesh renderer later touches only
   this file.

   The canvas is decorative. Every word in the hero lives in the DOM overlay.
   ========================================================================== */

const VERT = `#version 300 es
// One oversized triangle covers the viewport with no index buffer and no
// per-vertex attributes — gl_VertexID is enough.
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2  uRes;       // drawing-buffer size, px
uniform float uTime;      // seconds
uniform vec3  uCamPos;
uniform mat3  uCamMat;    // right / up / forward
uniform float uScroll;    // 0..1 hero scroll progress
uniform float uQuality;   // 1.0 desktop, lower on constrained devices
uniform float uIntro;     // 0..1 first-paint fade-in
uniform vec2  uOffset;    // composition shift, in uv units
uniform float uFocal;     // larger = narrower field of view

out vec4 fragColor;

const float SPHERE_R = 1.26;

/* ---- hashing ---------------------------------------------------------- */

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}

/* ---- value noise + fbm ------------------------------------------------- */

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);           // smoothstep interpolant

  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * noise(p);
    p = p * 2.03 + vec3(11.3, 7.1, 3.7);
    amp *= 0.5;
  }
  return sum;
}

/* ---- palette ----------------------------------------------------------
   Two hues only — electric blue into violet — with a hot white core and a
   restrained ember edge. Matches the brand tokens in tokens.css.          */

vec3 palette(float t) {
  vec3 deep   = vec3(0.055, 0.086, 0.278);  // navy
  vec3 blue   = vec3(0.298, 0.490, 1.000);  // --blue
  vec3 violet = vec3(0.545, 0.361, 0.965);  // --violet
  vec3 purple = vec3(0.659, 0.333, 0.969);  // --purple
  vec3 hot    = vec3(1.000, 0.960, 0.930);

  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(deep, blue, smoothstep(0.00, 0.34, t));
  c = mix(c, violet,  smoothstep(0.30, 0.62, t));
  c = mix(c, purple,  smoothstep(0.58, 0.82, t));
  c = mix(c, hot,     smoothstep(0.84, 1.00, t));
  return c;
}

/* ---- starfield --------------------------------------------------------
   Cells along the ray direction; roughly one in thirty holds a star.      */

float starfield(vec3 rd, float density, float scale) {
  vec3 p = rd * scale;
  vec3 i = floor(p);
  vec3 f = fract(p);

  vec3 h = hash33(i);
  if (h.x < density) return 0.0;

  vec3 centre = vec3(0.5) + (h - 0.5) * 0.66;
  float d = length(f - centre);
  float core = smoothstep(0.34, 0.0, d);
  float twinkle = 0.62 + 0.38 * sin(uTime * 1.15 + h.z * 42.0);
  return core * (0.3 + 0.7 * h.y) * twinkle;
}

/* ---- accretion ring ---------------------------------------------------
   Analytic ray/plane hit on y = 0, banded radially and swept angularly so
   it reads as light trails orbiting the core.                             */

vec3 accretionRing(vec3 ro, vec3 rd) {
  if (abs(rd.y) < 0.0012) return vec3(0.0);

  float t = -ro.y / rd.y;
  if (t <= 0.0) return vec3(0.0);

  vec3 p = ro + rd * t;
  float r = length(p.xz);

  // Band the plane into a disc that starts outside the sphere.
  float inner = smoothstep(1.52, 2.02, r);
  float outer = 1.0 - smoothstep(2.9, 4.1, r);
  float band = inner * outer;
  if (band <= 0.001) return vec3(0.0);

  float ang = atan(p.z, p.x);
  // Differential rotation: inner material sweeps faster than outer.
  float sweep = ang * 2.2 + uTime * (0.62 - 0.1 * r) * 2.1;
  float streak = fbm(vec3(cos(sweep) * 2.0, sin(sweep) * 2.0, r * 1.5), 3);
  streak = pow(smoothstep(0.34, 0.86, streak), 1.7);

  // Fade the disc as it recedes so the far edge does not form a hard rim.
  float depth = 1.0 / (1.0 + t * t * 0.045);

  vec3 col = palette(0.42 + streak * 0.5) * streak * band * depth;
  return col * 0.72;
}

/* ---- the sphere -------------------------------------------------------- */

vec3 plasmaSphere(vec3 ro, vec3 rd, out float alpha, out float hitT) {
  alpha = 0.0;
  hitT = 1e9;

  float b = dot(ro, rd);
  if (b > 0.0) return vec3(0.0);          // sphere is behind the camera

  float c = dot(ro, ro) - SPHERE_R * SPHERE_R;
  float disc = b * b - c;

  /* Antialias the silhouette analytically. The perpendicular distance from the
     sphere centre to the ray is a smooth function across the edge, so one
     fwidth() of it gives exactly the pixel footprint to feather over — far
     cheaper and cleaner than supersampling, and it kills the stair-stepping a
     hard disc test produces. */
  float closest = length(ro - rd * b);
  float aa = max(fwidth(closest), 1e-4);
  alpha = 1.0 - smoothstep(SPHERE_R - aa, SPHERE_R + aa, closest);
  if (alpha <= 0.001) return vec3(0.0);

  // Inside the feathered band disc can dip below zero; clamp so the shading
  // point falls back to the tangent point rather than producing NaN.
  float t = -b - sqrt(max(disc, 0.0));
  if (t < 0.0) { alpha = 0.0; return vec3(0.0); }

  hitT = t;
  vec3 p = ro + rd * t;
  vec3 n = normalize(p);

  int oct = uQuality > 0.75 ? 5 : (uQuality > 0.45 ? 4 : 3);

  // Two counter-drifting noise fields give convecting plasma rather than a
  // single sliding texture.
  float flow = uTime * 0.09;
  float a = fbm(n * 2.35 + vec3(0.0, flow, 0.0), oct);
  float bN = fbm(n * 4.6 - vec3(flow * 1.4, 0.0, flow * 0.7), oct);
  float surface = a * 0.68 + bN * 0.42;

  // Fresnel: grazing angles glow, facing angles stay deep.
  float fres = pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 3.0);

  // Key light sits up and to the right. A real terminator is what makes the
  // sphere read as a lit body rather than a flat glowing disc — so the heat
  // ramp is gated by the shading term instead of being added to it.
  vec3 lightDir = normalize(vec3(0.66, 0.52, 0.46));
  float lambert = clamp(dot(n, lightDir), 0.0, 1.0);
  /* Exponent above 1 pulls the terminator in and keeps the unlit limb dark.
     Near-linear shading plus a generous ambient floor was what made the body
     read as one flat pastel disc rather than as a sphere. */
  float shade = pow(lambert, 1.3);

  // A wider surface coefficient lets the plasma actually reach the hot end of
  // the palette where the noise peaks, instead of sitting in mid-violet.
  float heat = shade * (0.2 + surface * 0.66) + fres * 0.16;
  vec3 col = palette(heat);

  // Veins of hotter material, only on the lit side.
  float veins = smoothstep(0.62, 0.96, surface) * shade;
  col += palette(0.94) * veins * 0.46;

  // Rim light keeps the silhouette crisp against the background haze.
  col += vec3(0.34, 0.48, 1.0) * fres * 0.3;

  // Night side retains a trace of self-illumination so it never goes to pure
  // black against the haze — but only a trace.
  col += palette(0.06) * (1.0 - shade) * 0.22;

  return col;
}

/* ---- main -------------------------------------------------------------- */

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  // Composition: shifting the ray grid moves the subject in frame without
  // moving the camera, so the headline keeps a clear bed on the left while
  // the sphere sits off-centre to the right.
  vec2 suv = uv - uOffset;

  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamMat * vec3(suv, -uFocal));

  vec3 col = vec3(0.0);

  /* Background: drifting volumetric haze, denser toward the core. */
  int hazeOct = uQuality > 0.6 ? 4 : 3;
  float haze = fbm(rd * 2.1 + vec3(uTime * 0.012, uTime * 0.008, 0.0), hazeOct);
  haze = pow(haze, 2.3);
  col += palette(0.12 + haze * 0.42) * haze * 0.5;

  /* Stars across two parallax layers. */
  float near = starfield(rd, 0.972, 118.0);
  float far  = starfield(rd, 0.986, 242.0);
  col += vec3(0.86, 0.91, 1.0) * near * 0.85;
  col += vec3(0.72, 0.80, 1.0) * far * 0.45;

  /* Ring sits behind or in front of the sphere depending on the hit order. */
  float sphereAlpha, sphereT;
  vec3 sphereCol = plasmaSphere(ro, rd, sphereAlpha, sphereT);

  vec3 ring = accretionRing(ro, rd);
  float ringT = (abs(rd.y) < 0.0012) ? 1e9 : -ro.y / rd.y;
  bool ringInFront = ringT > 0.0 && ringT < sphereT;

  if (!ringInFront) col += ring;

  /* Outer corona: a tight atmospheric halo just outside the silhouette. Kept
     narrow and dim — a wide one washes the whole frame to lavender and the
     overlaid headline loses its contrast. */
  float closest = length(ro - rd * dot(ro, rd));
  float corona = exp(-max(closest - SPHERE_R, 0.0) * 5.2);
  col += palette(0.46) * corona * (0.3 + uScroll * 0.14) * (1.0 - sphereAlpha);

  if (sphereAlpha > 0.0) {
    col = mix(col, sphereCol, sphereAlpha);
  }

  if (ringInFront) col += ring;

  /* A faint ember cast from below — the third colour, used once. */
  col += vec3(1.0, 0.54, 0.24) * pow(max(0.0, -rd.y), 3.4) * 0.07;

  /* Grade: ACES-ish shoulder, vignette, then the intro fade. */
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);

  // Vignette uses the unshifted uv so it stays centred on the viewport.
  float vig = 1.0 - 0.42 * dot(uv, uv);
  col *= vig;

  // Dither by a pixel-stable hash to stop banding in the dark falloffs.
  float dither = (hash13(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 255.0;
  col += dither;

  col *= uIntro;

  fragColor = vec4(col, 1.0);
}`;

/* ========================================================================== */

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

function link(gl, vsSrc, fsSrc) {
  const prog = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link failed: ${log}`);
  }
  return prog;
}

/** Build the camera basis (right/up/forward) for a position looking at target. */
function lookAt(pos, target) {
  const fx = target[0] - pos[0];
  const fy = target[1] - pos[1];
  const fz = target[2] - pos[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const f = [fx / fl, fy / fl, fz / fl];

  // right = normalize(cross(forward, worldUp))
  const rx = f[1] * 0 - f[2] * 1;
  const ry = f[2] * 0 - f[0] * 0;
  const rz = f[0] * 1 - f[1] * 0;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const r = [rx / rl, ry / rl, rz / rl];

  // up = cross(right, forward)
  const u = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];

  // Column-major mat3 for GLSL: columns are right, up, -forward.
  return new Float32Array([
    r[0], r[1], r[2],
    u[0], u[1], u[2],
    -f[0], -f[1], -f[2],
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Mount the hero scene on a canvas.
 * @returns {{start:Function, stop:Function, destroy:Function,
 *            setPointer:Function, setScroll:Function, setOrbit:Function,
 *            supported:boolean}}
 */
export function createNebula(canvas, options = {}) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,       // the shader is already smooth; MSAA buys nothing
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
    failIfMajorPerformanceCaveat: false,
  });

  if (!gl) {
    return {
      supported: false,
      start() {},
      stop() {},
      destroy() {},
      setPointer() {},
      setScroll() {},
      setOrbit() {},
    };
  }

  let program;
  try {
    program = link(gl, VERT, FRAG);
  } catch (err) {
    console.warn("[nebula] falling back to CSS gradient:", err.message);
    return {
      supported: false,
      start() {},
      stop() {},
      destroy() {},
      setPointer() {},
      setScroll() {},
      setOrbit() {},
    };
  }

  const u = {
    res: gl.getUniformLocation(program, "uRes"),
    time: gl.getUniformLocation(program, "uTime"),
    camPos: gl.getUniformLocation(program, "uCamPos"),
    camMat: gl.getUniformLocation(program, "uCamMat"),
    scroll: gl.getUniformLocation(program, "uScroll"),
    quality: gl.getUniformLocation(program, "uQuality"),
    intro: gl.getUniformLocation(program, "uIntro"),
    offset: gl.getUniformLocation(program, "uOffset"),
    focal: gl.getUniformLocation(program, "uFocal"),
  };

  const vao = gl.createVertexArray();   // WebGL2 requires a bound VAO to draw

  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- performance guardrails ------------------------------------------
     Resolution scale starts conservative on touch devices and adapts down if
     frames consistently miss the 60 FPS budget. It never adapts back up, so
     the renderer cannot oscillate. */
  const maxDpr = coarse ? 1.25 : 1.5;
  let resScale = coarse ? 0.78 : 1.0;
  let quality = coarse ? 0.45 : 1.0;
  const minScale = 0.5;

  let slowFrames = 0;
  let lastFrame = 0;

  const state = {
    running: false,
    raf: 0,
    t0: performance.now(),
    elapsed: 0,
    intro: 0,
    // pointer: raw target and the smoothed value actually fed to the camera
    px: 0, py: 0, sx: 0, sy: 0,
    scroll: 0, sScroll: 0,
    orbit: false,
    orbitX: 0, orbitY: 0, sOrbitX: 0, sOrbitY: 0,
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr * resScale));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr * resScale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  function frame(now) {
    if (!state.running) return;
    state.raf = requestAnimationFrame(frame);

    // Adaptive downscale: three consecutive slow frames drop resolution once.
    if (lastFrame) {
      const dt = now - lastFrame;
      if (dt > 24) {
        if (++slowFrames >= 3 && resScale > minScale) {
          resScale = Math.max(minScale, resScale - 0.14);
          quality = Math.max(0.3, quality - 0.2);
          slowFrames = 0;
          resize();
        }
      } else {
        slowFrames = 0;
      }
    }
    lastFrame = now;

    resize();
    render((now - state.t0) / 1000);
  }

  function render(time) {
    state.elapsed = time;

    // Critically damped-ish smoothing on every input so nothing snaps.
    state.sx = lerp(state.sx, state.px, 0.055);
    state.sy = lerp(state.sy, state.py, 0.055);
    state.sScroll = lerp(state.sScroll, state.scroll, 0.075);
    state.sOrbitX = lerp(state.sOrbitX, state.orbitX, 0.085);
    state.sOrbitY = lerp(state.sOrbitY, state.orbitY, 0.085);
    state.intro = Math.min(1, state.intro + 0.012);

    const s = state.sScroll;

    /* Scroll-scrubbed camera path: the camera swings around the core and
       climbs as the hero scrolls away, so the sphere is seen from above by
       the time the next section arrives. */
    const azimuth = 0.42 + s * 1.15 + state.sx * 0.34 + state.sOrbitX;
    // Clamped well clear of ±90°: at the pole, forward becomes parallel to
    // world-up and the camera basis degenerates.
    const elevation = Math.max(
      -1.25,
      Math.min(1.25, 0.1 + s * 0.52 + state.sy * 0.22 + state.sOrbitY)
    );
    // Far enough back that the sphere reads as a body in space rather than a
    // wall of light behind the copy.
    const dist = 8.6 + s * 2.4;

    const ce = Math.cos(elevation);
    const camPos = [
      Math.sin(azimuth) * ce * dist,
      Math.sin(elevation) * dist,
      Math.cos(azimuth) * ce * dist,
    ];

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.time, reduced ? 0 : time);
    gl.uniform3f(u.camPos, camPos[0], camPos[1], camPos[2]);
    gl.uniformMatrix3fv(u.camMat, false, lookAt(camPos, [0, 0, 0]));
    gl.uniform1f(u.scroll, s);
    gl.uniform1f(u.quality, quality);
    gl.uniform1f(u.intro, state.intro);

    /* Composition is layout-aware. On a wide screen the copy occupies the
       left half, so the sphere is pushed right and the field of view narrows
       for a more cinematic read. On a narrow screen the copy runs full width,
       so the sphere centres and lifts clear of the text instead. */
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const wide = aspect > 1.05;
    const offX = wide ? 0.42 : 0.0;
    // Portrait: lift the sphere clear of the eyebrow and headline, which run
    // full width there and would otherwise sit on the lit limb.
    const offY = wide ? -0.04 : 0.62;
    const focal = wide ? 1.85 : 1.35;

    gl.uniform2f(u.offset, offX, offY + s * 0.1);
    gl.uniform1f(u.focal, focal);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function start() {
    if (state.running) return;
    state.running = true;
    // Rebase the clock so a resume after stop() does not jump the animation.
    state.t0 = performance.now() - state.elapsed * 1000;
    lastFrame = 0;

    if (reduced) {
      // Honour the OS setting: paint one static, fully faded-in frame.
      state.intro = 1;
      resize();
      render(0);
      state.running = false;
      return;
    }
    state.raf = requestAnimationFrame(frame);
  }

  function stop() {
    state.running = false;
    cancelAnimationFrame(state.raf);
  }

  function destroy() {
    stop();
    gl.deleteProgram(program);
    gl.deleteVertexArray(vao);
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
  }

  return {
    supported: true,
    start,
    stop,
    destroy,
    /** Normalised pointer, each axis in -1..1. */
    setPointer(x, y) {
      state.px = x;
      state.py = y;
    },
    /** Hero scroll progress, 0 at top to 1 when the hero has fully left. */
    setScroll(v) {
      state.scroll = Math.max(0, Math.min(1, v));
    },
    /** Manual orbit offsets in radians, from the drag-to-orbit toggle. */
    setOrbit(x, y) {
      state.orbitX = x;
      state.orbitY = Math.max(-0.75, Math.min(0.95, y));
    },
    get orbitEnabled() {
      return state.orbit;
    },
    set orbitEnabled(v) {
      state.orbit = v;
      if (!v) {
        state.orbitX = 0;
        state.orbitY = 0;
      }
    },
  };
}
