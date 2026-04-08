# Insurance News Crawler

A production-ready Node.js + Playwright crawler that collects Google News
articles for 9 Vietnamese insurance brands and exports them to a UTF-8
(BOM) CSV file ready for Excel on Windows.

---

## Project Structure

```
insurance-crawler/
├── package.json
├── .env.example
├── README.md
├── output/                       # CSV files written here
└── src/
    ├── index.js                  # Entry point
    ├── config/
    │   └── brands.js             # Brand list & search queries
    ├── crawler/
    │   ├── browser.js            # Playwright browser/page lifecycle
    │   ├── google.js             # Google Search → News → Past week
    │   └── article.js            # Article page scraping
    ├── parser/
    │   ├── dateParser.js         # publish_date extraction (7 fallbacks)
    │   └── urlParser.js          # URL normalisation & redirect resolution
    ├── output/
    │   ├── csvWriter.js          # Incremental UTF-8 BOM CSV writer
    │   └── logger.js             # Structured console logger
    └── utils/
        └── deduper.js            # Global URL deduplication
```

---

## Installation

```bash
# 1. Clone / download the project, then enter the directory
cd insurance-crawler

# 2. Install Node dependencies
npm install

# 3. Download Playwright's Chromium binary (~170 MB)
npx playwright install chromium

# 4. Copy the example env file and adjust if needed
cp .env.example .env
```

> **Node version:** 18 or higher required (for built-in `URL`, `fs.createWriteStream`, etc.)

---

## Running

```bash
# Headful mode (browser window visible – recommended for first runs)
npm start

# Headless mode (no browser window – suitable for servers / CI)
npm run start:headless

# Or pass the flag directly
node src/index.js --headless
```

---

## Configuration

All runtime settings live in `.env` (copy from `.env.example`):

| Variable             | Default | Description                                      |
|----------------------|---------|--------------------------------------------------|
| `HEADLESS`           | `false` | Set `true` to hide the browser window            |
| `ARTICLE_CONCURRENCY`| `3`     | Max parallel article fetches per query           |
| `PAGE_TIMEOUT`       | `30000` | Navigation timeout in ms                         |
| `SEARCH_DELAY_MIN`   | `3000`  | Min delay between Google searches (ms)           |
| `SEARCH_DELAY_MAX`   | `6000`  | Max delay between Google searches (ms)           |
| `ARTICLE_DELAY_MIN`  | `500`   | Min delay between article fetches (ms)           |
| `ARTICLE_DELAY_MAX`  | `1500`  | Max delay between article fetches (ms)           |
| `CAPTCHA_PAUSE_MS`   | `30000` | Pause duration when CAPTCHA detected (ms)        |
| `OUTPUT_DIR`         | `output`| Directory for CSV output files                   |

---

## Output Format

File name: `output/articles_YYYYMMDD_HHmmss.csv`

| Column            | Example                              |
|-------------------|--------------------------------------|
| `brand`           | Prudential Việt Nam                  |
| `article_title`   | Prudential ra mắt sản phẩm mới…     |
| `article_url`     | https://vnexpress.net/…              |
| `publisher_domain`| vnexpress.net                        |
| `publish_date`    | 2024-03-15T03:00:00.000Z             |

- Encoding: **UTF-8 with BOM** – opens correctly in Excel on Windows
- Dates are ISO 8601 (UTC); blank if no date could be extracted
- Articles are deduplicated globally across all brands and queries

---

## How It Works

1. **Brand & query loop** – processes brands sequentially, queries sequentially
2. **Google Search** – navigates to google.com, accepts consent, types query,
   clicks the News tab, applies the "Past week" time filter
3. **Article card extraction** – scrapes result cards using multiple selector
   fallbacks (Google's HTML changes frequently)
4. **Deduplication** – normalised URLs are checked against a global `Set`;
   duplicates are skipped and logged
5. **Article fetching** – up to 3 articles fetched in parallel (configurable);
   each page is opened in a fresh browser context
6. **Date extraction** – 7-level fallback chain:
   `time[datetime]` → `article:published_time` meta → `pubdate` meta →
   `DC.date.issued` meta → JSON-LD → `og:updated_time` → visible text regex
7. **CSV writing** – rows written incrementally so partial results survive
   early termination

---

## Logging

Every significant event is logged to stdout with an ISO timestamp and a
bracketed tag:

```
[START]    Brand: Prudential Việt Nam, Query: "Prudential VN"
[FOUND]    12 articles for query "Prudential VN"
[FETCH]    Opening article: https://tuoitre.vn/…
[DATE]     Found publish_date via JSON-LD datePublished: 2024-03-15T03:00:00.000Z
[SKIP]     Duplicate: https://vnexpress.net/…
[DONE]     Brand: Prudential Việt Nam | Queries: 2 | Articles found: 20 | Errors: 0
[SUMMARY]  Total articles: 143 | Total errors: 2 | Output: output/articles_…csv
```

To save logs to a file:
```bash
npm start 2>&1 | tee run.log
```

---

## Troubleshooting

### CAPTCHA / "unusual traffic"
Google may show a CAPTCHA if requests come too fast.  The crawler:
- Detects the CAPTCHA page automatically
- Pauses for `CAPTCHA_PAUSE_MS` (default 30 s) in headful mode so you can
  solve it manually
- Logs `[CAPTCHA]` events

**Prevention tips:**
- Run in headful mode (`npm start`) for initial testing
- Increase `SEARCH_DELAY_MIN` / `SEARCH_DELAY_MAX` in `.env`
- Spread runs across different times of day

### Selector changes (Google redesign)
Google regularly changes its HTML structure. If article counts drop to 0:
1. Open Chrome DevTools on a Google News results page
2. Find the anchor element that wraps a headline
3. Update the selector list in `src/crawler/google.js` → `extractArticleCards()`

The file is clearly commented with `// Strategy 1` / `// Strategy 2` blocks.

### Vietnamese locale not rendering correctly
- The browser is launched with `locale: 'vi-VN'` and
  `Accept-Language: vi-VN,vi;q=0.9`
- If Google still shows English labels, both Vietnamese and English label
  variants are checked in `google.js`

### Excel shows garbled text
- The CSV is written with a UTF-8 BOM (`\uFEFF`) which signals Excel to use
  UTF-8 encoding
- If Excel still garbles: use **Data → From Text/CSV** and choose UTF-8

### `p-limit` import error
This project uses **p-limit v3** (CommonJS-compatible).  If you see an
`ERR_REQUIRE_ESM` error, ensure `package.json` does **not** have
`"type": "module"` (this project is plain CommonJS).

### Playwright "Executable doesn't exist"
Run:
```bash
npx playwright install chromium
```
