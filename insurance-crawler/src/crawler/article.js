'use strict';

/**
 * Article page scraper.
 *
 * Mở từng URL bài báo trong tab mới, lấy final URL sau redirect,
 * trích xuất publish_date, và chụp màn hình 800×800 px.
 *
 * Concurrency được kiểm soát ở index.js qua p-limit.
 */

const { newArticlePage, closeArticlePage } = require('./browser');
const { extractPublishDate } = require('../parser/dateParser');
const { captureArticleScreenshot } = require('../output/screenshotter');
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
 * Fetch một article page, trích xuất publish_date, và chụp màn hình.
 * Retry 1 lần nếu navigation thất bại.
 *
 * @param {string} url   URL bài báo
 * @param {object} opts
 * @param {string}      opts.brand           Tên brand (để đặt tên ảnh)
 * @param {string}      opts.publisherDomain Domain trang báo (để đặt tên ảnh)
 * @param {string}      opts.screenshotDir   Thư mục lưu ảnh PNG
 *
 * @returns {Promise<{finalUrl:string, publishDate:string|null, screenshotPath:string|null}>}
 */
async function fetchArticle(url, { brand = '', publisherDomain = '', screenshotDir = '' } = {}) {
  const PAGE_TIMEOUT     = parseInt(process.env.PAGE_TIMEOUT      || '30000', 10);
  const ARTICLE_DELAY_MIN = parseInt(process.env.ARTICLE_DELAY_MIN || '500',   10);
  const ARTICLE_DELAY_MAX = parseInt(process.env.ARTICLE_DELAY_MAX || '1500',  10);

  log.fetch(url);

  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    let page;
    try {
      page = await newArticlePage();
      page.setDefaultTimeout(PAGE_TIMEOUT);

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT,
      });

      // URL thật sau redirect
      const finalUrl = page.url();

      // Trích xuất ngày đăng (7 fallback strategies)
      const publishDate = await extractPublishDate(page, url);

      // Chụp màn hình 800×800 (thấy tiêu đề, tỷ lệ 1:1)
      let screenshotPath = null;
      if (screenshotDir) {
        screenshotPath = await captureArticleScreenshot(page, {
          brand,
          publisherDomain,
          publishDate,
          articleUrl: finalUrl,
          screenshotDir,
        });
      }

      await randomDelay(ARTICLE_DELAY_MIN, ARTICLE_DELAY_MAX);

      return { finalUrl, publishDate, screenshotPath };

    } catch (err) {
      attempt++;
      if (attempt < maxAttempts) {
        log.warn(`Retrying article (attempt ${attempt + 1}): ${url} — ${err.message}`);
        await randomDelay(1000, 2000);
      } else {
        log.error(url, err.message);
        return { finalUrl: url, publishDate: null, screenshotPath: null };
      }
    } finally {
      if (page) await closeArticlePage(page);
    }
  }

  return { finalUrl: url, publishDate: null, screenshotPath: null };
}

module.exports = { fetchArticle };
