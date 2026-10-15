import { useEffect, useState } from 'react';
import { CalendarDays, Loader2, LineChart, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import HistoryChart from '../components/HistoryChart';
import { TituloPanel, Vacio } from '../components/ui';
import { getHistorial, getDiario } from '../api';
import { VARIABLES, VAR_POR_CLAVE, fmt, num } from '../lib/umbrales';

const RANGOS = [
  { horas: 24, texto: '24 h' },
  { horas: 72, texto: '3 días' },
  { horas: 168, texto: '7 días' },
  { horas: 720, texto: '30 días' },
];

function estadisticas(datos, campo) {
  const v = datos.map((d) => num(d[campo])).filter((x) => x != null);
  if (!v.length) return null;
  const mitad = Math.floor(v.length / 2);
  const prom = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const tendencia = v.length >= 4 ? prom(v.slice(mitad)) - prom(v.slice(0, mitad)) : 0;
  return { prom: prom(v), min: Math.min(...v), max: Math.max(...v), tendencia };
}

function Tendencia({ valor, def }) {
  const umbral = def.clave === 'luminosity' ? 500 : def.clave === 'temperature' ? 0.5 : 2;
  if (Math.abs(valor) < umbral) return <span className="inline-flex items-center gap-1 text-niebla"><Minus size={14} aria-hidden="true" /> Estable</span>;
  return valor > 0
    ? <span className="inline-flex items-center gap-1 text-ambar"><TrendingUp size={14} aria-hidden="true" /> Subiendo</span>
    : <span className="inline-flex items-center gap-1 text-cielo"><TrendingDown size={14} aria-hidden="true" /> Bajando</span>;
}

export default function VistaHistorial({ plantaId }) {
  const [horas, setHoras] = useState(24);
  const [res, setRes] = useState({ clave: null, horario: [], diario: [], error: false });
  const clave = `${plantaId}|${horas}`;
  const cargando = res.clave !== clave;

  useEffect(() => {
    if (!plantaId) return;
    let vivo = true;
    Promise.all([getHistorial(plantaId, horas), getDiario(plantaId, 30)])
      .then(([horario, diario]) => vivo && setRes({ clave: `${plantaId}|${horas}`, horario, diario, error: false }))
      .catch(() => vivo && setRes({ clave: `${plantaId}|${horas}`, horario: [], diario: [], error: true }));
    return () => { vivo = false; };
  }, [plantaId, horas]);

  if (!plantaId) return <div className="panel"><Vacio icono={LineChart} titulo="Sin plantas" texto="Cuando el sensor envíe datos aparecerán aquí." /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Rango de tiempo" className="inline-flex rounded-full border border-white/10 bg-noche-900 p-1">
          {RANGOS.map((r) => (
            <button key={r.horas} role="radio" aria-checked={horas === r.horas} onClick={() => setHoras(r.horas)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                horas === r.horas ? 'bg-brote text-noche-950' : 'text-niebla hover:text-tinta'}`}>
              {r.texto}
            </button>
          ))}
        </div>
        {cargando && <span className="inline-flex items-center gap-2 text-sm text-niebla"><Loader2 size={16} className="animate-spin" /> Cargando…</span>}
        {res.error && !cargando && <span className="inline-flex items-center gap-2 text-sm text-coral"><AlertCircle size={16} /> No se pudo cargar el historial</span>}
        <p className="ml-auto text-xs text-niebla">Fuente: <span className="font-mono">resumen_horario</span> (DWH, agregado por el ETL)</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {VARIABLES.map((def) => {
          const st = estadisticas(res.horario, def.histAvg);
          const Icono = def.icono;
          return (
            <section key={def.clave} className="panel" aria-label={`Historial de ${def.nombre}`}>
              <div className="flex flex-wrap items-center gap-3 border-b border-white/8 px-5 py-3.5">
                <Icono size={17} style={{ color: def.color }} aria-hidden="true" />
                <h3 className="text-sm font-semibold">{def.nombre} <span className="text-niebla">({def.unidad})</span></h3>
                {st && <span className="ml-auto text-xs"><Tendencia valor={st.tendencia} def={def} /></span>}
              </div>
              <div className="grid grid-cols-3 gap-px border-b border-white/8 bg-white/[.04] text-center">
                {[['Promedio', st?.prom], ['Mínimo', st?.min], ['Máximo', st?.max]].map(([t, v]) => (
                  <div key={t} className="bg-noche-950/60 py-2.5">
                    <p className="text-[11px] uppercase tracking-wider text-niebla">{t}</p>
                    <p className="font-mono text-lg font-semibold">{fmt(v, def.decimales)}</p>
                  </div>
                ))}
              </div>
              <div className="px-3 py-4">
                {!cargando && res.horario.length === 0
                  ? <Vacio icono={LineChart} titulo="Aún no hay datos agregados" texto="El ETL genera el resumen cada 5 minutos." />
                  : <HistoryChart def={def} datos={res.horario} horas={horas} />}
              </div>
            </section>
          );
        })}
      </div>

      <section className="panel overflow-hidden" aria-label="Resumen diario">
        <TituloPanel icono={CalendarDays} titulo="Resumen diario (últimos 30 días)">
          <span className="font-mono text-xs text-niebla">resumen_diario</span>
        </TituloPanel>
        {res.diario.length === 0
          ? <Vacio icono={CalendarDays} titulo="Sin resumen diario aún" />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-niebla">
                  <tr className="border-b border-white/8">
                    <th scope="col" className="px-5 py-3 font-medium">Día</th>
                    <th scope="col" className="px-3 py-3 font-medium">Temp. prom (mín–máx)</th>
                    <th scope="col" className="px-3 py-3 font-medium">Hum. aire</th>
                    <th scope="col" className="px-3 py-3 font-medium">Luz prom / máx</th>
                    <th scope="col" className="px-3 py-3 font-medium">Suelo prom (mín)</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Lecturas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6 font-mono">
                  {[...res.diario].reverse().map((d) => (
                    <tr key={d.dia} className="hover:bg-white/[.02]">
                      <td className="px-5 py-2.5 font-sans font-semibold">{new Date(`${d.dia}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' })}</td>
                      <td className="px-3 py-2.5">{fmt(d.temp_avg, 1)} °C <span className="text-niebla">({fmt(d.temp_min, 1)}–{fmt(d.temp_max, 1)})</span></td>
                      <td className="px-3 py-2.5">{fmt(d.hum_avg)} %</td>
                      <td className="px-3 py-2.5">{fmt(d.lux_avg)} / <span className="text-niebla">{fmt(d.lux_max)}</span> lx</td>
                      <td className={`px-3 py-2.5 ${num(d.soil_min) != null && d.soil_min < VAR_POR_CLAVE.soil_moisture.optimo[0] ? 'text-coral' : ''}`}>
                        {fmt(d.soil_avg)} % <span className="text-niebla">({fmt(d.soil_min)})</span>
                      </td>
                      <td className="px-5 py-2.5 text-right text-niebla">{d.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}
