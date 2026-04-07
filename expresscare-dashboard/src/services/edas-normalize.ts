import type {
  EdasFacility,
  EdasHospitalStatus,
  EdasHospitalStatusEnvelope,
  NormalizedHospital,
} from '../types/edas';

type HospitalSystem = NormalizedHospital['system'];

function classifySystem(name: string): HospitalSystem {
  if (/sinai|northwest|carroll|grace medical/i.test(name)) return 'LifeBridge';
  if (/hopkins|bayview|howard county general|suburban|sibley/i.test(name)) return 'Johns Hopkins';
  if (/university of maryland|umm|\bst\.?\s*joseph\b|upper chesapeake|harford|charles regional/i.test(name)) return 'UMMS';
  if (/medstar|harbor|franklin square|good samaritan|union memorial|\bst\.?\s*mary\b/i.test(name)) return 'MedStar';
  return 'Other';
}

function computeMeanStay(units: EdasHospitalStatus['units']): number | null {
  const stays = units.filter((u) => u.lengthOfStay > 0).map((u) => u.lengthOfStay);
  if (stays.length === 0) return null;
  return stays.reduce((a, b) => a + b, 0) / stays.length;
}

function hasActiveAlert(alerts: EdasHospitalStatus['alerts'] | null): boolean {
  if (!alerts) return false;
  return !!(
    alerts.yellow ||
    alerts.red ||
    alerts.reroute ||
    alerts.codeBlack ||
    alerts.traumaBypass ||
    alerts.capacity
  );
}

export function normalizeHospitals(
  envelope: EdasHospitalStatusEnvelope,
  _facilities: EdasFacility[],
): NormalizedHospital[] {
  const defaultAlerts: EdasHospitalStatus['alerts'] = {
    hospitalCode: '',
    red: null,
    yellow: null,
    reroute: null,
    codeBlack: null,
    traumaBypass: null,
    capacity: null,
    edCensusIndicatorScore: null,
    notes: null,
    codeBlackReason: null,
  };

  return envelope.results.map((h: EdasHospitalStatus) => {
    const alerts = h.alerts ?? defaultAlerts;
    return {
      code: h.destinationCode,
      name: h.destinationName,
      system: classifySystem(h.destinationName),
      lat: h.lat,
      lon: h.lon,
      edCensusScore: alerts.edCensusIndicatorScore,
      numUnits: h.numOfUnits,
      numUnitsEnroute: h.numOfUnitsEnroute,
      minStay: h.minStay,
      maxStay: h.maxStay,
      meanStay: computeMeanStay(h.units),
      hasActiveAlert: hasActiveAlert(alerts),
      alerts,
      raw: h,
    };
  });
}
