'use strict';

/**
 * Entry point for the insurance news crawler.
 *
 * Execution flow:
 *   1. Parse CLI flags (--headless)
 *   2. Load env vars
 *   3. Launch browser
 *   4. For each brand → for each query:
 *        a. Run Google News search → get article cards
 *        b. Deduplicate against global set
 *        c. Fetch each article page (with p-limit concurrency) → get publish_date
 *        d. Write each row to CSV immediately
 *   5. Print final summary
 *   6. Close browser
 *
 * CLI:
 *   node src/index.js              # headful (visible browser)
 *   node src/index.js --headless   # headless
 */

require('dotenv').config(); // Load .env before anything else

const path = require('path');
// p-limit v3.x uses CommonJS exports
const pLimit = require('p-limit');

const { BRANDS } = require('./config/brands');
const { launchBrowser, closeBrowser } = require('./crawler/browser');
const { searchGoogleNews } = require('./crawler/google');
const { fetchArticle } = require('./crawler/article');
const { isDuplicate, markSeen } = require('./utils/deduper');
const { createCsvWriter, buildOutputPath } = require('./output/csvWriter');
const { extractHostname, buildHomepage } = require('./parser/urlParser');
const { formatDateVN } = require('./parser/dateParser');
const log = require('./output/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(min, max) {
  return new Promise((r) => setTimeout(r, randInt(min, max)));
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    headless:
      args.includes('--headless') ||
      process.env.HEADLESS === 'true',
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { headless } = parseArgs();

  const ARTICLE_CONCURRENCY = parseInt(process.env.ARTICLE_CONCURRENCY || '3', 10);
  const SEARCH_DELAY_MIN    = parseInt(process.env.SEARCH_DELAY_MIN    || '3000', 10);
  const SEARCH_DELAY_MAX    = parseInt(process.env.SEARCH_DELAY_MAX    || '6000', 10);
  const OUTPUT_DIR          = process.env.OUTPUT_DIR || 'output';

  // Build output path relative to the project root (one level up from src/)
  const outputPath = buildOutputPath(path.join(__dirname, '..', OUTPUT_DIR));

  // Initialise incremental CSV writer (creates file + header immediately)
  const csv = createCsvWriter(outputPath);

  let totalArticles = 0;
  let totalErrors   = 0;

  // ── Launch browser (shared across all brands) ──────────────────────────────
  await launchBrowser({ headless });

  // ── Brand loop (sequential) ────────────────────────────────────────────────
  for (const brandDef of BRANDS) {
    const { brand, queries } = brandDef;
    let brandArticles = 0;
    let brandErrors   = 0;

    // ── Query loop (sequential within each brand) ──────────────────────────
    for (const query of queries) {
      // Polite delay between searches
      await delay(SEARCH_DELAY_MIN, SEARCH_DELAY_MAX);

      // ── Google News search ───────────────────────────────────────────────
      let cards;
      try {
        cards = await searchGoogleNews(brand, query);
      } catch (err) {
        log.warn(`Search failed for "${query}": ${err.message}`);
        brandErrors++;
        continue;
      }

      // ── Filter duplicates ────────────────────────────────────────────────
      const freshCards = cards.filter((c) => {
        if (isDuplicate(c.url)) return false;
        markSeen(c.url);
        return true;
      });

      if (freshCards.length === 0) continue;

      // ── Fetch article details concurrently (bounded by p-limit) ──────────
      const limit = pLimit(ARTICLE_CONCURRENCY);

      const fetchTasks = freshCards.map((card) =>
        limit(async () => {
          try {
            const { finalUrl, publishDate } = await fetchArticle(card.url);

            const row = {
              brand,
              article_title:    card.title,
              article_url:      finalUrl,
              publisher_domain:   card.publisherDomain || extractHostname(finalUrl),
              publisher_homepage: buildHomepage(card.publisherDomain || extractHostname(finalUrl)),
              publish_date:       formatDateVN(publishDate),
            };

            await csv.writeRow(row);
            brandArticles++;
            totalArticles++;
            return true;
          } catch (err) {
            log.error(card.url, err.message);
            brandErrors++;
            totalErrors++;
            return false;
          }
        })
      );

      await Promise.all(fetchTasks);
    }

    log.done(brand, queries.length, brandArticles, brandErrors);
    totalErrors += brandErrors;
  }

  // ── Finalise CSV ───────────────────────────────────────────────────────────
  await csv.finalize();

  // ── Close browser ──────────────────────────────────────────────────────────
  await closeBrowser();

  // ── Final summary ──────────────────────────────────────────────────────────
  log.summary(totalArticles, totalErrors, outputPath);
}

// ─── Top-level error handler ──────────────────────────────────────────────────

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[FATAL]', err);
  process.exit(1);
});
