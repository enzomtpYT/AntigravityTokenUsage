import type { CustomResetMarker, ResetEventPool } from '../src/shared/types.ts';

/**
 * Hardcoded official community RSS feed URL (never accepts user-supplied URLs to prevent SSRF).
 */
export const GEMINI_RESET_FEED_URL = 'https://geminireset.com/feed.xml';
const MAX_FEED_BYTES = 256 * 1024; // 256 KB
const FETCH_TIMEOUT_MS = 8_000;
const ALLOWED_LINK_RE = /^https:\/\/(geminireset\.com|antigravityreset\.com)\//;

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .trim();
}

function extractTag(block: string, tagName: string): string {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = block.match(re);
  return match ? decodeXmlEntities(match[1]) : '';
}

/**
 * Parses `https://geminireset.com/feed.xml` RSS 2.0 items into `CustomResetMarker[]`.
 * Only keeps `<category>Confirmed reset</category>` entries (skipping promises & limit changes).
 */
export function parseGeminiResetRss(xml: string): CustomResetMarker[] {
  const markers: CustomResetMarker[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const category = extractTag(block, 'category').toLowerCase();
    const rawTitle = extractTag(block, 'title');

    // Only import confirmed resets — skip "[Promised]" or "[Limit change]"
    const isConfirmedReset =
      category.includes('confirmed reset') ||
      (category === '' && rawTitle.toLowerCase().startsWith('[reset]'));
    if (!isConfirmedReset) continue;

    const pubDate = extractTag(block, 'pubDate');
    const tsMs = Date.parse(pubDate);
    if (Number.isNaN(tsMs)) continue;

    const cleanLabel = rawTitle.replace(/^\[reset\]\s*/i, '').trim() || 'Confirmed server reset';
    const description = extractTag(block, 'description');
    const combinedText = `${cleanLabel} ${description}`.toLowerCase();

    // Detect whether the reset applied across all models (Gemini + Claude/GPT) or Gemini pool
    const pool: ResetEventPool =
      combinedText.includes('all models') || combinedText.includes('claude')
        ? 'all'
        : 'gemini';

    const rawGuid = extractTag(block, 'guid');
    const safeIdBase = (rawGuid || new Date(tsMs).toISOString())
      .replace(/[^a-zA-Z0-9:_-]/g, '')
      .slice(0, 56);
    const id = `feed:${safeIdBase}`;

    const rawLink = extractTag(block, 'link');
    const sourceUrl = ALLOWED_LINK_RE.test(rawLink) ? rawLink.slice(0, 240) : undefined;

    markers.push({
      id,
      timestamp: new Date(tsMs).toISOString(),
      scope: 'both',
      pool,
      label: cleanLabel.slice(0, 120),
      source: 'geminireset',
      ...(sourceUrl ? { sourceUrl } : {}),
    });
  }

  return markers;
}

export interface SyncFeedResult {
  markers: CustomResetMarker[];
  sourceUrl: string;
  fetchedAt: string;
}

/**
 * Fetches and parses confirmed server resets from `https://geminireset.com/feed.xml`.
 */
export async function fetchGeminiResetFeed(): Promise<SyncFeedResult> {
  const res = await fetch(GEMINI_RESET_FEED_URL, {
    method: 'GET',
    headers: {
      'User-Agent': 'AntigravityTokenUsage/1.0 (+https://github.com/enzomtpYT/AntigravityTokenUsage)',
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Feed request failed with HTTP ${res.status}`);
  }

  const contentLength = Number(res.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_FEED_BYTES) {
    throw new Error('Feed response exceeded 256 KB safety cap');
  }

  const xml = await res.text();
  if (Buffer.byteLength(xml, 'utf8') > MAX_FEED_BYTES) {
    throw new Error('Feed response exceeded 256 KB safety cap');
  }

  const markers = parseGeminiResetRss(xml);
  return {
    markers,
    sourceUrl: GEMINI_RESET_FEED_URL,
    fetchedAt: new Date().toISOString(),
  };
}
