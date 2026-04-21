// On-the-wire EDAS response types. The zod schemas in
// src/validation/edasSchemas.ts are the source of truth — these are inferred
// re-exports so runtime parsing and static typing cannot drift apart.
// To change a field type, edit the zod schema, not this file.

export type {
  EdasFacility,
  EdasUnit,
  EdasAlerts,
  EdasHospitalStatus,
  EdasHospitalStatusEnvelope,
  EdasJurisdiction,
} from '../validation/edasSchemas';

import type { EdasAlerts, EdasHospitalStatus } from '../validation/edasSchemas';

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
