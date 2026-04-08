'use strict';

/**
 * Brand definitions for the insurance crawler.
 *
 * Each entry contains:
 *   brand  – canonical display name written to the CSV
 *   queries – one or more Google search strings to use for this brand.
 *             Multiple queries widen coverage (e.g. different spellings,
 *             abbreviations, or English ↔ Vietnamese variants).
 */
const BRANDS = [
  {
    brand: 'Sun Life Việt Nam',
    aliases: ['Sun Life Việt Nam', 'Sun Life VN', 'Sun Life'],
    queries: [
      'Sun Life Việt Nam',
      '"Sun Life"',
      'Sun Life VN tin tức',
    ],
  },
  {
    brand: 'Chubb Life Việt Nam',
    aliases: ['Chubb Life Việt Nam', 'Chubb Life VN', 'Chubb Life'],
    queries: [
      'Chubb Life Việt Nam',
      '"Chubb Life"',    ],
  },
  {
    brand: 'FWD Việt Nam',
    aliases: ['FWD Việt Nam', 'FWD VN', 'FWD'],
    queries: [
      'FWD Việt Nam bảo hiểm',
      'FWD VN tin tức',
    ],
  },
  {
    brand: 'Dai-ichi Life Việt Nam',
    aliases: ['Dai-ichi Life Việt Nam', 'Dai-ichi Life VN', 'Dai-ichi Life'],
    queries: [
      'Dai-ichi Life Việt Nam',
      'Dai-ichi Life VN bảo hiểm nhân thọ',
    ],
  },
  {
    brand: 'AIA Việt Nam',
    aliases: ['AIA Việt Nam', 'AIA VN', 'AIA'],
    queries: [
      'AIA Việt Nam bảo hiểm',
      'AIA VN tin tức',
    ],
  },
  {
    brand: 'Bảo Việt Nhân Thọ',
    aliases: ['Bảo Việt Nhân Thọ', 'Bao Viet Nhan Tho', 'Baoviet Life', 'Bảo Việt Life'],
    queries: [
      'Bảo Việt Nhân Thọ',
      'Baoviet Life tin tức',
    ],
  },
  {
    brand: 'Prudential Việt Nam',
    aliases: ['Prudential Việt Nam', 'Prudential VN', 'Prudential'],
    queries: [
      'Prudential Việt Nam bảo hiểm',
      'Prudential VN tin tức',
    ],
  },
  {
    brand: 'Manulife Việt Nam',
    aliases: ['Manulife Việt Nam', 'Manulife VN', 'Manulife'],
    queries: [
      'Manulife Việt Nam bảo hiểm',
      'Manulife VN tin tức',
    ],
  },
  {
    brand: 'Generali Việt Nam',
    aliases: ['Generali Việt Nam', 'Generali VN', 'Generali'],
    queries: [
      'Generali Việt Nam bảo hiểm',
      'Generali VN tin tức',
    ],
  },
];

module.exports = { BRANDS };
