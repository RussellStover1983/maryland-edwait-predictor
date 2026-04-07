import 'dotenv/config';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, 'data', 'competitor-locations.json');

interface CompetitorLocation {
  id: string;
  name: string;
  brand: 'PatientFirst' | 'MedStarPromptCare' | 'Righttime';
  address: string;
  city: string;
  lat: number;
  lng: number;
  geocodeSource: 'census' | 'nominatim';
}

const COMPETITORS: Array<{
  id: string; name: string; brand: CompetitorLocation['brand'];
  address: string; city: string;
}> = [
  // Patient First (~15)
  { id: 'pf-nottingham', name: 'Patient First Nottingham', brand: 'PatientFirst', address: '8716 Belair Rd', city: 'Nottingham' },
  { id: 'pf-rosedale', name: 'Patient First Rosedale', brand: 'PatientFirst', address: '6709 Rossville Blvd', city: 'Rosedale' },
  { id: 'pf-white-marsh', name: 'Patient First White Marsh', brand: 'PatientFirst', address: '8113 Sandpiper Cir', city: 'White Marsh' },
  { id: 'pf-timonium', name: 'Patient First Timonium', brand: 'PatientFirst', address: '2324 Pot Spring Rd', city: 'Timonium' },
  { id: 'pf-owings-mills', name: 'Patient First Owings Mills', brand: 'PatientFirst', address: '10210 Mill Run Cir', city: 'Owings Mills' },
  { id: 'pf-catonsville', name: 'Patient First Catonsville', brand: 'PatientFirst', address: '5920 Baltimore National Pike', city: 'Catonsville' },
  { id: 'pf-glen-burnie', name: 'Patient First Glen Burnie', brand: 'PatientFirst', address: '7556 Ritchie Hwy', city: 'Glen Burnie' },
  { id: 'pf-columbia', name: 'Patient First Columbia', brand: 'PatientFirst', address: '6240 Columbia Crossing Cir', city: 'Columbia' },
  { id: 'pf-laurel', name: 'Patient First Laurel', brand: 'PatientFirst', address: '320 Main St', city: 'Laurel' },
  { id: 'pf-college-park', name: 'Patient First College Park', brand: 'PatientFirst', address: '7310 Baltimore Ave', city: 'College Park' },
  { id: 'pf-germantown', name: 'Patient First Germantown', brand: 'PatientFirst', address: '19735 Germantown Rd', city: 'Germantown' },
  { id: 'pf-frederick', name: 'Patient First Frederick', brand: 'PatientFirst', address: '1405 W Patrick St', city: 'Frederick' },
  { id: 'pf-annapolis', name: 'Patient First Annapolis', brand: 'PatientFirst', address: '2600 Riva Rd', city: 'Annapolis' },
  { id: 'pf-bel-air', name: 'Patient First Bel Air', brand: 'PatientFirst', address: '550 Marketplace Dr', city: 'Bel Air' },
  { id: 'pf-dundalk', name: 'Patient First Dundalk', brand: 'PatientFirst', address: '1525 Merritt Blvd', city: 'Dundalk' },
  // MedStar PromptCare (~6)
  { id: 'ms-bel-air', name: 'MedStar PromptCare Bel Air', brand: 'MedStarPromptCare', address: '4 N Tollgate Rd', city: 'Bel Air' },
  { id: 'ms-brandywine', name: 'MedStar PromptCare Brandywine', brand: 'MedStarPromptCare', address: '15601 Crain Hwy', city: 'Brandywine' },
  { id: 'ms-chevy-chase', name: 'MedStar PromptCare Chevy Chase', brand: 'MedStarPromptCare', address: '5530 Wisconsin Ave', city: 'Chevy Chase' },
  { id: 'ms-lutherville', name: 'MedStar PromptCare Lutherville', brand: 'MedStarPromptCare', address: '1300 York Rd', city: 'Lutherville' },
  { id: 'ms-pasadena', name: 'MedStar PromptCare Pasadena', brand: 'MedStarPromptCare', address: '8117 Ritchie Hwy', city: 'Pasadena' },
  { id: 'ms-largo', name: 'MedStar PromptCare Largo', brand: 'MedStarPromptCare', address: '9480 Lottsford Rd', city: 'Largo' },
  // Righttime Medical Care (~6)
  { id: 'rt-annapolis', name: 'Righttime Annapolis', brand: 'Righttime', address: '2465 Solomons Island Rd', city: 'Annapolis' },
  { id: 'rt-columbia', name: 'Righttime Columbia', brand: 'Righttime', address: '7061 Deepage Dr', city: 'Columbia' },
  { id: 'rt-ellicott-city', name: 'Righttime Ellicott City', brand: 'Righttime', address: '3290 Pine Orchard Ln', city: 'Ellicott City' },
  { id: 'rt-frederick', name: 'Righttime Frederick', brand: 'Righttime', address: '161 Thomas Johnson Dr', city: 'Frederick' },
  { id: 'rt-laurel', name: 'Righttime Laurel', brand: 'Righttime', address: '13820 Old Gunpowder Rd', city: 'Laurel' },
  { id: 'rt-waldorf', name: 'Righttime Waldorf', brand: 'Righttime', address: '3290 Leonardtown Rd', city: 'Waldorf' },
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
    console.log(`[geocode-competitors] Output exists, skipping (use --force to overwrite)`);
    return;
  }

  const results: CompetitorLocation[] = [];

  for (const loc of COMPETITORS) {
    console.log(`[geocode-competitors] Geocoding: ${loc.name} (${loc.address}, ${loc.city})`);

    let coords = await geocodeCensus(loc.address, loc.city);
    let source: 'census' | 'nominatim' = 'census';

    if (!coords) {
      console.log(`  Census failed, trying Nominatim...`);
      await new Promise((r) => setTimeout(r, 1100));
      coords = await geocodeNominatim(loc.address, loc.city);
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
      brand: loc.brand,
      address: loc.address,
      city: loc.city,
      lat: coords.lat,
      lng: coords.lng,
      geocodeSource: source,
    });

    await new Promise((r) => setTimeout(r, 300));
  }

  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\n[geocode-competitors] Done: ${results.length} locations written to ${OUT}`);
}

main().catch((err) => {
  console.error('[geocode-competitors] Fatal:', err);
  process.exit(1);
});
