import { BellRing, ArrowRight, Sparkles, Cpu, Radio, Server, Database, Filter, Warehouse, Bot, ChevronRight, CheckCircle2, AlertOctagon, AlertTriangle } from 'lucide-react';
import HealthGauge from '../components/HealthGauge';
import MetricCard from '../components/MetricCard';
import CardPrediccion from '../components/CardPrediccion';
import { TituloPanel, SeveridadChip, Vacio } from '../components/ui';
import { VARIABLES, num, fechaCorta } from '../lib/umbrales';

const PREGUNTAS_RAPIDAS = ['¿Debo regar la planta hoy?', '¿Tiene suficiente luz?', 'Resume el estado en 3 puntos'];

function Kpi({ icono: Icono, titulo, valor, tono, detalle }) {
  const tonos = { coral: 'text-coral bg-coral/10', ambar: 'text-ambar bg-ambar/10', savia: 'text-savia bg-savia/10', cielo: 'text-cielo bg-cielo/10' };
  return (
    <div className="panel flex items-center gap-4 p-4">
      <span className={`hidden h-11 w-11 shrink-0 place-items-center rounded-xl sm:grid ${tonos[tono]}`}><Icono size={20} aria-hidden="true" /></span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wider text-niebla">{titulo}</p>
        <p className="font-mono text-2xl font-semibold leading-tight">{valor}</p>
        {detalle && <p className="truncate text-xs text-niebla">{detalle}</p>}
      </div>
    </div>
  );
}

