import type { NormalizedHospital } from '../../types/edas';

interface HexBaseScore {
  population: number;
  nearestExpressCare: { distanceMiles: number };
}

interface Props {
  hospitals: NormalizedHospital[];
  hexScores: HexBaseScore[];
}

export default function StatewideSummary({ hospitals, hexScores }: Props) {
  const totalHospitals = hospitals.length;
  // Missing scores are neither counted toward the level-3+ numerator nor the denominator.
  const scored = hospitals.filter((h) => h.edCensusScore != null);
  const level3Plus = scored.filter((h) => h.edCensusScore! >= 3).length;
  const unknownCensus = totalHospitals - scored.length;
  const activeAlerts = hospitals.filter((h) => h.hasActiveAlert).length;
  const totalUnits = hospitals.reduce((s, h) => s + h.numUnits, 0);
  const totalEnroute = hospitals.reduce((s, h) => s + h.numUnitsEnroute, 0);

  // Population within 5 miles of any ExpressCare
  const popWithin5mi = hexScores
    .filter((h) => h.nearestExpressCare.distanceMiles <= 5)
    .reduce((s, h) => s + h.population, 0);

  return (
    <section>
      <div className="section-label mb-2">Statewide Summary</div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Hospitals" value={totalHospitals} />
        <Stat
          label="Level 3+"
          value={level3Plus}
          color="#f97316"
          footnote={unknownCensus > 0 ? `${unknownCensus} unknown` : undefined}
        />
        <Stat label="Active Alerts" value={activeAlerts} color="#ef4444" />
        <Stat label="EMS at ED" value={totalUnits} />
        <Stat label="EMS Enroute" value={totalEnroute} />
        <Stat label="Pop <5mi EC" value={`${(popWithin5mi / 1000).toFixed(0)}K`} color="#3b82f6" />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  color,
  footnote,
}: {
  label: string;
  value: string | number;
  color?: string;
  footnote?: string;
}) {
  return (
    <div className="bg-elevated rounded p-2">
      <div className="text-[10px] text-text-secondary uppercase tracking-wider">{label}</div>
      <div className="text-[16px] font-bold mono" style={color ? { color } : undefined}>
        {value}
      </div>
      {footnote && (
        <div className="text-[9px] text-text-muted mono mt-0.5">{footnote}</div>
      )}
    </div>
  );
}
