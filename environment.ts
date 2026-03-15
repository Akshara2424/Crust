/**
 * CRUST SDK — Environment features (dims 1–8)
 *
 * All functions run synchronously inside the Web Worker.
 * Workers expose navigator, screen, performance, and OffscreenCanvas.
 * Returns 0 for any dimension whose browser API is unavailable, and
 * emits console.warn so callers can audit the gap.
 */

// ── Internal helpers ──────────────────────────────────────────────────────────

/** FNV-1a 32-bit hash normalised to [0, 1) */
function fnv1a32(data: Uint8ClampedArray): number {
  let hash = 0x811c9dc5 >>> 0;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i]!;
    hash = (Math.imul(hash, 0x01000193)) >>> 0;
  }
  // Map to open interval [0, 1)
  return hash / 0x1_0000_0000;
}

// ── Dim 1 ─────────────────────────────────────────────────────────────────────

/**
 * env_webdriver_flag
 * Returns 1 if navigator.webdriver is truthy (automation detected), else 0.
 */
export function envWebdriverFlag(): number {
  return (navigator as Navigator & { webdriver?: boolean }).webdriver ? 1 : 0;
}

// ── Dim 2 ─────────────────────────────────────────────────────────────────────

/**
 * env_canvas_hash
 * Draws a deterministic scene on a 64×64 OffscreenCanvas and hashes the pixel
 * buffer with FNV-1a.  Different GPU/font/driver stacks produce different hashes,
 * serving as a lightweight rendering fingerprint.
 */
export function envCanvasHash(): number {
  try {
    const canvas = new OffscreenCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[CRUST] env_canvas_hash: could not obtain 2d context');
      return 0;
    }
    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 64);
    // Sentinel text — triggers font / sub-pixel rendering fingerprint
    ctx.fillStyle = '#1a1a2e';
    ctx.font = '14px Arial';
    ctx.textBaseline = 'top';
    ctx.fillText('CRUST_FP_2026', 2, 4);
    // Colour blocks — exercises compositing path
    ctx.fillStyle = 'rgba(102, 204, 0, 0.72)';
    ctx.fillRect(4, 26, 22, 14);
    ctx.fillStyle = 'rgba(255, 51, 0, 0.55)';
    ctx.fillRect(22, 26, 22, 14);
    ctx.fillStyle = 'rgba(0, 153, 255, 0.60)';
    ctx.fillRect(40, 26, 20, 14);
    // Bezier curve — exercises vector rasteriser
    ctx.beginPath();
    ctx.strokeStyle = '#cc00ff';
    ctx.lineWidth = 1.5;
    ctx.moveTo(2, 50);
    ctx.bezierCurveTo(20, 42, 44, 62, 62, 50);
    ctx.stroke();

    const { data } = ctx.getImageData(0, 0, 64, 64);
    return fnv1a32(data);
  } catch {
    console.warn('[CRUST] env_canvas_hash: OffscreenCanvas unavailable');
    return 0;
  }
}

// ── Dim 3 ─────────────────────────────────────────────────────────────────────

/**
 * env_plugin_count
 * Number of browser plugins, normalised to [0, 1] (clamped at 20).
 * Automation browsers typically return 0.
 */
export function envPluginCount(): number {
  const n = navigator.plugins?.length ?? 0;
  return Math.min(n, 20) / 20;
}

// ── Dim 4 ─────────────────────────────────────────────────────────────────────

/**
 * env_language_mismatch
 * Returns 1 if the country suffix in navigator.language contradicts the
 * continent implied by the IANA timezone.  A common bot artefact.
 */
export function envLanguageMismatch(): number {
  try {
    const lang = (navigator.language ?? '').split('-')[1]?.toLowerCase() ?? '';
    const tz   = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    if (!lang) return 0;
    const tzLc  = tz.toLowerCase();

    const americaTags = new Set(['us', 'ca', 'mx', 'br', 'ar', 'co', 'pe', 'cl', 've', 'ec']);
    const europeTags  = new Set(['gb', 'de', 'fr', 'it', 'es', 'nl', 'be', 'se', 'no', 'pl', 'at', 'ch']);
    const asiaTags    = new Set(['cn', 'jp', 'kr', 'in', 'sg', 'hk', 'tw', 'vn', 'th', 'id']);

    if (tzLc.startsWith('america/') && (europeTags.has(lang) || asiaTags.has(lang)))  return 1;
    if (tzLc.startsWith('europe/')  && (americaTags.has(lang) || asiaTags.has(lang))) return 1;
    if (tzLc.startsWith('asia/')    && (americaTags.has(lang) || europeTags.has(lang))) return 1;
    return 0;
  } catch {
    console.warn('[CRUST] env_language_mismatch: Intl API unavailable');
    return 0;
  }
}

// ── Dim 5 ─────────────────────────────────────────────────────────────────────

/**
 * env_screen_depth
 * Screen colour depth normalised to [0, 1] (max expected: 32 bpp).
 * Headless Chrome typically reports 24; unusual values flag VMs.
 */
export function envScreenDepth(): number {
  // WorkerGlobalScope exposes `screen` in Chromium; guard for Firefox Workers
  const depth = (self as unknown as { screen?: Screen }).screen?.colorDepth ?? 0;
  if (depth === 0) {
    console.warn('[CRUST] env_screen_depth: screen API unavailable in this worker');
  }
  return Math.min(depth, 32) / 32;
}

// ── Dim 6 ─────────────────────────────────────────────────────────────────────

/**
 * env_timezone_offset
 * UTC offset in minutes, normalised to [0, 1] over the range [−720, +840].
 */
export function envTimezoneOffset(): number {
  const offset = new Date().getTimezoneOffset(); // ECMAScript: −720 to +720
  return (offset + 720) / 1440;
}

// ── Dim 7 ─────────────────────────────────────────────────────────────────────

/**
 * env_touch_support
 * 1 if the device reports any touch points, 0 otherwise.
 */
export function envTouchSupport(): number {
  return navigator.maxTouchPoints > 0 ? 1 : 0;
}

// ── Dim 8 ─────────────────────────────────────────────────────────────────────

/**
 * env_devtools_open
 * Heuristic: times a tight computational loop.  A JS debugger paused on a
 * breakpoint (or V8 inspector active) inflates loop duration by orders of
 * magnitude.  Threshold 25 ms chosen empirically for a 2000-iteration loop.
 */
export function envDevtoolsOpen(): number {
  const t0 = performance.now();
  // Loop of sufficient complexity to resist dead-code elimination but short
  // enough to be imperceptible to the user.
  let acc = 0;
  for (let i = 0; i < 2_000; i++) acc += Math.sqrt(i) * Math.log(i + 1);
  void acc; // prevent optimiser eliding the loop
  return (performance.now() - t0) > 25 ? 1 : 0;
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

/**
 * collectEnvironmentFeatures
 * Returns all 8 environment dims as a fixed-length tuple.
 * Must be called within 800 ms of worker initialisation per the CRUST spec.
 */
export function collectEnvironmentFeatures(): [
  number, number, number, number, number, number, number, number,
] {
  return [
    envWebdriverFlag(),
    envCanvasHash(),
    envPluginCount(),
    envLanguageMismatch(),
    envScreenDepth(),
    envTimezoneOffset(),
    envTouchSupport(),
    envDevtoolsOpen(),
  ];
}
