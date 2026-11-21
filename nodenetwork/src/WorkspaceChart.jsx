import { useId, useState } from 'react';
const CHART_COLORS=['var(--lime)','var(--cyan)','var(--blue)','var(--purple)'];

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const number = (value) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 });
const format = (value, unit = '') =>
  `${number(value)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
const labelAt = (labels, i, count) =>
  labels[Math.round((i * Math.max(0, labels.length - 1)) / Math.max(1, count - 1))] ||
  `Sample ${i + 1}`;

function ChartTooltip({ index, count, labels, series, unit }) {
  if (index == null) return null;
  const values = series.filter((item) => isNumber(item.data[index]));
  if (!values.length) return null;
  return (
    <div
      className="nn-chart-tooltip nn-react-chart-tooltip"
      role="status"
      style={{
        left: `min(max(4px, ${(index / Math.max(1, count - 1)) * 100}%), max(4px, calc(100% - 184px)))`,
      }}
    >
      <strong>{labelAt(labels, index, count)}</strong>
      {values.map((item, i) => (
        <span key={item.name}>
          <i style={{ background: item.color || CHART_COLORS[i % CHART_COLORS.length] }} />
          {item.name}
          <b>{format(item.data[index], unit)}</b>
        </span>
      ))}
    </div>
  );
}

function movePoint(event, current, available, setIndex) {
  if (!available.length) return;
  let next;
  if (event.key === 'Home') next = available[0];
  else if (event.key === 'End') next = available.at(-1);
  else if (event.key === 'ArrowRight')
    next = available[Math.min(available.length - 1, Math.max(0, available.indexOf(current)) + 1)];
  else if (event.key === 'ArrowLeft') next = available[Math.max(0, available.indexOf(current) - 1)];
  else if (event.key === 'Escape') {
    setIndex(null);
    return;
  } else return;
  event.preventDefault();
  setIndex(next);
}

/** Nulls are gaps, never zero measurements. Focus the plot and use arrow keys to inspect samples. */
export function WorkspaceLineChart({
  series: inputSeries,
  data,
  values,
  name,
  color,
  labels = [],
  unit = '',
  axisLabel,
  min = 0,
  max: inputMax,
  height = 210,
  title = 'Saved telemetry chart',
  compact = false,
  fill = true,
}) {
  const id = useId().replace(/:/g, ''),
    [active, setActive] = useState(null);
  const series = inputSeries || [
    { name: name || title, data: data || values || [], color: color || CHART_COLORS[0] },
  ];
  const count = Math.max(2, ...series.map((item) => item.data.length));
  const width = 640,
    left = compact ? 12 : 72,
    right = 16,
    top = compact ? 10 : 24,
    bottom = compact ? 8 : 34;
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  const allValues = series.flatMap((item) => item.data.filter(isNumber));
  const max = Math.max(min + 1, inputMax ?? Math.ceil(Math.max(...allValues, 1) * 1.12));
  const x = (i) => left + (i / (count - 1)) * plotWidth,
    y = (value) => top + ((max - value) / (max - min)) * plotHeight;
  const available = Array.from({ length: count }, (_, i) => i).filter((i) =>
    series.some((item) => isNumber(item.data[i])),
  );
  const tickIndices = [
    ...new Set([
      0,
      Math.round((count - 1) / 4),
      Math.round((count - 1) / 2),
      Math.round(((count - 1) * 3) / 4),
      count - 1,
    ]),
  ];
  const instructionsId = `${id}-instructions`;
  return (
    <div
      className={`nn-chart ${compact ? 'nn-chart-compact' : 'nn-chart-interactive'}`}
      tabIndex={compact || !available.length ? undefined : 0}
      role={compact ? undefined : 'group'}
      aria-label={title}
      aria-describedby={compact ? undefined : instructionsId}
      onFocus={() => setActive(available[0] ?? null)}
      onBlur={() => setActive(null)}
      onPointerLeave={() => setActive(null)}
      onKeyDown={(event) => movePoint(event, active, available, setActive)}
    >
      {!compact && (
        <span id={instructionsId} className="visually-hidden">
          Saved file observations. Use left and right arrow keys to inspect samples, Home and End to reach
          the first or last sample. Missing values are gaps.
        </span>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <title>{title}</title>
        <desc>
          Saved file observations. {series.map((item) => item.name).join(' and ')}.{' '}
          {unit && `Values in ${unit}.`} Missing values are gaps.
        </desc>
        <defs>
          <linearGradient id={`${id}-gradient`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={series[0]?.color || CHART_COLORS[0]} stopOpacity=".16" />
            <stop offset="100%" stopColor={series[0]?.color || CHART_COLORS[0]} stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${id}-clip`}>
            <rect x={left} y={top} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>
        {!compact && (
          <>
            {(axisLabel || unit) && (
              <text x={left} y="12" className="nn-axis">
                {axisLabel || unit}
              </text>
            )}
            {Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4).map((tick) => (
              <g key={tick}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="nn-gridline"
                />
                <text x={left - 12} y={y(tick) + 4} textAnchor="end" className="nn-axis">
                  {format(tick, unit === '%' ? '%' : '')}
                </text>
              </g>
            ))}
          </>
        )}
        <g clipPath={`url(#${id}-clip)`}>
          {series.map((item, seriesIndex) => {
            const segments = [];
            let segment = [];
            item.data.forEach((value, i) => {
              if (!isNumber(value)) {
                if (segment.length) segments.push(segment);
                segment = [];
              } else segment.push([x(i), y(value)]);
            });
            if (segment.length) segments.push(segment);
            return segments.map((points, segmentIndex) => {
              const path = points
                .map((point, i) => `${i ? 'L' : 'M'}${point[0].toFixed(2)},${point[1].toFixed(2)}`)
                .join(' ');
              const stroke = item.color || CHART_COLORS[seriesIndex % CHART_COLORS.length];
              return (
                <g key={`${seriesIndex}-${segmentIndex}`}>
                  {seriesIndex === 0 && fill && points.length > 1 && (
                    <path
                      d={`${path} L${points.at(-1)[0]},${top + plotHeight} L${points[0][0]},${top + plotHeight}Z`}
                      fill={`url(#${id}-gradient)`}
                    />
                  )}
                  <path
                    className="nn-react-line"
                    d={path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={compact ? 2 : 2.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={item.dash}
                  />
                  {points.length === 1 && (
                    <circle cx={points[0][0]} cy={points[0][1]} r="3" fill={stroke} />
                  )}
                </g>
              );
            });
          })}
          {!compact &&
            available.map((i) => (
              <g
                key={i}
                className={`nn-chart-hit ${active === i ? 'is-active' : ''}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => setActive(i)}
              >
                <rect
                  x={x(i) - plotWidth / (count - 1) / 2}
                  y={top}
                  width={plotWidth / (count - 1)}
                  height={plotHeight}
                  fill="transparent"
                />
                {active === i && (
                  <>
                    <line
                      className="nn-hover-line"
                      x1={x(i)}
                      x2={x(i)}
                      y1={top}
                      y2={top + plotHeight}
                    />
                    {series
                      .filter((item) => isNumber(item.data[i]))
                      .map((item) => (
                        <circle
                          key={item.name}
                          className="nn-hover-dot"
                          cx={x(i)}
                          cy={y(item.data[i])}
                          r="4.5"
                          fill={item.color || CHART_COLORS[0]}
                        />
                      ))}
                  </>
                )}
              </g>
            ))}
        </g>
        {!allValues.length && !compact && (
          <text x={width / 2} y={height / 2} textAnchor="middle" className="nn-chart-empty">
            No recent telemetry
          </text>
        )}
        {!compact &&
          tickIndices.map((i, index) => (
            <text
              key={i}
              x={x(i)}
              y={height - 9}
              textAnchor={
                index === 0 ? 'start' : index === tickIndices.length - 1 ? 'end' : 'middle'
              }
              className="nn-axis"
            >
              {labelAt(labels, i, count)}
            </text>
          ))}
      </svg>
      {!compact && (
        <ChartTooltip index={active} count={count} labels={labels} series={series} unit={unit} />
      )}
    </div>
  );
}
