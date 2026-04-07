import 'dotenv/config';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, 'data', 'expresscare-locations.json');

interface ExpressCareLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  county: string;
  lat: number;
  lng: number;
  hasChildrensUrgentCare: boolean;
  geocodeSource: 'census' | 'nominatim';
}

const LOCATIONS: Array<{
  id: string; name: string; address: string; city: string; county: string;
  hasChildrensUrgentCare: boolean;
}> = [
  // Baltimore City & County
  { id: 'overlea', name: 'ExpressCare Overlea', address: '8039 Belair Rd', city: 'Baltimore', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'essex', name: 'ExpressCare Essex', address: '700 Eastern Blvd', city: 'Essex', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'dundalk', name: 'ExpressCare Dundalk', address: '1700 Merritt Blvd', city: 'Dundalk', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'middle-river', name: 'ExpressCare Middle River', address: '1025 Eastern Blvd', city: 'Middle River', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'parkville', name: 'ExpressCare Parkville', address: '8640 Loch Raven Blvd', city: 'Towson', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'towson', name: 'ExpressCare Towson', address: '1 W Pennsylvania Ave', city: 'Towson', county: 'Baltimore County', hasChildrensUrgentCare: true },
  { id: 'arbutus', name: 'ExpressCare Arbutus', address: '3815 Wilkens Ave', city: 'Baltimore', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'quarry-lake', name: 'ExpressCare Quarry Lake', address: '4400 Quarry Lake Dr', city: 'Baltimore', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'rosedale', name: 'ExpressCare Rosedale', address: '8920 Philadelphia Rd', city: 'Rosedale', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'white-marsh', name: 'ExpressCare White Marsh', address: '5212 Campbell Blvd', city: 'White Marsh', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'perry-hall', name: 'ExpressCare Perry Hall', address: '9609 Belair Rd', city: 'Perry Hall', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'catonsville', name: 'ExpressCare Catonsville', address: '5424 Baltimore National Pike', city: 'Catonsville', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'pikesville', name: 'ExpressCare Pikesville', address: '1440 Reisterstown Rd', city: 'Pikesville', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'owings-mills', name: 'ExpressCare Owings Mills', address: '9114 Reisterstown Rd', city: 'Owings Mills', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'reisterstown', name: 'ExpressCare Reisterstown', address: '11726 Reisterstown Rd', city: 'Reisterstown', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'cockeysville', name: 'ExpressCare Cockeysville', address: '555 Cranbrook Rd', city: 'Cockeysville', county: 'Baltimore County', hasChildrensUrgentCare: false },
  { id: 'near-sinai', name: 'ExpressCare Near Sinai Hospital', address: '2600 W Belvedere Ave', city: 'Baltimore', county: 'Baltimore City', hasChildrensUrgentCare: false },
  // Harford & Cecil
  { id: 'bel-air', name: 'ExpressCare Bel Air', address: '5 Bel Air S Pkwy', city: 'Bel Air', county: 'Harford County', hasChildrensUrgentCare: true },
  { id: 'edgewood', name: 'ExpressCare Edgewood', address: '1019 Pulaski Hwy', city: 'Edgewood', county: 'Harford County', hasChildrensUrgentCare: false },
  { id: 'belcamp', name: 'ExpressCare Belcamp', address: 'vicinity James Run', city: 'Belcamp', county: 'Harford County', hasChildrensUrgentCare: false },
  { id: 'havre-de-grace', name: 'ExpressCare Havre de Grace', address: '501 Franklin St', city: 'Havre de Grace', county: 'Harford County', hasChildrensUrgentCare: false },
  { id: 'north-east', name: 'ExpressCare North East', address: '106 North East Plaza', city: 'North East', county: 'Cecil County', hasChildrensUrgentCare: false },
  // Carroll
  { id: 'westminster', name: 'ExpressCare Westminster', address: '540 Jermor Ln', city: 'Westminster', county: 'Carroll County', hasChildrensUrgentCare: true },
  { id: 'mt-airy', name: 'ExpressCare Mt. Airy', address: '1400 S Main St', city: 'Mt Airy', county: 'Carroll County', hasChildrensUrgentCare: false },
  { id: 'eldersburg', name: 'ExpressCare Eldersburg', address: '1380 Progress Way', city: 'Eldersburg', county: 'Carroll County', hasChildrensUrgentCare: false },
  // Anne Arundel / Howard
  { id: 'glen-burnie', name: 'ExpressCare Glen Burnie', address: '7485 Baltimore Annapolis Blvd', city: 'Glen Burnie', county: 'Anne Arundel County', hasChildrensUrgentCare: false },
  { id: 'hanover', name: 'ExpressCare Hanover', address: '7306 Parkway Dr S', city: 'Hanover', county: 'Anne Arundel County', hasChildrensUrgentCare: false },
  { id: 'ellicott-city', name: 'ExpressCare Ellicott City', address: '9150 Baltimore National Pike', city: 'Ellicott City', county: 'Howard County', hasChildrensUrgentCare: false },
  // Prince George's
  { id: 'laurel', name: 'ExpressCare Laurel', address: '312 Main St', city: 'Laurel', county: "Prince George's County", hasChildrensUrgentCare: false },
  // Frederick / Washington
  { id: 'frederick', name: 'ExpressCare Frederick', address: '1305 W 7th St', city: 'Frederick', county: 'Frederick County', hasChildrensUrgentCare: false },
  { id: 'urbana', name: 'ExpressCare Urbana', address: '3520 Urbana Pike', city: 'Frederick', county: 'Frederick County', hasChildrensUrgentCare: false },
  { id: 'hagerstown', name: 'ExpressCare Hagerstown', address: '1700 Dual Hwy', city: 'Hagerstown', county: 'Washington County', hasChildrensUrgentCare: false },
  // Eastern Shore
  { id: 'salisbury', name: 'ExpressCare Salisbury', address: '2625 N Salisbury Blvd', city: 'Salisbury', county: 'Wicomico County', hasChildrensUrgentCare: false },
];

