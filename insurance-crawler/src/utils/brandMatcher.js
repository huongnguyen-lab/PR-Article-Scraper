'use strict';

/**
 * Brand mention matching helpers.
 *
 * Google News can return topically related articles that do not actually
 * mention the searched brand. We normalise both the brand aliases and the
 * candidate text, then require at least one alias to appear as a standalone
 * phrase before writing the row to CSV.
 */

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildAliasList(brandDef) {
  const rawAliases = [
    brandDef.brand,
    ...(Array.isArray(brandDef.aliases) ? brandDef.aliases : []),
  ];

  return [...new Set(rawAliases.map(normalizeText).filter(Boolean))];
}

function containsAlias(text, aliases) {
  const normalizedText = ` ${normalizeText(text)} `;
  if (!normalizedText.trim()) return false;

  return aliases.some((alias) => normalizedText.includes(` ${alias} `));
}

function cardMatchesBrand(card, brandDef) {
  const aliases = buildAliasList(brandDef);
  if (aliases.length === 0) return true;

  const candidates = [
    card.title,
    card.url,
    card.publisherDomain,
  ];

  return candidates.some((candidate) => containsAlias(candidate, aliases));
}

function resolveBrandForCard(card, brandDefs, fallbackBrandDef) {
  const matches = brandDefs.filter((brandDef) => cardMatchesBrand(card, brandDef));

  if (fallbackBrandDef && matches.some((brandDef) => brandDef.brand === fallbackBrandDef.brand)) {
    return fallbackBrandDef;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  return fallbackBrandDef || null;
}

module.exports = {
  normalizeText,
  buildAliasList,
  containsAlias,
  cardMatchesBrand,
  resolveBrandForCard,
};
