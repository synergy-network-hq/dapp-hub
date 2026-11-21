export default function Panel({ children, accent = false, edge, className = "", ...rest }) {
  const cls = [
    "panel",
    accent && "panel--accent",
    edge && `panel--${edge}-edge`,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <article className={cls} {...rest}>
      {children}
    </article>
  );
}

export function PanelHeading({ eyebrow, title, meta, children }) {
  return (
    <div className="panel-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        {title && <h2>{title}</h2>}
      </div>
      <div className="panel-heading-meta">{meta ?? children}</div>
    </div>
  );
}
