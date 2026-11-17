import { Country, State } from "country-state-city";
import type { ICity } from "country-state-city";

/** Real-world location suggestions for the client "target locations" field —
 * backed by country-state-city's ISO country/state data (loaded eagerly,
 * ~600KB) and its worldwide city list (~7MB, dynamically imported only once
 * the user actually searches for a city, so it never weighs down the
 * initial page load). */

export type LocationOption = {
  value: string;
  kind: "country" | "city";
};

const countries = Country.getAllCountries();

const countryNameByCode = new Map(countries.map((c) => [c.isoCode, c.name]));
const stateNameByCode = new Map(State.getAllStates().map((s) => [`${s.countryCode}|${s.isoCode}`, s.name]));

const COUNTRY_OPTIONS: LocationOption[] = countries
  .map((c) => ({ value: c.name, kind: "country" as const }))
  .sort((a, b) => a.value.localeCompare(b.value));

let citiesPromise: Promise<ICity[]> | null = null;

function loadCities(): Promise<ICity[]> {
  citiesPromise ??= import("country-state-city").then((mod) => mod.City.getAllCities());
  return citiesPromise;
}

function formatCity(city: ICity): string {
  const country = countryNameByCode.get(city.countryCode) ?? city.countryCode;
  const state = city.stateCode ? stateNameByCode.get(`${city.countryCode}|${city.stateCode}`) : undefined;
  return state ? `${city.name}, ${state}, ${country}` : `${city.name}, ${country}`;
}

const MAX_COUNTRY_MATCHES = 6;
const MAX_CITY_MATCHES = 20;
const MAX_CITY_CANDIDATES = 400;

/** country-state-city has no population data to rank results by, and a
 * plain name-length tiebreak still loses to small towns that happen to
 * share a name with a well-known city (there are ~20 real places called
 * "San Francisco" worldwide). This is a small, hand-picked set of real,
 * globally-recognized cities used only to break ties in favor of the
 * place a user most likely meant -- it never restricts what can be
 * searched or selected, the full worldwide dataset still applies. */
const MAJOR_CITIES = new Set(
  [
    "New York|US", "Los Angeles|US", "Chicago|US", "Houston|US", "San Francisco|US", "Seattle|US",
    "Boston|US", "Austin|US", "Miami|US", "Atlanta|US", "Dallas|US", "Denver|US", "Washington|US",
    "Philadelphia|US", "San Diego|US", "Las Vegas|US", "Portland|US", "Detroit|US", "Phoenix|US",
    "Toronto|CA", "Vancouver|CA", "Montreal|CA", "Ottawa|CA", "Calgary|CA",
    "Mexico City|MX", "Guadalajara|MX", "Monterrey|MX",
    "Sao Paulo|BR", "Rio de Janeiro|BR", "Brasilia|BR",
    "Buenos Aires|AR", "Bogota|CO", "Lima|PE", "Santiago|CL", "Caracas|VE", "Quito|EC",
    "London|GB", "Manchester|GB", "Birmingham|GB", "Edinburgh|GB", "Glasgow|GB", "Liverpool|GB",
    "Paris|FR", "Marseille|FR", "Lyon|FR",
    "Berlin|DE", "Munich|DE", "Hamburg|DE", "Frankfurt|DE", "Cologne|DE",
    "Madrid|ES", "Barcelona|ES", "Valencia|ES",
    "Rome|IT", "Milan|IT", "Naples|IT", "Turin|IT",
    "Amsterdam|NL", "Rotterdam|NL", "Brussels|BE", "Vienna|AT", "Zurich|CH", "Geneva|CH",
    "Lisbon|PT", "Porto|PT", "Dublin|IE", "Stockholm|SE", "Oslo|NO", "Copenhagen|DK", "Helsinki|FI",
    "Warsaw|PL", "Prague|CZ", "Budapest|HU", "Athens|GR", "Istanbul|TR", "Ankara|TR",
    "Moscow|RU", "Saint Petersburg|RU", "Kyiv|UA",
    "Cairo|EG", "Lagos|NG", "Nairobi|KE", "Johannesburg|ZA", "Cape Town|ZA", "Casablanca|MA",
    "Dubai|AE", "Abu Dhabi|AE", "Riyadh|SA", "Doha|QA", "Tel Aviv|IL", "Jerusalem|IL",
    "Karachi|PK", "Lahore|PK", "Islamabad|PK", "Dhaka|BD",
    "Mumbai|IN", "Delhi|IN", "Bangalore|IN", "Chennai|IN", "Kolkata|IN", "Hyderabad|IN",
    "Beijing|CN", "Shanghai|CN", "Shenzhen|CN", "Guangzhou|CN", "Hong Kong|HK",
    "Tokyo|JP", "Osaka|JP", "Yokohama|JP", "Seoul|KR", "Busan|KR",
    "Singapore|SG", "Bangkok|TH", "Jakarta|ID", "Manila|PH", "Kuala Lumpur|MY", "Hanoi|VN",
    "Ho Chi Minh City|VN", "Sydney|AU", "Melbourne|AU", "Brisbane|AU", "Perth|AU", "Auckland|NZ",
  ]
);

/** Countries are always cheap to search. Cities only start matching once
 * the query is at least 2 characters, both to avoid an overly broad result
 * set and to delay triggering the (one-time) city-data download. */
export async function searchLocations(query: string): Promise<LocationOption[]> {
  const q = query.trim().toLowerCase();

  if (!q) {
    return COUNTRY_OPTIONS.slice(0, 15);
  }

  const matchingCountries = COUNTRY_OPTIONS.filter((c) => c.value.toLowerCase().includes(q)).slice(
    0,
    MAX_COUNTRY_MATCHES
  );

  if (q.length < 2) {
    return matchingCountries;
  }

  const cities = await loadCities();
  const candidates: { option: LocationOption; major: boolean; nameLength: number }[] = [];
  for (const city of cities) {
    if (candidates.length >= MAX_CITY_CANDIDATES) break;
    if (city.name.toLowerCase().includes(q)) {
      candidates.push({
        option: { value: formatCity(city), kind: "city" },
        major: MAJOR_CITIES.has(`${city.name}|${city.countryCode}`),
        nameLength: city.name.length,
      });
    }
  }
  // Known major cities first, then shortest name as a cheap proxy for "the
  // place you probably meant" among the rest -- e.g. "San Francisco" over
  // "San Francisco del Monte de Oro" if it weren't already on the list above.
  candidates.sort((a, b) => Number(b.major) - Number(a.major) || a.nameLength - b.nameLength);
  const matchingCities = candidates.slice(0, MAX_CITY_MATCHES).map((c) => c.option);

  return [...matchingCountries, ...matchingCities];
}

/** A previously-saved location string (e.g. loaded back from the API) has
 * no attached "kind" -- infer it the same way it was formatted: a country
 * entry is just the country name, a city entry always has at least one
 * comma (city, [state,] country). */
export function inferLocationKind(value: string): LocationOption["kind"] {
  return value.includes(",") ? "city" : "country";
}
