/**
 * Runtime validation for MIEMSS EDAS API responses.
 *
 * These zod schemas are the source of truth for the on-the-wire shape of
 * cachedfacilities / cachedhospitalstatus / cachedjurisdictions. The hand-
 * written TypeScript interfaces in ../types/edas.ts must stay in sync with
 * the types inferred here — if they drift, prefer the inferred types.
 *
 * Fields observed to be nullable in live traffic are declared
 * `.nullable().optional()`; everything else is required.
 */

import { z } from 'zod';

export const EdasFacilitySchema = z.object({
  facilityName: z.string(),
  facilityCode: z.string(),
  facilityAddress: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  county: z.string(),
  countyGroup: z.string(),
  lat: z.number(),
  lon: z.number(),
});
export type EdasFacility = z.infer<typeof EdasFacilitySchema>;

export const EdasUnitSchema = z.object({
  destinationCode: z.string(),
  jurisdiction: z.string(),
  agencyName: z.string(),
  unitCallSign: z.string(),
  lengthOfStay: z.number(),
  incidentNumber: z.string(),
  timeEnroute: z.number(),
  isEnroute: z.union([z.literal(0), z.literal(1)]),
});
export type EdasUnit = z.infer<typeof EdasUnitSchema>;

export const EdasAlertsSchema = z.object({
  hospitalCode: z.string(),
  red: z.string().nullable(),
  yellow: z.string().nullable(),
  reroute: z.string().nullable(),
  codeBlack: z.string().nullable(),
  traumaBypass: z.string().nullable(),
  capacity: z.string().nullable(),
  edCensusIndicatorScore: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .nullable(),
  notes: z.string().nullable(),
  codeBlackReason: z.string().nullable(),
});
export type EdasAlerts = z.infer<typeof EdasAlertsSchema>;

export const EdasHospitalStatusSchema = z.object({
  destinationName: z.string(),
  destinationCode: z.string(),
  jurisdiction: z.string().nullable(),
  jurisdictionCode: z.array(z.string()),
  numOfUnits: z.number(),
  numOfUnitsEnroute: z.number(),
  minStay: z.number().nullable(),
  maxStay: z.number().nullable(),
  lat: z.number(),
  lon: z.number(),
  units: z.array(EdasUnitSchema),
  alerts: EdasAlertsSchema,
});
export type EdasHospitalStatus = z.infer<typeof EdasHospitalStatusSchema>;

export const EdasHospitalStatusEnvelopeSchema = z.object({
  totalResults: z.number(),
  totalUnits: z.number(),
  totalEnroute: z.number(),
  results: z.array(EdasHospitalStatusSchema),
});
export type EdasHospitalStatusEnvelope = z.infer<typeof EdasHospitalStatusEnvelopeSchema>;

// Jurisdiction responses include additional fields we do not use; keep the
// schema permissive so a harmless upstream addition does not crash the UI.
export const EdasJurisdictionSchema = z
  .object({
    jurisdictionCode: z.string(),
    jurisdictionName: z.string(),
  })
  .passthrough();
export type EdasJurisdiction = z.infer<typeof EdasJurisdictionSchema>;

export const EdasFacilitiesResponseSchema = z.array(EdasFacilitySchema);
export const EdasJurisdictionsResponseSchema = z.array(EdasJurisdictionSchema);

/**
 * Parse a value against a zod schema; on failure, rethrow with an EDAS-aware
 * message that names the first offending field and the mismatch. The caller
 * must NOT supply fallback values — if EDAS changed shape, the UI must
 * surface that rather than silently coerce.
 */
export function parseEdas<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  source: string,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const first = result.error.issues[0];
  const path = first.path.length > 0 ? first.path.join('.') : '<root>';
  const asRecord = first as unknown as Record<string, unknown>;
  const received =
    asRecord.received !== undefined ? String(asRecord.received) : 'unknown';
  const expected =
    asRecord.expected !== undefined ? String(asRecord.expected) : first.code;

  throw new Error(
    `EDAS response shape changed at ${source}: field "${path}" — received type "${received}", expected "${expected}". (${first.message})`,
  );
}
