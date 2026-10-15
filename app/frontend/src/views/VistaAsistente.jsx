import { Database, ShieldCheck, Sparkles, Info } from 'lucide-react';
import ChatPanel from '../components/ChatPanel';
import { TituloPanel, EstadoChip } from '../components/ui';
import { VARIABLES, estadoVariable, fmt, num, fechaCorta } from '../lib/umbrales';

export default function VistaAsistente({ chat, planta, plantaId, estado, alertas }) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <div className="xl:col-span-8 xl:h-[calc(100vh-11rem)]">
        <ChatPanel {...chat} plantaId={plantaId} iaActiva={estado?.ia} />
      </div>

      <aside className="space-y-6 xl:col-span-4">
        <section className="panel" aria-label="Contexto que recibe la IA">
          <TituloPanel icono={Database} titulo="Lo que ve la IA" />
          <div className="space-y-3 px-5 py-4">
            <p className="text-xs text-niebla">
              Última lectura limpia de <span className="font-mono text-tinta">{plantaId ?? '—'}</span>
              {planta && <> · {fechaCorta(planta.ts)}</>}
            </p>
            <ul className="space-y-2.5">
              {VARIABLES.map((def) => {
                const v = num(planta?.[def.clave]);
                const Icono = def.icono;
                return (
                  <li key={def.clave} className="flex items-center gap-3 text-sm">
                    <Icono size={16} style={{ color: def.color }} aria-hidden="true" />
                    <span className="text-niebla">{def.corto}</span>
                    <span className="ml-auto font-mono">{fmt(v, def.decimales)} {def.unidad}</span>
                    <EstadoChip estado={estadoVariable(def, v)} />
                  </li>
                );
              })}
            </ul>
            <div className="rounded-xl border border-white/8 bg-white/[.02] p-3 text-xs text-niebla">
              Además: resumen horario de 24 h, resumen diario de 7 días y las últimas
              <span className="font-semibold text-tinta"> {Math.min(alertas.length, 15)} alertas</span> de la planta.
            </div>
          </div>
        </section>

        <section className="panel p-5" aria-label="Modelo de IA">
          <div className="flex items-center gap-2">
            <Sparkles size={17} className="text-brote" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Modelo</h3>
            <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
              estado?.ia ? 'bg-savia/10 text-savia ring-savia/30' : 'bg-coral/10 text-coral ring-coral/30'}`}>
              {estado?.ia ? 'Activo' : 'Sin clave'}
            </span>
          </div>
          <p className="mt-2 font-mono text-sm">{estado?.modelo ?? '—'}</p>
          {estado && !estado.ia && (
            <p className="mt-3 flex gap-2 rounded-xl border border-ambar/30 bg-ambar/10 p-3 text-xs text-ambar">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              Falta GEMINI_API_KEY en el archivo .env del servidor. Agrégala y reinicia la API.
            </p>
          )}
          <ul className="mt-4 space-y-2 text-xs text-niebla">
            <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-savia" aria-hidden="true" /> La IA solo recibe datos ya limpios del DWH, nunca el dato crudo.</li>
            <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-savia" aria-hidden="true" /> Las conversaciones no se almacenan en Google (store = false).</li>
            <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-savia" aria-hidden="true" /> Recuerda los últimos turnos para preguntas de seguimiento.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
