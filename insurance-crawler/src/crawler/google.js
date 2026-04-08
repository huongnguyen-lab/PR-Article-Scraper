'use strict';

/**
 * Google Search → News (Past week) → article card extraction.
 *
 * Chiến lược chống CAPTCHA:
 *   1. Dùng 1 tab Google DUY NHẤT (getGooglePage) tái sử dụng qua mọi query
 *      → cookies/session được giữ → Google không thấy "người lạ" mỗi lần
 *   2. Gõ query vào search box thay vì navigate thẳng URL
 *      → hành vi giống người dùng thật hơn
 *   3. Filter Past week qua URL param tbs=qdr:w (sau khi đã ở trang kết quả)
 *      → chắc chắn hơn click UI
 *   4. Random delay giữa các thao tác
 */

const { getGooglePage, saveGoogleSession } = require('./browser');
const { resolveGoogleRedirect, extractHostname } = require('../parser/urlParser');
const log = require('../output/logger');

// ─── Timing ───────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sleep(min = 800, max = 2000) {
  return new Promise((r) => setTimeout(r, randInt(min, max)));
}

// ─── Consent dialog ───────────────────────────────────────────────────────────

async function acceptConsent(page) {
  const selectors = [
    '#L2AGLb',
    'button:has-text("Accept all")',
    'button:has-text("Chấp nhận tất cả")',
    'button:has-text("Agree")',
    'button:has-text("Đồng ý")',
    '[aria-label="Accept all"]',
    'form[action*="consent"] button',
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
  const PAUSE = parseInt(process.env.CAPTCHA_PAUSE_MS || '30000', 10);
  const text = await page
    .evaluate(() => (document.title + ' ' + (document.body?.innerText || '')).toLowerCase())
    .catch(() => '');

  if (/unusual traffic|captcha|i'm not a robot|xác minh bạn không phải robot/.test(text)) {
    log.captcha(PAUSE);
    // Trong headful mode: dừng để user giải CAPTCHA tay
    await new Promise((r) => setTimeout(r, PAUSE));
    return true;
  }
  return false;
}

// ─── Card extraction ──────────────────────────────────────────────────────────

async function extractArticleCards(page) {
  await sleep(800, 1500);

  let results = [];

  // Strategy 1: đọc DOM trong page context
  try {
    const raw = await page.evaluate(() => {
      function findCardContainer(el, maxLevels = 8) {
        let node = el;
        for (let i = 0; i < maxLevels; i++) {
          if (!node.parentElement) break;
          node = node.parentElement;
          if (
            node.hasAttribute('data-hveid') ||
            node.hasAttribute('data-ved') ||
            node.getAttribute('role') === 'article' ||
            node.tagName === 'ARTICLE'
          ) return node;
        }
        // fallback: 5 cấp cha
        node = el;
        for (let i = 0; i < 5; i++) {
          if (!node.parentElement) break;
          node = node.parentElement;
        }
        return node;
      }

      function findPublisher(container) {
        const selectors = [
          'cite',
          '[data-ved] span',
          'span[class*="source"]',
          'span[class*="Source"]',
          '.NUnG9d', '.vr1PYe', '.VkSnBd', '.TbwUpd',
          '[data-n-tid]',
          'span[jsname]',
        ];
        for (const sel of selectors) {
          try {
            const el = container.querySelector(sel);
            if (el) {
              const text = el.textContent?.trim().split('·')[0].trim();
              if (text && text.length > 0 && text.length < 80) return text;
            }
          } catch (_) {}
        }
        return '';
      }

      const seen = new Set();
      const items = [];
      const root = document.querySelector('#search') || document.body;

      for (const a of root.querySelectorAll('a[href]')) {
        const href = a.href || '';
        if (
          !href ||
          href.startsWith('#') ||
          href.startsWith('javascript:') ||
          /google\.(com|com\.vn|vn)\/(?!url\?q=)/.test(href) ||
          seen.has(href)
        ) continue;

        const title = (a.textContent || a.getAttribute('aria-label') || '').trim();
        if (!title || title.length < 15) continue;

        seen.add(href);
        const container = findCardContainer(a);
        items.push({ title, href, publisher: findPublisher(container) });
      }
      return items;
    });

    for (const { title, href, publisher } of raw) {
      const url = resolveGoogleRedirect(href);
      if (!url || url.startsWith('https://www.google.com')) continue;
      const publisherDomain = publisher
        ? publisher.split('·')[0].trim()
        : extractHostname(url);
      results.push({ title, url, publisherDomain });
    }
  } catch (err) {
    log.warn(`Card extraction strategy 1 failed: ${err.message}`);
  }

  // Strategy 2: fallback
  if (results.length === 0) {
    log.warn('Strategy 1 got 0 results, trying fallback...');
    try {
      const links = await page.$$eval(
        '#search a[href]:not([href^="#"]):not([href^="javascript"])',
        (as) => as
          .filter((a) => a.href && !/google\.(com|vn)\/(?!url\?q=)/.test(a.href))
          .map((a) => ({ title: (a.textContent || '').trim(), href: a.href }))
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

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Chạy một Google News query và trả về danh sách article cards.
 *
 * Dùng tab tái sử dụng (getGooglePage) nên cookies/session được giữ qua
 * mọi query → ít CAPTCHA hơn nhiều so với mở tab mới mỗi lần.
 */
async function searchGoogleNews(brand, query) {
  const PAGE_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT || '30000', 10);

  log.start(brand, query);

  // Lấy tab Google dùng chung (tạo mới nếu lần đầu, tái dùng nếu đã có)
  const page = await getGooglePage();
  page.setDefaultTimeout(PAGE_TIMEOUT);

  try {
    // ── Bước 1: Đảm bảo đang ở google.com, accept consent nếu cần ──────────
    const currentUrl = page.url();
    if (!currentUrl.includes('google.com')) {
      await page.goto('https://www.google.com', {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT,
      });
      await acceptConsent(page);
      await sleep(800, 1500);
    }

    // ── Bước 2: Xoá search box và gõ query (giống người dùng thật) ──────────
    const searchBox = page.locator('textarea[name="q"], input[name="q"]').first();

    // Nếu đang ở trang kết quả trước → click vào search box để focus
    try {
      await searchBox.click({ timeout: 3000 });
    } catch (_) {
      // Nếu không có search box (trang chủ ẩn) → navigate về trang chủ
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
      await acceptConsent(page);
      await sleep(500, 1000);
    }

    await searchBox.fill(''); // xoá query cũ
    await sleep(200, 500);

    // Gõ từng ký tự với delay ngẫu nhiên → trông như người thật gõ
    await searchBox.pressSequentially(query, { delay: randInt(50, 120) });
    await sleep(400, 800);
    await searchBox.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: PAGE_TIMEOUT });
    await sleep(1000, 2000);

    if (await checkForCaptcha(page)) {
      if (await checkForCaptcha(page)) {
        log.warn(`Aborting query "${query}" — CAPTCHA không giải được.`);
        return [];
      }
    }

    // ── Bước 3: Chuyển sang tab News + filter Past week qua URL param ────────
    // Lấy URL hiện tại sau khi search → inject tbm=nws (News) + tbs=qdr:w (Past week)
    let searchResultUrl;
    try {
      searchResultUrl = new URL(page.url());
    } catch (_) {
      // Nếu URL không hợp lệ vì lý do nào đó, build lại từ query
      searchResultUrl = new URL('https://www.google.com/search');
      searchResultUrl.searchParams.set('q', query);
    }
    searchResultUrl.searchParams.set('tbm', 'nws');   // tab News
    searchResultUrl.searchParams.set('tbs', 'qdr:w'); // Past week

    const newsUrl = searchResultUrl.toString();
    log.info(`Navigating to News+PastWeek: ${newsUrl}`);

    await page.goto(newsUrl, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });
    await sleep(1000, 2000);

    if (await checkForCaptcha(page)) return [];

    // Xác nhận đã vào đúng News tab + Past week filter
    const finalUrl = page.url();
    const hasNewsTab   = finalUrl.includes('tbm=nws');
    const hasPastWeek  = finalUrl.includes('tbs=qdr');
    if (!hasNewsTab || !hasPastWeek) {
      log.warn(`Filter not applied correctly (url=${finalUrl}). Retrying…`);
      // Thử lần 2 bằng cách navigate trực tiếp
      const retryUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws&tbs=qdr:w&hl=vi&gl=vn`;
      await page.goto(retryUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
      await sleep(1000, 2000);
      if (await checkForCaptcha(page)) return [];
    } else {
      log.info(`Filter confirmed: News tab + Past week ✓`);
    }

    // ── Bước 4: Extract cards ─────────────────────────────────────────────────
    const cards = await extractArticleCards(page);

    log.found(cards.length, query);
    if (cards.length === 0) log.warn(`Query "${query}" returned 0 results.`);

    // Lưu cookies sau mỗi search thành công → giảm CAPTCHA lần sau
    await saveGoogleSession();

    return cards;

  } catch (err) {
    log.warn(`searchGoogleNews failed for "${query}": ${err.message}`);
    return [];
    // Không đóng page — tab dùng chung, chỉ đóng khi closeBrowser()
  }
}

module.exports = { searchGoogleNews };