/** Flujo de la arquitectura con su estado: Sensor -> Orion -> QuantumLeap -> CrateDB -> ETL -> DWH -> IA */
function FlujoDatos({ datosFrescos, estado }) {
  const etapas = [
    { icono: Cpu, nombre: 'T-Beam', sub: 'ESP32', ok: datosFrescos },
    { icono: Radio, nombre: 'Orion', sub: 'Contexto', ok: datosFrescos },
    { icono: Server, nombre: 'QuantumLeap', sub: 'Series', ok: datosFrescos },
    { icono: Database, nombre: 'CrateDB', sub: 'RAW', ok: datosFrescos },
    { icono: Filter, nombre: 'ETL', sub: 'Recursivo', ok: datosFrescos },
    { icono: Warehouse, nombre: 'DWH', sub: 'Postgres', ok: estado?.db },
    { icono: Bot, nombre: 'IA', sub: 'Gemini', ok: estado?.ia },
  ];
  return (
    <section className="panel" aria-labelledby="titulo-flujo">
      <div className="flex items-center gap-2 border-b border-white/8 px-5 py-3.5">
        <Radio size={17} className="text-brote" aria-hidden="true" />
        <h3 id="titulo-flujo" className="text-sm font-semibold tracking-wide">Flujo de datos FIWARE</h3>
        <span className="ml-auto text-xs text-niebla">{datosFrescos ? 'Datos llegando' : 'Sin datos recientes'}</span>
      </div>
      <ol className="flex items-center gap-1 overflow-x-auto px-4 py-4">
        {etapas.map((e, i) => {
          const Icono = e.icono;
          const tono = e.ok == null ? 'text-niebla ring-white/10' : e.ok ? 'text-savia ring-savia/30 bg-savia/5' : 'text-ambar ring-ambar/30 bg-ambar/5';
          return (
            <li key={e.nombre} className="flex items-center gap-1">
              <div className="flex min-w-[84px] flex-col items-center gap-1.5 text-center">
                <span className={`grid h-11 w-11 place-items-center rounded-xl ring-1 ${tono}`}>
                  <Icono size={19} aria-hidden="true" />
                </span>
                <span className="text-xs font-semibold">{e.nombre}</span>
                <span className="text-[10px] uppercase tracking-wider text-niebla">
                  {e.sub} · {e.ok == null ? '…' : e.ok ? 'OK' : 'Revisar'}
                </span>
              </div>
              {i < etapas.length - 1 && <ChevronRight size={16} className="mb-8 shrink-0 text-niebla/50" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function VistaResumen({ planta, lecturas, alertas, resumenAlertas, salud, estado, datosFrescos, onVista, onPreguntar, tick }) {
  const recientes = alertas.slice(0, 6);
  const err24 = resumenAlertas?.error?.h24 ?? 0;
  const warn24 = resumenAlertas?.warning?.h24 ?? 0;
  const variablesOk = planta
    ? VARIABLES.filter((d) => { const v = num(planta[d.clave]); return v != null && v >= d.optimo[0] && v <= d.optimo[1]; }).length
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi icono={CheckCircle2} tono="savia" titulo="Variables en rango" valor={planta ? `${variablesOk}/4` : '--'} detalle="Según umbrales del cultivo" />
        <Kpi icono={AlertOctagon} tono="coral" titulo="Errores 24 h" valor={err24} detalle={`${resumenAlertas?.error?.d7 ?? 0} en 7 días`} />
        <Kpi icono={AlertTriangle} tono="ambar" titulo="Advertencias 24 h" valor={warn24} detalle={`${resumenAlertas?.warning?.d7 ?? 0} en 7 días`} />
        <Kpi icono={Database} tono="cielo" titulo="Lecturas recientes" valor={lecturas.length} detalle="Cargadas por el ETL" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-4"><HealthGauge salud={salud} plantaId={planta?.entity_id} /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-8">
          {VARIABLES.map((def, i) => (
            <MetricCard key={def.clave} def={def} indice={i} valor={num(planta?.[def.clave])}
              serie={lecturas.map((l) => num(l[def.clave]))} />
          ))}
        </div>
      </div>

      {/* Modelo Predictivo Hídrico basado en datos reales */}
      <CardPrediccion plantaId={planta?.entity_id} tick={tick} onVerDetalle={() => onVista('prediccion')} />

      <FlujoDatos datosFrescos={datosFrescos} estado={estado} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="panel xl:col-span-7" aria-label="Alertas recientes">
          <TituloPanel icono={BellRing} titulo="Alertas recientes">
            <button onClick={() => onVista('alertas')} className="inline-flex items-center gap-1 text-xs font-semibold text-brote hover:underline">
              Ver todas <ArrowRight size={14} aria-hidden="true" />
            </button>
          </TituloPanel>
          {recientes.length === 0
            ? <Vacio icono={CheckCircle2} titulo="Sin alertas" texto="El ETL no ha detectado advertencias ni errores para esta planta." />
            : (
              <ul className="divide-y divide-white/6">
                {recientes.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                    <SeveridadChip severidad={a.severidad} />
                    <span className="min-w-0 flex-1 text-tinta/90">{a.mensaje}</span>
                    <time className="font-mono text-xs text-niebla" dateTime={a.ts}>{fechaCorta(a.ts)}</time>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className="panel relative overflow-hidden p-6 xl:col-span-5" aria-label="Consulta rápida a la IA">
          <div aria-hidden="true" className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brote/15 blur-3xl" />
          <div className="relative flex items-center gap-2">
            <Sparkles size={18} className="text-brote" aria-hidden="true" />
            <h3 className="text-sm font-semibold tracking-wide">Pregúntale a la IA</h3>
          </div>
          <p className="relative mt-2 text-sm text-niebla">
            El asistente analiza las lecturas limpias, el resumen de 24 h y las alertas del DWH para recomendar riego y luz.
          </p>
          <div className="relative mt-5 space-y-2">
            {PREGUNTAS_RAPIDAS.map((p) => (
              <button key={p} onClick={() => onPreguntar(p)}
                className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-left text-sm transition hover:border-brote/40 hover:bg-brote/5">
                {p}
                <ArrowRight size={16} className="text-niebla transition group-hover:translate-x-0.5 group-hover:text-brote" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
