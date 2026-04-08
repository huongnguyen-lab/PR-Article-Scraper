'use strict';

/**
 * publish_date extraction with multi-level fallbacks.
 *
 * Given a Playwright Page object, attempts to find the article publish date
 * using the following priority order:
 *
 *   1. <time datetime="…">
 *   2. <meta property="article:published_time">
 *   3. <meta name="pubdate">
 *   4. <meta name="DC.date.issued">
 *   5. JSON-LD <script type="application/ld+json"> → datePublished / dateCreated
 *   6. <meta property="og:updated_time">
 *   7. Visible page text – regex patterns for common date formats
 *
 * All found dates are normalised to ISO 8601: YYYY-MM-DDTHH:mm:ssZ
 * Returns null if nothing is found.
 */

const log = require('../output/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Attempt to parse an arbitrary date string and return an ISO 8601 string.
 * Returns null if Date.parse() fails.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function parseToISO(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // DD/MM/YYYY or DD-MM-YYYY should be handled before native Date parsing
  // because JavaScript often interprets slash dates as MM/DD/YYYY.
  const dmyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const [, dd, mm, yyyy] = dmyMatch;
    const d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Direct ISO / RFC parse (handles 2024-03-15T10:00:00+07:00 etc.)
  const nativeDate = new Date(trimmed);
  if (!isNaN(nativeDate.getTime())) {
    return nativeDate.toISOString();
  }

  // Vietnamese date: "ngày 15 tháng 3 năm 2024"
  const viMatch = trimmed.match(
    /ng[àa]y\s+(\d{1,2})\s+th[áa]ng\s+(\d{1,2})\s+n[aă]m\s+(\d{4})/i
  );
  if (viMatch) {
    const [, dd, mm, yyyy] = viMatch;
    const d2 = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`);
    if (!isNaN(d2.getTime())) return d2.toISOString();
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyEmbeddedMatch = trimmed.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyEmbeddedMatch) {
    const [, dd, mm, yyyy] = dmyEmbeddedMatch;
    const d3 = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`);
    if (!isNaN(d3.getTime())) return d3.toISOString();
  }

  return null;
}

// ─── Individual extraction strategies ────────────────────────────────────────

/** Strategy 1: <time datetime="…"> */
async function fromTimeElement(page) {
  const val = await page.$eval(
    'time[datetime]',
    (el) => el.getAttribute('datetime'),
  ).catch(() => null);
  return parseToISO(val);
}

/** Strategy 2: <meta property="article:published_time"> */
async function fromMetaArticlePublished(page) {
  const val = await page.$eval(
    'meta[property="article:published_time"]',
    (el) => el.getAttribute('content'),
  ).catch(() => null);
  return parseToISO(val);
}

/** Strategy 3: <meta name="pubdate"> */
async function fromMetaPubdate(page) {
  const val = await page.$eval(
    'meta[name="pubdate"]',
    (el) => el.getAttribute('content'),
  ).catch(() => null);
  return parseToISO(val);
}

/** Strategy 4: <meta name="DC.date.issued"> */
async function fromMetaDCDate(page) {
  const val = await page.$eval(
    'meta[name="DC.date.issued"]',
    (el) => el.getAttribute('content'),
  ).catch(() => null);
  return parseToISO(val);
}

/** Strategy 5: JSON-LD → datePublished / dateCreated */
async function fromJsonLd(page) {
  // Grab the text content of ALL ld+json script tags
  const scripts = await page.$$eval(
    'script[type="application/ld+json"]',
    (els) => els.map((el) => el.textContent),
  ).catch(() => []);

  for (const raw of scripts) {
    try {
      // JSON-LD may be a single object or an array
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];

      for (const obj of candidates) {
        // Support nested @graph arrays (common in WordPress sites)
        const items = obj['@graph'] ? [obj, ...obj['@graph']] : [obj];
        for (const item of items) {
          const date = item.datePublished || item.dateCreated;
          const iso = parseToISO(date);
          if (iso) return iso;
        }
      }
    } catch (_) {
      // Malformed JSON-LD – skip
    }
  }
  return null;
}

