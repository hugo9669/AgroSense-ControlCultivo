import { motion } from 'framer-motion';
import { EstadoChip, BarraRango } from './ui';
import { estadoVariable, fmt } from '../lib/umbrales';

export default function MetricCard({ def, valor, indice = 0 }) {
  const estado = estadoVariable(def, valor);
  const Icono = def.icono;
  return (
    <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: indice * 0.06 }}
      whileHover={{ y: -3 }} className="panel flex flex-col justify-between gap-4 p-5" aria-label={`${def.nombre}: ${fmt(valor, def.decimales)} ${def.unidad}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl ring-1 ring-white/10"
          style={{ background: `${def.color}1f`, color: def.color }}>
          <Icono size={20} aria-hidden="true" />
        </span>
        <p className="text-sm font-medium text-niebla">{def.nombre}</p>
        <span className="ml-auto"><EstadoChip estado={estado} /></span>
      </div>

      <p className="flex items-baseline gap-1.5 py-1">
        <span className="font-mono text-4xl font-semibold tracking-tight">{fmt(valor, def.decimales)}</span>
        <span className="text-base font-semibold text-niebla">{def.unidad}</span>
      </p>

      <div>
        <BarraRango def={def} valor={valor} />
        <p className="mt-2 flex justify-between text-[11px] text-niebla">
          <span>Óptimo {fmt(def.optimo[0])}–{fmt(def.optimo[1])} {def.unidad}</span>
          <span>Ideal {fmt(def.ideal[0])}–{fmt(def.ideal[1])} {def.unidad}</span>
        </p>
      </div>
    </motion.article>
  );
}
