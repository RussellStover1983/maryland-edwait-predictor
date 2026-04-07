// Types built against the REAL EDAS response shapes confirmed 2026-04-07.
// NOTE: cachedhospitalstatus is an envelope, NOT a bare array.

export interface EdasFacility {
  facilityName: string;
  facilityCode: string;
  facilityAddress: string;
  city: string;
  state: string;
  postalCode: string;
  county: string;
  countyGroup: string;
  lat: number;
  lon: number;
}

export interface EdasUnit {
  destinationCode: string;
  jurisdiction: string;
  agencyName: string;
  unitCallSign: string;
  lengthOfStay: number; // minutes
  incidentNumber: string;
  timeEnroute: number; // minutes
  isEnroute: 0 | 1;
}

export interface EdasAlerts {
  hospitalCode: string;
  red: string | null;
  yellow: string | null;
  reroute: string | null;
  codeBlack: string | null;
  traumaBypass: string | null;
  capacity: string | null;
  edCensusIndicatorScore: 1 | 2 | 3 | 4 | null;
  notes: string | null;
  codeBlackReason: string | null;
}

export interface EdasHospitalStatus {
  destinationName: string;
  destinationCode: string;
  jurisdiction: string | null;
  jurisdictionCode: string[];
  numOfUnits: number;
  numOfUnitsEnroute: number;
  minStay: number | null;
  maxStay: number | null;
  lat: number;
  lon: number;
  units: EdasUnit[];
  alerts: EdasAlerts;
}

export interface EdasHospitalStatusEnvelope {
  totalResults: number;
  totalUnits: number;
  totalEnroute: number;
  results: EdasHospitalStatus[];
}

export interface EdasJurisdiction {
  jurisdictionCode: string;
  jurisdictionName: string;
  // additional fields tolerated — we only key off code + name
  [key: string]: unknown;
}

// Normalized view the UI consumes
export interface NormalizedHospital {
  code: string;
  name: string;
  system: 'LifeBridge' | 'Johns Hopkins' | 'UMMS' | 'MedStar' | 'Other';
  lat: number;
  lon: number;
  edCensusScore: 1 | 2 | 3 | 4 | null;
  numUnits: number;
  numUnitsEnroute: number;
  minStay: number | null;
  maxStay: number | null;
  meanStay: number | null;
  hasActiveAlert: boolean;
  alerts: EdasAlerts;
  raw: EdasHospitalStatus;
}
