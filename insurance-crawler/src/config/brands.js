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
    queries: [
      'Sun Life Việt Nam bảo hiểm',
      'Sun Life VN tin tức',
    ],
  },
  {
    brand: 'Chubb Life Việt Nam',
    queries: [
      'Chubb Life Việt Nam',
      'Chubb Life VN bảo hiểm nhân thọ',
    ],
  },
  {
    brand: 'FWD Việt Nam',
    queries: [
      'FWD Việt Nam bảo hiểm',
      'FWD VN tin tức',
    ],
  },
  {
    brand: 'Dai-ichi Life Việt Nam',
    queries: [
      'Dai-ichi Life Việt Nam',
      'Dai-ichi Life VN bảo hiểm nhân thọ',
    ],
  },
  {
    brand: 'AIA Việt Nam',
    queries: [
      'AIA Việt Nam bảo hiểm',
      'AIA VN tin tức',
    ],
  },
  {
    brand: 'Bảo Việt Nhân Thọ',
    queries: [
      'Bảo Việt Nhân Thọ',
      'Baoviet Life tin tức',
    ],
  },
  {
    brand: 'Prudential Việt Nam',
    queries: [
      'Prudential Việt Nam bảo hiểm',
      'Prudential VN tin tức',
    ],
  },
  {
    brand: 'Manulife Việt Nam',
    queries: [
      'Manulife Việt Nam bảo hiểm',
      'Manulife VN tin tức',
    ],
  },
  {
    brand: 'Generali Việt Nam',
    queries: [
      'Generali Việt Nam bảo hiểm',
      'Generali VN tin tức',
    ],
  },
];

module.exports = { BRANDS };
