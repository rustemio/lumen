// Colour maths for the lamps. Everything is 0..1 unless it says otherwise.

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]) {
  const h = (x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// h in degrees, s and v 0..1.
export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}

export function rgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [((h * 60) + 360) % 360, max ? d / max : 0, max];
}

export const hueOf = (hex) => rgbToHsv(hexToRgb(hex))[0];

// Shifts a colour's hue, keeping how saturated and bright it is.
export function shiftHue(hex, deg) {
  const [h, s, v] = rgbToHsv(hexToRgb(hex));
  return hsvToRgb(h + deg, s, v);
}

// Approximate colour of white light at a colour temperature, for the preview only. A real bulb
// with separate white LEDs mixes them itself.
export function kelvinToRgb(k) {
  const t = k / 100;
  const r = t <= 66 ? 1 : clamp01(1.2929 * Math.pow(t - 60, -0.1332));
  const g = t <= 66 ? clamp01(0.3901 * Math.log(t) - 0.6318) : clamp01(1.1298 * Math.pow(t - 60, -0.0755));
  const b = t >= 66 ? 1 : t <= 19 ? 0 : clamp01(0.5432 * Math.log(t - 10) - 1.1962);
  return [r, g, b];
}

export const mixRgb = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// The largest per-channel gap between two lamp states, brightness included, 0..1.
export function stateDistance(a, b) {
  if (!a || !b) return 1;
  if (a.on !== b.on || a.white !== b.white) return 1;
  return Math.max(
    Math.abs(a.rgb[0] - b.rgb[0]), Math.abs(a.rgb[1] - b.rgb[1]), Math.abs(a.rgb[2] - b.rgb[2]),
    Math.abs(a.bri - b.bri), a.white ? Math.abs(a.kelvin - b.kelvin) / 4000 : 0,
  );
}

// What a person sees: colour times brightness, for the virtual lamps.
export const litRgb = (s) => (s && s.on ? s.rgb.map((c) => c * s.bri) : [0, 0, 0]);