/** Strategy 6: <meta property="og:updated_time"> */
async function fromOgUpdatedTime(page) {
  const val = await page.$eval(
    'meta[property="og:updated_time"]',
    (el) => el.getAttribute('content'),
  ).catch(() => null);
  return parseToISO(val);
}

/**
 * Strategy 7: Scan visible page text for date patterns.
 *
 * Patterns tried (in order):
 *   - ISO 8601:  2024-03-15T10:00:00
 *   - DD/MM/YYYY or DD-MM-YYYY
 *   - Vietnamese: "ngày 15 tháng 3 năm 2024"
 */
async function fromVisibleText(page) {
  const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');

  // ISO 8601 with optional time
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2}(?:T[\d:]+(?:Z|[+-]\d{2}:?\d{2})?)?)\b/);
  if (isoMatch) {
    const iso = parseToISO(isoMatch[1]);
    if (iso) return iso;
  }

  // Vietnamese date pattern
  const viMatch = text.match(
    /ng[àa]y\s+(\d{1,2})\s+th[áa]ng\s+(\d{1,2})\s+n[aă]m\s+(\d{4})/i
  );
  if (viMatch) {
    const iso = parseToISO(viMatch[0]);
    if (iso) return iso;
  }

  // DD/MM/YYYY
  const dmyMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (dmyMatch) {
    const iso = parseToISO(dmyMatch[0]);
    if (iso) return iso;
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract the publish date from an article page using cascading fallbacks.
 *
 * @param {import('playwright').Page} page  Open Playwright page at the article URL
 * @param {string} articleUrl               For logging purposes
 * @returns {Promise<string|null>}          ISO 8601 date string or null
 */
async function extractPublishDate(page, articleUrl) {
  const strategies = [
    { name: 'time[datetime]',               fn: fromTimeElement },
    { name: 'meta article:published_time',  fn: fromMetaArticlePublished },
    { name: 'meta pubdate',                 fn: fromMetaPubdate },
    { name: 'meta DC.date.issued',          fn: fromMetaDCDate },
    { name: 'JSON-LD datePublished',        fn: fromJsonLd },
    { name: 'og:updated_time',              fn: fromOgUpdatedTime },
    { name: 'visible text regex',           fn: fromVisibleText },
  ];

  for (const { name, fn } of strategies) {
    try {
      const result = await fn(page);
      if (result) {
        log.date(name, result);
        return result;
      }
    } catch (err) {
      // Individual strategy failure is not fatal – try the next one
      log.warn(`Date strategy "${name}" threw: ${err.message}`);
    }
  }

  log.dateFail(articleUrl);
  return null;
}

/**
 * Format an ISO 8601 date string to Vietnamese display format.
 *
 * Output: "HH:mm:ss DD/MM/YYYY" in Vietnam timezone (UTC+7)
 * Example: "2019-02-28T23:30:01.000Z" → "06:30:01 01/03/2019"
 *
 * Returns empty string if input is null/invalid.
 *
 * @param {string|null} isoString
 * @returns {string}
 */
function formatDateVN(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';

  // Vietnam is UTC+7
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const local = new Date(d.getTime() + VN_OFFSET_MS);

  const pad = (n) => String(n).padStart(2, '0');
  const HH = pad(local.getUTCHours());
  const mm = pad(local.getUTCMinutes());
  const ss = pad(local.getUTCSeconds());
  const DD = pad(local.getUTCDate());
  const MM = pad(local.getUTCMonth() + 1);
  const YYYY = local.getUTCFullYear();

  return `${HH}:${mm}:${ss} ${DD}/${MM}/${YYYY}`;
}

module.exports = { extractPublishDate, parseToISO, formatDateVN };
