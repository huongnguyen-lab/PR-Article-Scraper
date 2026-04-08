'use strict';

/**
 * Playwright browser lifecycle management.
 *
 * Provides a single shared Chromium instance that is reused across all brands
 * and queries.  Each caller gets a fresh Page (tab) and is responsible for
 * closing it when done.
 *
 * Key settings that reduce bot-detection signals:
 *   - Realistic User-Agent (Chrome 124 on Windows 11)
 *   - Vietnamese locale + Asia/Ho_Chi_Minh timezone
 *   - 1280 × 800 viewport
 *   - Permissions for geolocation/notifications silenced
 */

const { chromium } = require('playwright');
const log = require('../output/logger');

// A Chrome 124 UA on Windows 11 – believable and widely seen in the wild.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

let _browser = null; // module-level singleton

/**
 * Launch (or return cached) Chromium browser.
 *
 * @param {object}  opts
 * @param {boolean} [opts.headless=false]  Run without a visible window
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchBrowser({ headless = false } = {}) {
  if (_browser) return _browser;

  log.info(`Launching Chromium (headless=${headless}) …`);

  _browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled', // hide automation flag
      '--disable-infobars',
      '--window-size=1280,800',
    ],
  });

  log.info('Browser ready.');
  return _browser;
}

/**
 * Open a new browser tab pre-configured with:
 *   - Realistic User-Agent
 *   - Vietnamese locale & timezone
 *   - 1280 × 800 viewport
 *   - webdriver property hidden (navigator.webdriver = false)
 *
 * @returns {Promise<import('playwright').Page>}
 */
async function newPage() {
  if (!_browser) throw new Error('Browser not launched. Call launchBrowser() first.');

  const context = await _browser.newContext({
    userAgent: USER_AGENT,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1280, height: 800 },
    // Suppress permission prompts
    permissions: [],
    extraHTTPHeaders: {
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  const page = await context.newPage();

  // Hide automation signals: overwrite navigator.webdriver
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  return page;
}

/**
 * Close a page AND its parent BrowserContext to release resources.
 *
 * @param {import('playwright').Page} page
 */
async function closePage(page) {
  try {
    const ctx = page.context();
    await page.close();
    await ctx.close();
  } catch (_) {
    // Best-effort cleanup
  }
}

/**
 * Close the shared browser instance.
 * Should be called once at the end of the run.
 */
async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
    log.info('Browser closed.');
  }
}

module.exports = { launchBrowser, newPage, closePage, closeBrowser };
