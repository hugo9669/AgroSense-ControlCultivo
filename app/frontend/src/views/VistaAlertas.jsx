import { useEffect, useMemo, useState } from 'react';
import { BellRing, Search, AlertOctagon, AlertTriangle, Clock, Loader2, CheckCircle2, WifiOff, AlertCircle, MessageCircle } from 'lucide-react';
import { TituloPanel, SeveridadChip, Vacio } from '../components/ui';
import { getAlertas } from '../api';
import { VARIABLES, VAR_POR_CLAVE, fechaCorta } from '../lib/umbrales';

const SEVERIDADES = [
  { id: 'todas', texto: 'Todas' },
  { id: 'error', texto: 'Errores' },
  { id: 'warning', texto: 'Advertencias' },
];

const TIPO_TEXTO = { invalido: 'Falla de sensor', atipico: 'Valor atípico', bajo: 'Bajo', alto: 'Alto', fuera_rango: 'Fuera de rango' };

function describirTipo(a) {
  if (a.tipo === 'sin_datos') return 'Sin datos';
  const sufijo = Object.keys(TIPO_TEXTO).find((s) => a.tipo.endsWith(s));
  return sufijo ? TIPO_TEXTO[sufijo] : a.tipo;
}

function variableDe(a) {
  if (a.variable) return a.variable;
  return VARIABLES.find((v) => a.tipo.startsWith(v.clave))?.clave ?? null;
}

