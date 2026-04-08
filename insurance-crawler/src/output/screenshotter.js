'use strict';

/**
 * Article screenshot utility.
 *
 * Chụp phần đầu bài báo (header + tiêu đề + mở đầu nội dung) theo tỷ lệ 1:1.
 *
 * Cách thực hiện:
 *   1. Set viewport về 800×800 → trang render ở chiều rộng 800px
 *   2. Scroll về đầu trang
 *   3. Chờ 1s để ảnh/font render xong
 *   4. Chụp toàn bộ viewport (800×800) → tỷ lệ 1:1, thấy rõ tiêu đề
 *
 * Tên file: {brand}_{domain}_{YYYYMMDD}_{hash6}.png
 * Ví dụ:    generali_viet_nam_baotinmanhai.vn_20260404_a3f2b1.png
 */

const fs   = require('fs');
const path = require('path');
const log  = require('./logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Bỏ dấu tiếng Việt, chuyển về slug an toàn cho tên file.
 * "Generali Việt Nam" → "generali_viet_nam"
 */
function slugify(str) {
  if (!str) return 'unknown';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // bỏ combining marks (dấu)
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9.\-]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/**
 * ISO 8601 → YYYYMMDD theo giờ Việt Nam (UTC+7).
 * Trả về "nodate" nếu không có ngày.
 */
function isoToDateSlug(isoString) {
  if (!isoString) return 'nodate';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'nodate';
  const vn  = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${vn.getUTCFullYear()}${pad(vn.getUTCMonth() + 1)}${pad(vn.getUTCDate())}`;
}

/**
 * Hash 6 ký tự hex từ URL → tránh trùng tên file khi cùng brand+domain+ngày.
 */
function shortHash(url) {
  let h = 5381;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) + h) ^ url.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 6);
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Chụp màn hình 800×800 px phần đầu bài báo và lưu PNG.
 *
 * @param {import('playwright').Page} page
 * @param {object}      opts
 * @param {string}      opts.brand            Tên brand
 * @param {string}      opts.publisherDomain  Domain trang báo
 * @param {string|null} opts.publishDate      ISO 8601 ngày đăng
 * @param {string}      opts.articleUrl       URL bài (dùng tạo hash)
 * @param {string}      opts.screenshotDir    Thư mục lưu ảnh
 * @returns {Promise<string|null>}            Đường dẫn file PNG hoặc null nếu lỗi
 */
async function captureArticleScreenshot(page, {
  brand,
  publisherDomain,
  publishDate,
  articleUrl,
  screenshotDir,
}) {
  try {
    // Tạo thư mục nếu chưa có
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // ── Bước 1: Set viewport 800×800 ─────────────────────────────────────────
    // Trang sẽ render ở chiều rộng 800px → chụp full viewport = 1:1 square
    await page.setViewportSize({ width: 800, height: 800 });

    // ── Bước 2: Scroll về đầu trang ──────────────────────────────────────────
    await page.evaluate(() => window.scrollTo(0, 0));

    // ── Bước 3: Chờ render (ảnh, font, lazy-load) ────────────────────────────
    // Dùng networkidle với timeout ngắn; nếu trang vẫn load ảnh lâu thì
    // waitForTimeout đảm bảo tối thiểu 1.5s để thấy tiêu đề rõ
    await Promise.race([
      page.waitForLoadState('networkidle', { timeout: 5000 }),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => {});

    // ── Bước 4: Chụp toàn bộ viewport (800×800) ──────────────────────────────
    const brandSlug  = slugify(brand);
    const domainSlug = slugify(publisherDomain);
    const dateSlug   = isoToDateSlug(publishDate);
    const hash       = shortHash(articleUrl);
    const filename   = `${brandSlug}_${domainSlug}_${dateSlug}_${hash}.png`;
    const filePath   = path.join(screenshotDir, filename);

    await page.screenshot({
      path: filePath,
      type: 'png',
      fullPage: false,   // chỉ viewport → đúng 800×800
    });

    log.info(`[SCREENSHOT] Saved: ${filename}`);
    return filePath;

  } catch (err) {
    log.warn(`[SCREENSHOT] Failed for ${articleUrl}: ${err.message}`);
    return null;
  }
}

module.exports = { captureArticleScreenshot, slugify, isoToDateSlug };
