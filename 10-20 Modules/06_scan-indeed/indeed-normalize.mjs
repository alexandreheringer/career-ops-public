/**
 * Item do actor Indeed → oferta do pipeline.
 * Sem título ou sem URL, fora. jobKey só entra com caracteres seguros.
 */

import { isTargetLocation } from './location-allow.mjs';

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

function jobUrlFromKey(key) {
  if (typeof key === 'string' && /^[A-Za-z0-9]+$/.test(key)) {
    return `https://www.indeed.com/viewjob?jk=${key}`;
  }
  return '';
}

function jobTypeIsRemote(jobType) {
  if (typeof jobType === 'string') {
    return jobType.toLowerCase().includes('remote');
  }
  if (Array.isArray(jobType)) {
    return jobType.some((part) => text(part).toLowerCase().includes('remote'));
  }
  return false;
}

function itemIsRemote(item) {
  return (
    item.remote === true ||
    item.isRemote === true ||
    jobTypeIsRemote(item.jobType)
  );
}

function composedLocation(item) {
  const explicit = text(item.location);
  if (explicit) return explicit;
  const parts = [item.city, item.state ?? item.region, item.country]
    .map((part) => text(part))
    .filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  if (itemIsRemote(item)) return 'Remote';
  return '';
}

export function normalizeIndeedItem(item) {
  if (!item || typeof item !== 'object') {
    return {
      title: '',
      company: '',
      url: '',
      location: '',
      source: 'scan-indeed',
    };
  }
  let location = composedLocation(item);
  const stamp = text(item.__searchLocation);
  if (location && stamp && !isTargetLocation(location)) {
    location = `${location}, ${stamp}`;
  }
  return {
    title: firstText([
      item.title,
      item.displayTitle,
      item.jobTitle,
      item.position,
      item.name,
    ]),
    company: firstText([
      item.companyName,
      item.company?.name,
      item.company,
      item.employerName,
      item.hiringOrganization?.name,
    ]),
    url: firstText([
      item.externalApplyUrl,
      item.thirdPartyApplyUrl,
      item.jobUrl,
      item.url,
      item.link,
      item.applyUrl,
      item.viewJobLink,
      item.source_link,
      jobUrlFromKey(item.jobKey),
      jobUrlFromKey(item.jobkey),
    ]),
    location,
    source: 'scan-indeed',
  };
}

export function normalizeIndeedItems(items) {
  return items
    .map(normalizeIndeedItem)
    .filter((offer) => offer.title && offer.url);
}
