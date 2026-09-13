//! Big KPI number with a small caption underneath.

export function Kpi({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="analytics-kpi">
      <span className={`analytics-kpi-value${tone ? ` analytics-kpi-value--${tone}` : ''}`}>{value}</span>
      <span className="analytics-kpi-label">{label}</span>
    </div>
  );
}