async function geocodeCensus(address: string, city: string): Promise<{ lat: number; lng: number } | null> {
  const full = `${address}, ${city}, MD`;
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(full)}&benchmark=Public_AR_Current&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as { result?: { addressMatches?: Array<{ coordinates: { x: number; y: number } }> } };
    const match = data.result?.addressMatches?.[0];
    if (!match) return null;
    return { lat: match.coordinates.y, lng: match.coordinates.x };
  } catch {
    return null;
  }
}

async function geocodeNominatim(address: string, city: string): Promise<{ lat: number; lng: number } | null> {
  const full = `${address}, ${city}, Maryland, USA`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(full)}&format=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'expresscare-dashboard/0.1 geocoder' },
    });
    if (!res.ok) return null;
    const data = await res.json() as Array<{ lat: string; lon: string }>;
    if (data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  mkdirSync(resolve(import.meta.dirname, 'data'), { recursive: true });

  if (existsSync(OUT) && !process.argv.includes('--force')) {
    console.log(`[geocode-expresscare] Output exists, skipping (use --force to overwrite)`);
    return;
  }

  const results: ExpressCareLocation[] = [];

  for (const loc of LOCATIONS) {
    console.log(`[geocode-expresscare] Geocoding: ${loc.name} (${loc.address}, ${loc.city})`);

    let coords = await geocodeCensus(loc.address, loc.city);
    let source: 'census' | 'nominatim' = 'census';

    if (!coords) {
      console.log(`  Census failed, trying Nominatim...`);
      await new Promise((r) => setTimeout(r, 1100));
      coords = await geocodeNominatim(loc.address, loc.city);
      source = 'nominatim';
    }

    if (!coords) {
      // Try geocoding just the city as a last resort
      console.log(`  Both failed, trying city-level Nominatim...`);
      await new Promise((r) => setTimeout(r, 1100));
      coords = await geocodeNominatim('', loc.city);
      source = 'nominatim';
    }

    if (!coords) {
      console.error(`  FAILED: Could not geocode ${loc.name}`);
      throw new Error(`Geocoding failed for ${loc.name} at ${loc.address}, ${loc.city}`);
    }

    console.log(`  OK: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)} (${source})`);
    results.push({
      id: loc.id,
      name: loc.name,
      address: loc.address,
      city: loc.city,
      county: loc.county,
      lat: coords.lat,
      lng: coords.lng,
      hasChildrensUrgentCare: loc.hasChildrensUrgentCare,
      geocodeSource: source,
    });

    // Small delay between Census calls to be polite
    await new Promise((r) => setTimeout(r, 300));
  }

  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\n[geocode-expresscare] Done: ${results.length} locations written to ${OUT}`);
}

main().catch((err) => {
  console.error('[geocode-expresscare] Fatal:', err);
  process.exit(1);
});
