'use strict';

/**
 * Google Search → News tab (Past week) → article card extraction.
 *
 * Thay vì click qua UI (Tools → dropdown → Past week) — dễ bị Google
 * thay đổi HTML phá vỡ — ta dùng URL param trực tiếp:
 *
 *   https://www.google.com/search?q=QUERY&tbm=nws&tbs=qdr:w
 *     tbm=nws   → tab News
 *     tbs=qdr:w → Past week
 *
 * Flow:
 *   1. Mở google.com → accept consent nếu có
 *   2. Navigate thẳng đến URL search với filter đã nhúng
 *   3. Kiểm tra CAPTCHA
 *   4. Extract article cards
 */

const { newPage, closePage } = require('./browser');
const { resolveGoogleRedirect, extractHostname } = require('../parser/urlParser');
const log = require('../output/logger');

// ─── Timing helpers ──────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay(min = 800, max = 2000) {
  return new Promise((r) => setTimeout(r, randInt(min, max)));
}

// ─── Consent dialog ───────────────────────────────────────────────────────────

async function acceptConsent(page) {
  const selectors = [
    '#L2AGLb',                              // id phổ biến nhất
    'button:has-text("Accept all")',
    'button:has-text("Chấp nhận tất cả")',
    'button:has-text("Agree")',
    'button:has-text("Đồng ý")',
    '[aria-label="Accept all"]',
    'form[action*="consent"] button',       // consent.google.com form
  ];

  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        log.info('Consent dialog accepted.');
        return;
      }
    } catch (_) {}
  }
}

// ─── CAPTCHA detection ────────────────────────────────────────────────────────

async function checkForCaptcha(page) {
  const CAPTCHA_PAUSE_MS = parseInt(process.env.CAPTCHA_PAUSE_MS || '30000', 10);

  const text = await page
    .evaluate(() => (document.title + ' ' + (document.body?.innerText || '')).toLowerCase())
    .catch(() => '');

  const isCaptcha = /unusual traffic|captcha|i'm not a robot|xác minh bạn không phải robot/.test(text);

  if (isCaptcha) {
    log.captcha(CAPTCHA_PAUSE_MS);
    await new Promise((r) => setTimeout(r, CAPTCHA_PAUSE_MS));
    return true;
  }
  return false;
}

// ─── Article card extraction ──────────────────────────────────────────────────

/**
 * Extract article cards từ Google News results page.
 *
 * Google thay đổi HTML thường xuyên nên dùng nhiều strategy:
 *
 * Strategy 1 – Tìm theo cấu trúc card hiện đại (2024–2026):
 *   Mỗi card News là một <div> chứa:
 *   - <a href="..."> bao quanh headline (có thể là Google redirect)
 *   - <div> hoặc <span> chứa tên publisher
 *
 * Strategy 2 – Fallback: lấy tất cả link ngoài trong #search,
 *   lọc bằng heuristic (có title đủ dài, không phải link Google).
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{title:string, url:string, publisherDomain:string}>>}
 */
