'use strict';

/**
 * Global URL deduplicator.
 *
 * Maintains a single Set of normalised URLs across all brands and queries so
 * that the same article is never written to the CSV twice, even when different
 * search queries surface the same result.
 */

const { normalizeUrl } = require('../parser/urlParser');
const log = require('../output/logger');

// Shared set — module-level singleton (CommonJS modules are cached).
const seen = new Set();

/**
 * Check whether a URL has been seen before.
 * Normalises the URL before checking.
 *
 * @param {string} url
 * @returns {boolean} true if this URL is a duplicate
 */
function isDuplicate(url) {
  const key = normalizeUrl(url);
  if (seen.has(key)) {
    log.skip(url);
    return true;
  }
  return false;
}

/**
 * Mark a URL as seen so future calls to isDuplicate() return true.
 * Safe to call even if the URL was already marked.
 *
 * @param {string} url
 */
function markSeen(url) {
  seen.add(normalizeUrl(url));
}

/**
 * Returns the total number of unique URLs tracked so far.
 * Useful for diagnostics.
 *
 * @returns {number}
 */
function seenCount() {
  return seen.size;
}

/** Clears the dedup set (used in tests). */
function reset() {
  seen.clear();
}

module.exports = { isDuplicate, markSeen, seenCount, reset };