function Contador({ icono: Icono, titulo, valor, clase, compacto = false }) {
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${clase}`}><Icono size={18} aria-hidden="true" /></span>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wider text-niebla">{titulo}</p>
        <p className={`font-mono font-semibold leading-tight ${compacto ? 'mt-1 truncate text-base' : 'text-2xl'}`}>{valor}</p>
      </div>
    </div>
  );
}

export default function VistaAlertas({ plantaId, refrescoClave }) {
  const [res, setRes] = useState({ clave: null, lista: [], error: false });
  const [severidad, setSeveridad] = useState('todas');
  const [variable, setVariable] = useState('todas');
  const [busqueda, setBusqueda] = useState('');
  const [visibles, setVisibles] = useState(40);
  const clave = `${plantaId}|${refrescoClave}`;
  const cargando = res.clave == null;

  useEffect(() => {
    let vivo = true;
    getAlertas(300, plantaId ?? undefined)
      .then((lista) => vivo && setRes({ clave, lista, error: false }))
      .catch(() => vivo && setRes((r) => ({ ...r, clave, error: true })));
    return () => { vivo = false; };
  }, [clave, plantaId]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return res.lista.filter((a) =>
      (severidad === 'todas' || a.severidad === severidad)
      && (variable === 'todas' || (variable === 'sistema' ? !variableDe(a) : variableDe(a) === variable))
      && (!q || a.mensaje.toLowerCase().includes(q) || a.tipo.toLowerCase().includes(q)));
  }, [res.lista, severidad, variable, busqueda]);

  const total = res.lista.length;
  const errores = res.lista.filter((a) => a.severidad === 'error').length;
  const ultima = res.lista[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Contador icono={BellRing} titulo="Total (últimas 300)" valor={total} clase="bg-white/5 text-tinta" />
        <Contador icono={AlertOctagon} titulo="Errores" valor={errores} clase="bg-coral/10 text-coral" />
        <Contador icono={AlertTriangle} titulo="Advertencias" valor={total - errores} clase="bg-ambar/10 text-ambar" />
        <Contador icono={Clock} titulo="Última" valor={ultima ? fechaCorta(ultima.ts) : '—'} clase="bg-cielo/10 text-cielo" compacto />
      </div>

      <section className="panel overflow-hidden" aria-label="Listado de alertas">
        <TituloPanel icono={BellRing} titulo="Registro de alertas">
          {cargando && <Loader2 size={16} className="animate-spin text-niebla" aria-label="Cargando" />}
          {res.error && <span className="inline-flex items-center gap-1 text-xs text-coral"><AlertCircle size={14} /> Error al actualizar</span>}
          <span className="font-mono text-xs text-niebla">{filtradas.length} resultados</span>
        </TituloPanel>

        <div className="flex flex-wrap items-center gap-3 border-b border-white/8 px-5 py-3">
          <div role="radiogroup" aria-label="Severidad" className="inline-flex rounded-full border border-white/10 bg-noche-950/60 p-1">
            {SEVERIDADES.map((s) => (
              <button key={s.id} role="radio" aria-checked={severidad === s.id} onClick={() => setSeveridad(s.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  severidad === s.id ? 'bg-brote text-noche-950' : 'text-niebla hover:text-tinta'}`}>
                {s.texto}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="filtro-variable">Variable</label>
          <select id="filtro-variable" value={variable} onChange={(e) => setVariable(e.target.value)}
            className="rounded-full border border-white/10 bg-noche-950/60 px-3.5 py-2 text-xs font-semibold text-tinta focus:border-brote focus:outline-none">
            <option value="todas">Todas las variables</option>
            {VARIABLES.map((v) => <option key={v.clave} value={v.clave}>{v.nombre}</option>)}
            <option value="sistema">Sistema (sin datos)</option>
          </select>
          <div className="relative ml-auto w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-niebla" aria-hidden="true" />
            <label htmlFor="buscar-alerta" className="sr-only">Buscar en alertas</label>
            <input id="buscar-alerta" type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar…" className="w-full rounded-full border border-white/10 bg-noche-950/60 py-2 pl-9 pr-3 text-sm text-tinta placeholder:text-niebla/70 focus:border-brote focus:outline-none" />
          </div>
        </div>

        {!cargando && filtradas.length === 0
          ? <Vacio icono={CheckCircle2} titulo={total ? 'Ninguna alerta coincide con los filtros' : 'Sin alertas registradas'}
              texto={total ? 'Prueba con otros filtros.' : 'El ETL registrará aquí las advertencias y errores detectados.'} />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-niebla">
                  <tr className="border-b border-white/8">
                    <th scope="col" className="px-5 py-3 font-medium">Severidad</th>
                    <th scope="col" className="px-3 py-3 font-medium">Variable</th>
                    <th scope="col" className="px-3 py-3 font-medium">Tipo</th>
                    <th scope="col" className="px-3 py-3 font-medium">Detalle</th>
                    <th scope="col" className="px-3 py-3 font-medium">Planta</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Fecha</th>
                    <th scope="col" className="px-3 py-3 text-center font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {filtradas.slice(0, visibles).map((a) => {
                    const v = VAR_POR_CLAVE[variableDe(a)];
                    const Icono = v?.icono ?? WifiOff;
                    const waText = encodeURIComponent(`🌱 *AgroSense Alerta* [${(a.severidad || 'AVISO').toUpperCase()}]:\n${a.mensaje}\nPlanta: ${a.entity_id}`);
                    return (
                      <tr key={a.id} className="hover:bg-white/[.02]">
                        <td className="px-5 py-3"><SeveridadChip severidad={a.severidad} /></td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <Icono size={15} style={{ color: v?.color }} className={v ? '' : 'text-niebla'} aria-hidden="true" />
                            {v?.corto ?? 'Sistema'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-niebla">{describirTipo(a)}</td>
                        <td className="min-w-[260px] px-3 py-3 text-tinta/90">{a.mensaje}</td>
                        <td className="px-3 py-3 font-mono text-xs text-niebla">{a.entity_id}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right font-mono text-xs text-niebla">
                          <time dateTime={a.ts}>{fechaCorta(a.ts)}</time>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <a
                            href={`https://wa.me/?text=${waText}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg bg-savia/15 px-2 py-1 text-[11px] font-semibold text-savia hover:bg-savia/25 transition"
                            title="Compartir alerta por WhatsApp"
                          >
                            <MessageCircle size={12} />
                            WhatsApp
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtradas.length > visibles && (
                <div className="border-t border-white/8 p-3 text-center">
                  <button onClick={() => setVisibles((n) => n + 40)} className="rounded-full px-4 py-2 text-sm font-semibold text-brote hover:bg-brote/10">
                    Mostrar más ({filtradas.length - visibles} restantes)
                  </button>
                </div>
              )}
            </div>
          )}
      </section>
    </div>
  );
}