async function extractArticleCards(page) {
  await randomDelay(800, 1500); // chờ lazy-load xong

  let results = [];

  // ── Strategy 1: Modern Google News card structure ─────────────────────────
  try {
    results = await page.evaluate(() => {
      /**
       * Trong Google News results hiện tại (2024–2026), mỗi bài báo thường
       * nằm trong một block có data-hveid hoặc data-ved, chứa:
       *   - <a role="heading"> hoặc <a> bao quanh text headline
       *   - Gần đó có span/div chứa tên nguồn (publisher)
       *
       * Ta tìm tất cả <a> có href trỏ ra ngoài Google, rồi với mỗi link:
       *   - Lấy text của nó làm title (nếu đủ dài)
       *   - Leo lên DOM để tìm publisher name trong cùng card container
       */

      // Helper: leo lên tối đa N cấp để tìm container card
      function findCardContainer(el, maxLevels = 8) {
        let node = el;
        for (let i = 0; i < maxLevels; i++) {
          if (!node.parentElement) break;
          node = node.parentElement;
          // Dấu hiệu container: có data-hveid, data-ved, hoặc role=article
          if (
            node.hasAttribute('data-hveid') ||
            node.hasAttribute('data-ved') ||
            node.getAttribute('role') === 'article' ||
            node.tagName === 'ARTICLE'
          ) {
            return node;
          }
        }
        // Fallback: trả về 5 cấp cha
        node = el;
        for (let i = 0; i < 5; i++) {
          if (!node.parentElement) break;
          node = node.parentElement;
        }
        return node;
      }

      // Helper: tìm publisher name trong container
      function findPublisher(container) {
        // Thứ tự ưu tiên các selector publisher phổ biến
        const publisherSelectors = [
          '[data-ved] span',            // Google thường đặt source ở đây
          'cite',                       // semantic HTML
          'span[class*="source"]',
          'span[class*="Source"]',
          // Class names cụ thể (có thể thay đổi theo thời gian)
          '.NUnG9d', '.vr1PYe', '.VkSnBd', '.TbwUpd',
          '[data-n-tid]',
          'span[jsname]',
        ];

        for (const sel of publisherSelectors) {
          try {
            const el = container.querySelector(sel);
            if (el) {
              // Xoá phần "· X giờ trước" nếu có
              const text = el.textContent?.trim().split('·')[0].trim();
              if (text && text.length > 0 && text.length < 80) return text;
            }
          } catch (_) {}
        }
        return '';
      }

      const seen = new Set();
      const items = [];

      // Lấy tất cả <a> trong vùng kết quả (#search hoặc toàn trang)
      const searchRoot = document.querySelector('#search') || document.body;
      const anchors = Array.from(searchRoot.querySelectorAll('a[href]'));

      for (const a of anchors) {
        const href = a.href || '';

        // Bỏ qua: link Google nội bộ, anchor, javascript:, đã thấy
        if (
          !href ||
          href.startsWith('#') ||
          href.startsWith('javascript:') ||
          /google\.(com|com\.vn|vn)\/(?!url\?q=)/.test(href) ||
          seen.has(href)
        ) continue;

        // Title: dùng text của thẻ <a>, hoặc aria-label
        const rawTitle = (a.textContent || a.getAttribute('aria-label') || '').trim();
        // Bỏ link không phải headline (nav, icon, nút, v.v.)
        if (!rawTitle || rawTitle.length < 15) continue;

        seen.add(href);

        const container = findCardContainer(a);
        const publisher = findPublisher(container);

        items.push({ title: rawTitle, href, publisher });
      }

      return items;
    });

    // Resolve Google redirect URLs và lọc lại
    const resolved = [];
    for (const { title, href, publisher } of results) {
      const url = resolveGoogleRedirect(href);
      if (!url || url.startsWith('https://www.google.com')) continue;

      const publisherDomain = publisher
        ? publisher.split('·')[0].trim()
        : extractHostname(url);

      resolved.push({ title, url, publisherDomain });
    }
    results = resolved;

  } catch (err) {
    log.warn(`Card extraction strategy 1 failed: ${err.message}`);
    results = [];
  }

  // ── Strategy 2: Fallback nếu Strategy 1 không tìm được gì ────────────────
  if (results.length === 0) {
    log.warn('Strategy 1 got 0 results, trying fallback strategy 2...');
    try {
      const links = await page.$$eval(
        // Lấy link ngoài Google, bỏ qua anchor và javascript:
        '#search a[href]:not([href^="#"]):not([href^="javascript"])',
        (anchors) =>
          anchors
            .filter((a) => {
              const h = a.href || '';
              return h && !/google\.(com|vn)\/(?!url\?q=)/.test(h);
            })
            .map((a) => ({
              title: (a.textContent || '').trim(),
              href: a.href || '',
            }))
      );

      const seen = new Set();
      for (const { title, href } of links) {
        if (!title || title.length < 20) continue;
        const url = resolveGoogleRedirect(href);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        results.push({ title, url, publisherDomain: extractHostname(url) });
      }
    } catch (err) {
      log.warn(`Card extraction strategy 2 failed: ${err.message}`);
    }
  }

  return results;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Tìm kiếm Google News với filter Past week và trả về danh sách article cards.
 *
 * Dùng URL param thay vì click UI:
 *   tbm=nws   → tab News
 *   tbs=qdr:w → Past week
 *
 * @param {string} brand
 * @param {string} query
 * @returns {Promise<Array<{title:string, url:string, publisherDomain:string}>>}
 */
async function searchGoogleNews(brand, query) {
  const PAGE_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT || '30000', 10);
  let page;

  try {
    page = await newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT);

    log.start(brand, query);

    // ── Bước 1: Ghé google.com trước để accept consent nếu có ───────────────
    // (Consent chỉ xuất hiện lần đầu, nhưng vẫn xử lý mỗi lần để chắc chắn)
    await page.goto('https://www.google.com', {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await acceptConsent(page);
    await randomDelay(500, 1000);

    // ── Bước 2: Navigate thẳng đến News + Past week qua URL params ──────────
    //   tbm=nws   = tab News (thay cho click "Tin tức")
    //   tbs=qdr:w = Past week (thay cho click Tools → dropdown → Tuần qua)
    //   hl=vi     = giao diện tiếng Việt (không ảnh hưởng đến filter)
    //   gl=vn     = kết quả từ Việt Nam
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://www.google.com/search?q=${encodedQuery}&tbm=nws&tbs=qdr:w&hl=vi&gl=vn`;

    log.info(`Navigating: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await randomDelay(1000, 2000);

    // ── Bước 3: Kiểm tra CAPTCHA ─────────────────────────────────────────────
    if (await checkForCaptcha(page)) {
      // Sau khi pause, thử lại một lần
      if (await checkForCaptcha(page)) {
        log.warn(`Aborting query "${query}" due to persistent CAPTCHA.`);
        return [];
      }
    }

    // ── Bước 4: Kiểm tra có vào đúng tab News chưa ───────────────────────────
    // URL sau navigate phải chứa tbm=nws; nếu không, Google redirect về All
    const currentUrl = page.url();
    if (!currentUrl.includes('tbm=nws')) {
      log.warn(`Not on News tab after navigation (url=${currentUrl}); retrying with tbm=nws appended.`);
      const fallbackUrl = currentUrl.includes('?')
        ? `${currentUrl}&tbm=nws&tbs=qdr:w`
        : `${currentUrl}?tbm=nws&tbs=qdr:w`;
      await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
      await randomDelay(1000, 2000);
    }

    // ── Bước 5: Extract article cards ────────────────────────────────────────
    const cards = await extractArticleCards(page);

    log.found(cards.length, query);
    if (cards.length === 0) {
      log.warn(`Query "${query}" returned 0 results.`);
    }

    return cards;

  } catch (err) {
    log.warn(`searchGoogleNews failed for query "${query}": ${err.message}`);
    return [];
  } finally {
    if (page) await closePage(page);
  }
}

module.exports = { searchGoogleNews };
