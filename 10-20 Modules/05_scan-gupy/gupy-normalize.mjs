/**
 * Item do actor zen-studio~gupy-jobs-scraper → oferta do pipeline.
 * Campo ausente cai no próximo nome conhecido; sem título ou sem URL, fora.
 */

export function normalizeGupyItem(item) {
  const company =
    typeof item.company === 'string'
      ? item.company
      : (item.careerPageDisplayName ??
        item.company?.name ??
        item.careerPage?.name ??
        item.companyName ??
        item.employer?.name ??
        '');
  const url = item.jobUrl ?? item.url ?? item.applyUrl ?? '';
  const loc =
    [item.city, item.state].filter(Boolean).join(', ') ||
    item.country ||
    item.location ||
    '';
  return {
    title: item.name ?? item.title ?? item.jobTitle ?? '',
    company,
    url,
    location: loc || 'Brasil',
    source: 'scan-gupy',
  };
}

export function normalizeGupyItems(items) {
  return items
    .map(normalizeGupyItem)
    .filter((offer) => offer.title && offer.url);
}
