import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea } from 'recharts';
import { fmt } from '../lib/umbrales';

const formatoEje = (horas) => (v) => {
  const d = new Date(v);
  return horas > 48
    ? d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
    : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
};

function Burbuja({ active, payload, label, def }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-noche-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1 font-semibold text-tinta">{new Date(label).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-niebla">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
          {p.name}: <span className="font-mono text-tinta">{fmt(p.value, def.decimales)} {def.unidad}</span>
        </p>
      ))}
    </div>
  );
}

/** Grafica de area del resumen horario para una variable (con min/max si existen y franja optima) */
export default function HistoryChart({ def, datos, horas, alto = 220 }) {
  const id = `g-${def.clave}`;
  const serie = datos.map((d) => ({
    t: new Date(d.hora).getTime(),
    avg: d[def.histAvg],
    min: def.histMin ? d[def.histMin] : undefined,
    max: def.histMax ? d[def.histMax] : undefined,
  }));

  return (
    <div style={{ height: alto }} role="img" aria-label={`Gráfica de ${def.nombre} en las últimas ${horas} horas`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={serie} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={def.color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={def.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgb(255 255 255 / .06)" vertical={false} />
          <ReferenceArea y1={def.optimo[0]} y2={def.optimo[1]} fill="#34d399" fillOpacity={0.05} ifOverflow="hidden" />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
            tickFormatter={formatoEje(horas)} stroke="#9fb5aa" fontSize={11} tickLine={false} axisLine={false} minTickGap={32} />
          <YAxis stroke="#9fb5aa" fontSize={11} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${fmt(v / 1000, Math.abs(v) >= 10000 ? 0 : 1)} k` : fmt(v, 0))}
            domain={['auto', 'auto']} />
          <Tooltip content={<Burbuja def={def} />} cursor={{ stroke: 'rgb(255 255 255 / .2)' }} />
          <Area type="monotone" dataKey="avg" name="Promedio" stroke={def.color} strokeWidth={2}
            fill={`url(#${id})`} connectNulls dot={false} activeDot={{ r: 4 }} />
          {def.histMax && <Line type="monotone" dataKey="max" name="Máximo" stroke="#fb7185" strokeDasharray="4 4" strokeWidth={1.2} dot={false} connectNulls />}
          {def.histMin && <Line type="monotone" dataKey="min" name="Mínimo" stroke="#38bdf8" strokeDasharray="4 4" strokeWidth={1.2} dot={false} connectNulls />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
