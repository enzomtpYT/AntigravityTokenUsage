const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

const HTML_ESCAPE_RE = /[&<>"'`]/g;

/**
 * Escapes arbitrary strings for safe interpolation into HTML contexts
 * (such as ECharts `tooltip.formatter` HTML strings).
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const RGB_COLOR_RE =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/;

/**
 * Validates a CSS color string before interpolating into inline styles
 * to prevent CSS/HTML attribute breakout in tooltip formatters.
 */
export function sanitizeCssColor(color: unknown, fallback = '#6366f1'): string {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  if (HEX_COLOR_RE.test(trimmed) || RGB_COLOR_RE.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}
