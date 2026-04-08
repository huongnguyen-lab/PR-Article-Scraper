'use strict';

/**
 * Incremental CSV writer.
 *
 * Produces a UTF-8 BOM-encoded CSV so Vietnamese text displays correctly when
 * opened in Microsoft Excel on Windows.
 *
 * Column order (fixed):
 *   brand | article_title | article_url | publisher_domain | publish_date
 *
 * Usage:
 *   const writer = createCsvWriter(filePath);
 *   await writer.writeRow({ brand, article_title, article_url, publisher_domain, publish_date });
 *   // …repeat for each article…
 *   await writer.finalize(); // flushes and closes the stream
 */

const fs = require('fs');
const path = require('path');
const log = require('./logger');

// UTF-8 BOM – required for Excel to recognise the encoding
const BOM = '\uFEFF';

// Column definitions in output order
const COLUMNS = [
  'brand',
  'article_title',
  'article_url',
  'publisher_domain',
  'publisher_homepage',   // trang chủ của báo, vd: https://vnexpress.net
  'publish_date',
];

/**
 * Escape a single CSV field value:
 *   - Wrap in double-quotes if the value contains commas, quotes, or newlines
 *   - Escape existing double-quotes by doubling them
 *
 * @param {string|null|undefined} val
 * @returns {string}
 */
function escapeCsvField(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Format a row object as a CSV line (no trailing newline).
 *
 * @param {Record<string,string|null>} row
 * @returns {string}
 */
function rowToCsvLine(row) {
  return COLUMNS.map((col) => escapeCsvField(row[col])).join(',');
}

/**
 * Create an incremental CSV writer for the given file path.
 *
 * The file is created immediately (with BOM + header row) so that partial
 * results are saved even if the run is interrupted.
 *
 * @param {string} filePath  Absolute or relative path to the output CSV
 * @returns {{ writeRow: Function, finalize: Function }}
 */
function createCsvWriter(filePath) {
  // Ensure the output directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Open write stream and emit BOM + header immediately
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  stream.write(BOM);
  stream.write(COLUMNS.join(',') + '\n');

  log.info(`CSV writer initialised: ${filePath}`);

  let rowsWritten = 0;
  let streamClosed = false;

  /**
   * Append a single article row to the CSV.
   *
   * @param {object} row
   * @param {string}      row.brand
   * @param {string}      row.article_title
   * @param {string}      row.article_url
   * @param {string}      row.publisher_domain
   * @param {string|null} row.publish_date
   * @returns {Promise<void>}
   */
  function writeRow(row) {
    return new Promise((resolve, reject) => {
      if (streamClosed) {
        reject(new Error('CSV stream is already closed'));
        return;
      }
      const line = rowToCsvLine(row) + '\n';
      const ok = stream.write(line, 'utf8', (err) => {
        if (err) reject(err);
        else {
          rowsWritten++;
          resolve();
        }
      });
      // Back-pressure: if write returns false, wait for 'drain' before resolving
      if (!ok) {
        stream.once('drain', resolve);
      }
    });
  }

  /**
   * Flush and close the CSV write stream.
   * Must be called once at the end of the run.
   *
   * @returns {Promise<void>}
   */
  function finalize() {
    return new Promise((resolve, reject) => {
      if (streamClosed) {
        resolve();
        return;
      }
      stream.end(() => {
        streamClosed = true;
        log.info(`CSV finalised. ${rowsWritten} rows written to ${filePath}`);
        resolve();
      });
      stream.once('error', reject);
    });
  }

  return { writeRow, finalize };
}

/**
 * Build a timestamped output file path.
 * Example: output/articles_20240315_143022.csv
 *
 * @param {string} [outputDir='output']
 * @returns {string}
 */
function buildOutputPath(outputDir = 'output') {
  const now = new Date();
  const pad = (n, d = 2) => String(n).padStart(d, '0');
  const timestamp =
    `${now.getFullYear()}` +
    `${pad(now.getMonth() + 1)}` +
    `${pad(now.getDate())}_` +
    `${pad(now.getHours())}` +
    `${pad(now.getMinutes())}` +
    `${pad(now.getSeconds())}`;
  return path.join(outputDir, `articles_${timestamp}.csv`);
}

module.exports = { createCsvWriter, buildOutputPath };
