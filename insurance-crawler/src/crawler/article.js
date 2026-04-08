'use strict';

/**
 * Article page scraper.
 *
 * Opens each article URL in a new browser tab, captures the final URL
 * (after any redirects), and extracts the publish_date using the multi-level
 * fallback chain defined in dateParser.js.
 *
 * Concurrency is controlled externally via p-limit; this module only handles
 * a single article at a time.
 */

const { newPage, closePage } = require('./browser');
const { extractPublishDate } = require('../parser/dateParser');
const log = require('../output/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay(min, max) {
  return new Promise((r) => setTimeout(r, randInt(min, max)));
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Fetch an article page and extract its publish_date.
 *
 * Retries once on navigation failure before giving up.
 *
 * @param {string} url  The article URL (may redirect)
 * @returns {Promise<{finalUrl: string, publishDate: string|null}>}
 *   finalUrl    – page.url() after navigation (canonical URL)
 *   publishDate – ISO 8601 string, or null if extraction failed
 */
async function fetchArticle(url) {
  const PAGE_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT || '30000', 10);
  const ARTICLE_DELAY_MIN = parseInt(process.env.ARTICLE_DELAY_MIN || '500', 10);
  const ARTICLE_DELAY_MAX = parseInt(process.env.ARTICLE_DELAY_MAX || '1500', 10);

  log.fetch(url);

  let attempt = 0;
  const maxAttempts = 2; // try once, retry once

  while (attempt < maxAttempts) {
    let page;
    try {
      page = await newPage();
      page.setDefaultTimeout(PAGE_TIMEOUT);

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT,
      });

      // Capture the final URL after any HTTP or JS redirects
      const finalUrl = page.url();

      // Extract publish date using cascading fallbacks
      const publishDate = await extractPublishDate(page, url);

      // Brief polite delay before the caller opens the next article
      await randomDelay(ARTICLE_DELAY_MIN, ARTICLE_DELAY_MAX);

      return { finalUrl, publishDate };
    } catch (err) {
      attempt++;
      if (attempt < maxAttempts) {
        log.warn(`Retrying article (attempt ${attempt + 1}): ${url} — ${err.message}`);
        await randomDelay(1000, 2000);
      } else {
        log.error(url, err.message);
        return { finalUrl: url, publishDate: null };
      }
    } finally {
      if (page) await closePage(page);
    }
  }

  // Should never reach here, but satisfy the linter
  return { finalUrl: url, publishDate: null };
}

module.exports = { fetchArticle };
