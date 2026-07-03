import { cn } from "@/lib/utils";

// Deterministic per-instance gradient id. A fixed id ("spark-fade") collides
// when multiple sparklines render on one page — browsers resolve every
// url(#id) against the FIRST definition, so all area fills inherit the first
// sparkline's stroke color.
function gradientId(values: number[], stroke: string): string {
  let h = 2166136261;
  const s = `${stroke}|${values.join(",")}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `spark-${(h >>> 0).toString(36)}`;
}

/** Pure-SVG price sparkline. No deps. Normalizes values to [0,1]. */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = "currentColor",
  fill = "none",
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
}) {
  if (!values || values.length < 2) {
    return (
      <svg width={width} height={height} className={cn("text-muted-foreground/40", className)}>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeDasharray="2 3" strokeWidth="1" />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const pathD = `M${pts.join(" L")}`;
  const areaD = `${pathD} L${width},${height} L0,${height} Z`;
  const gid = gradientId(values, stroke);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.2" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gid})`} stroke="none" />
      <path d={pathD} stroke={stroke} strokeWidth="1.5" fill={fill} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
