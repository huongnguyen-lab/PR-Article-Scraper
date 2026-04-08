'use strict';

/**
 * URL normalisation utilities.
 *
 * Two main jobs:
 *   1. Resolve Google tracking URLs  (/url?q=REAL_URL&sa=…) → real URL
 *   2. Normalise URLs for deduplication (strip utm_*, trailing slash, etc.)
 */

/**
 * If the supplied href is a Google redirect link (/url?q=…), extract and
 * decode the real destination URL.  Otherwise return the href unchanged.
 *
 * Google uses at least two redirect formats:
 *   https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Farticle&sa=…
 *   /url?q=https%3A%2F%2Fexample.com%2Farticle&sa=…
 *
 * @param {string} href  Raw href attribute from Google search result
 * @returns {string}     The real destination URL
 */
function resolveGoogleRedirect(href) {
  if (!href) return '';

  try {
    // Build an absolute URL so we can use URL() even for relative hrefs.
    const base = 'https://www.google.com';
    const full = href.startsWith('http') ? href : `${base}${href}`;
    const url = new URL(full);

    // /url?q= redirect
    if (
      (url.hostname === 'www.google.com' || url.hostname === 'google.com') &&
      url.pathname === '/url'
    ) {
      const qParam = url.searchParams.get('q');
      if (qParam) return qParam;
    }
  } catch (_) {
    // Malformed URL – return as-is
  }

  return href;
}

/**
 * Normalise a URL for deduplication purposes.
 *
 * Rules applied (in order):
 *   1. Parse the URL; if invalid return the original string lowercased.
 *   2. Lowercase the scheme and hostname.
 *   3. Remove all utm_* query parameters (and fbclid, gclid, etc.).
 *   4. Remove a trailing slash from the pathname (unless pathname is "/").
 *   5. Sort remaining query parameters so order doesn't matter.
 *
 * @param {string} url
 * @returns {string} Normalised URL string
 */
function normalizeUrl(url) {
  if (!url) return '';

  try {
    const u = new URL(url);

    // Lowercase scheme + host (URL constructor already does this, but be explicit)
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();

    // Strip tracking params
    const TRACKING_PARAMS = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'utm_id', 'fbclid', 'gclid', 'msclkid', 'ref', '_ga',
    ];
    TRACKING_PARAMS.forEach((p) => u.searchParams.delete(p));

    // Sort remaining params for canonical ordering
    u.searchParams.sort();

    // Remove trailing slash on non-root paths
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }

    // Remove default ports (already handled by URL API)
    return u.toString();
  } catch (_) {
    // Fallback for malformed URLs
    return url.toLowerCase().trim();
  }
}

/**
 * Extract the hostname (publisher domain) from a URL string.
 * Returns empty string on failure.
 *
 * Example: "https://www.vnexpress.net/article" → "vnexpress.net"
 *
 * @param {string} url
 * @returns {string}
 */
function extractHostname(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    // Strip leading "www." so "www.vnexpress.net" → "vnexpress.net"
    return u.hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

/**
 * Build the homepage URL from a publisher domain string.
 *
 * Input có thể là hostname thuần (vd: "vnexpress.net") hoặc URL đầy đủ.
 * Output: "https://vnexpress.net"
 *
 * @param {string} domain  publisher_domain value
 * @returns {string}
 */
function buildHomepage(domain) {
  if (!domain) return '';
  // Nếu đã là URL đầy đủ, chỉ lấy scheme + hostname
  try {
    if (domain.startsWith('http')) {
      const u = new URL(domain);
      return `${u.protocol}//${u.hostname}`;
    }
  } catch (_) {}
  // Domain thuần: thêm https://
  const clean = domain.trim().replace(/\/+$/, ''); // bỏ trailing slash
  return `https://${clean}`;
}

module.exports = { resolveGoogleRedirect, normalizeUrl, extractHostname, buildHomepage };
