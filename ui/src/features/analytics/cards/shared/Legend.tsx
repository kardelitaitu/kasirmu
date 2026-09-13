//! Color dot + name + value legend (used beside donuts and stacked bars).

export function Legend({ items }: { items: { name: string; value: string; color: string }[] }) {
  return (
    <ul className="analytics-legend">
      {items.map((it) => (
        <li key={it.name} className="analytics-legend-item">
          <span className="analytics-legend-dot" style={{ background: it.color }} />
          <span className="analytics-legend-name">{it.name}</span>
          <span className="analytics-legend-value">{it.value}</span>
        </li>
      ))}
    </ul>
  );
}
