/**
 * Item do actor LinkedIn → oferta do pipeline.
 * Sem título ou sem URL, fora. A descrição não entra na oferta.
 */

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstText(values) {
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return '';
}

export function normalizeLinkedInItem(item) {
  if (!item || typeof item !== 'object') {
    return {
      title: '',
      company: '',
      url: '',
      location: '',
      source: 'scan-linkedin',
    };
  }
  const postedAt = Date.parse(text(item.postedDate));
  const offer = {
    title: firstText([item.title, item.jobTitle]),
    company: firstText([item.company, item.companyName]),
    url: firstText([item.url, item.jobUrl, item.link]),
    location: firstText([item.location, item.jobLocation]),
    source: 'scan-linkedin',
  };
  if (Number.isFinite(postedAt) && postedAt > 0) offer.postedAt = postedAt;
  return offer;
}

export function normalizeLinkedInItems(items) {
  return items
    .map(normalizeLinkedInItem)
    .filter((offer) => offer.title && offer.url);
}
