/*
 * Curated country list + region-derivation map for the Profile → Location
 * combobox. The list powers type-ahead; picking a country seeds sensible
 * default `acceptedRegions` (the user can then edit the chips). Free-text entry
 * outside this list is still allowed by the combobox — this is a convenience
 * set, not an allow-list. Persona-neutral: no country is special.
 */

interface CountryDef {
  name: string;
  /** Lowercased region terms this country implies for acceptedRegions. */
  regions: string[];
}

// Region bundles reused across countries, kept lowercase to match the
// case-insensitive geo filter.
const EUROPE = ['europe', 'emea', 'eu'];
const NORTH_AMERICA = ['north america', 'usa', 'us'];
const LATAM = ['latam', 'latin america', 'south america'];
const APAC = ['apac', 'asia'];
const MEA = ['emea', 'middle east'];
const AFRICA = ['emea', 'africa'];
const OCEANIA = ['apac', 'oceania'];

const COUNTRY_DEFS: CountryDef[] = [
  { name: 'Spain', regions: EUROPE },
  { name: 'Portugal', regions: EUROPE },
  { name: 'France', regions: EUROPE },
  { name: 'Germany', regions: EUROPE },
  { name: 'Italy', regions: EUROPE },
  { name: 'Netherlands', regions: EUROPE },
  { name: 'Belgium', regions: EUROPE },
  { name: 'Ireland', regions: EUROPE },
  { name: 'United Kingdom', regions: ['europe', 'emea', 'uk'] },
  { name: 'Poland', regions: EUROPE },
  { name: 'Sweden', regions: EUROPE },
  { name: 'Norway', regions: EUROPE },
  { name: 'Denmark', regions: EUROPE },
  { name: 'Finland', regions: EUROPE },
  { name: 'Switzerland', regions: EUROPE },
  { name: 'Austria', regions: EUROPE },
  { name: 'Czechia', regions: EUROPE },
  { name: 'Romania', regions: EUROPE },
  { name: 'Greece', regions: EUROPE },
  { name: 'Ukraine', regions: EUROPE },
  { name: 'United States', regions: NORTH_AMERICA },
  { name: 'Canada', regions: ['north america', 'canada'] },
  { name: 'Mexico', regions: ['latam', 'north america'] },
  { name: 'Brazil', regions: LATAM },
  { name: 'Argentina', regions: LATAM },
  { name: 'Chile', regions: LATAM },
  { name: 'Colombia', regions: LATAM },
  { name: 'Peru', regions: LATAM },
  { name: 'Uruguay', regions: LATAM },
  { name: 'India', regions: APAC },
  { name: 'Singapore', regions: APAC },
  { name: 'Japan', regions: APAC },
  { name: 'China', regions: APAC },
  { name: 'Indonesia', regions: APAC },
  { name: 'Philippines', regions: APAC },
  { name: 'Vietnam', regions: APAC },
  { name: 'Australia', regions: OCEANIA },
  { name: 'New Zealand', regions: OCEANIA },
  { name: 'United Arab Emirates', regions: MEA },
  { name: 'Israel', regions: MEA },
  { name: 'Saudi Arabia', regions: MEA },
  { name: 'Turkey', regions: ['europe', 'emea', 'middle east'] },
  { name: 'South Africa', regions: AFRICA },
  { name: 'Nigeria', regions: AFRICA },
  { name: 'Egypt', regions: ['emea', 'africa', 'middle east'] },
  { name: 'Kenya', regions: AFRICA },
];

export const COUNTRIES: string[] = COUNTRY_DEFS.map((c) => c.name);

const REGIONS_BY_COUNTRY = new Map<string, string[]>(
  COUNTRY_DEFS.map((c) => [c.name.toLowerCase(), c.regions]),
);

/**
 * Derive default `acceptedRegions` for a country: the country name itself plus
 * the region bundle it belongs to. Returns just the lowercased free-text term
 * when the country isn't in the curated list (so custom entries still seed a
 * usable chip).
 */
export function regionsForCountry(country: string): string[] {
  const key = country.trim().toLowerCase();
  if (!key) return [];
  const bundle = REGIONS_BY_COUNTRY.get(key) ?? [];
  return Array.from(new Set([key, ...bundle]));
}
