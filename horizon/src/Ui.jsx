export function GlassPanel({children, className = ''}) {
  return <section className={`glass ${className}`}>{children}</section>;
}

export function StatusPill({children, tone = 'purple'}) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}
