import { motion } from 'framer-motion';
import { HeartPulse, CheckCircle2, AlertTriangle, AlertOctagon, HelpCircle } from 'lucide-react';
import { diagnosticoSalud } from '../lib/umbrales';

const TONOS = {
  savia: { trazo: '#34d399', texto: 'text-savia', fondo: 'from-savia/25', icono: CheckCircle2 },
  ambar: { trazo: '#fbbf24', texto: 'text-ambar', fondo: 'from-ambar/25', icono: AlertTriangle },
  coral: { trazo: '#fb7185', texto: 'text-coral', fondo: 'from-coral/25', icono: AlertOctagon },
  niebla: { trazo: '#9fb5aa', texto: 'text-niebla', fondo: 'from-white/10', icono: HelpCircle },
};

/** Medidor radial de salud + la planta que se marchita segun el indice (como el front original) */
export default function HealthGauge({ salud, plantaId }) {
  const d = diagnosticoSalud(salud);
  const t = TONOS[d.tono];
  const Icono = t.icono;
  const valor = salud ?? 0;

  // Arco de 270 grados
  const R = 88;
  const C = 2 * Math.PI * R;
  const arco = C * 0.75;
  const relleno = arco * (valor / 100);

  const marchito = 100 - valor;
  const filtro = `grayscale(${marchito}%) sepia(${marchito * 0.7}%) brightness(${valor < 50 ? 0.8 : 1}) saturate(${valor >= 80 ? 1.15 : 1})`;

  return (
    <section className="panel relative overflow-hidden p-6" aria-labelledby="titulo-salud">
      <div aria-hidden="true" className={`absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-gradient-to-b ${t.fondo} to-transparent blur-3xl`} />

      <div className="relative flex items-center gap-2">
        <HeartPulse size={18} className="text-brote" aria-hidden="true" />
        <h2 id="titulo-salud" className="text-sm font-semibold tracking-wide">Índice de salud</h2>
        <span className="ml-auto font-mono text-xs text-niebla">{plantaId ?? '—'}</span>
      </div>

      <div className="relative mx-auto mt-2 aspect-square w-full max-w-[290px]">
        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full -rotate-[225deg]" role="img"
          aria-label={salud == null ? 'Sin datos de salud' : `Salud ${valor} de 100: ${d.texto}`}>
          <circle cx="100" cy="100" r={R} fill="none" stroke="rgb(255 255 255 / .07)" strokeWidth="12"
            strokeDasharray={`${arco} ${C}`} strokeLinecap="round" />
          <motion.circle cx="100" cy="100" r={R} fill="none" stroke={t.trazo} strokeWidth="12" strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${C}` }} animate={{ strokeDasharray: `${relleno} ${C}` }}
            transition={{ duration: 1.4, ease: 'easeOut' }}
            style={{ filter: `drop-shadow(0 0 6px ${t.trazo})` }} />
        </svg>

        <motion.img src="/planta.png" alt="" aria-hidden="true"
          className="absolute left-1/2 top-[44%] w-[62%] -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-[0_18px_25px_rgba(0,0,0,.55)]"
          animate={{ scale: 0.9 + valor / 1000, rotate: marchito * 0.12, y: valor < 50 ? 10 : 0 }}
          transition={{ duration: 2, ease: 'easeOut' }}
          style={{ filter: filtro }} />

        <div className="absolute inset-x-0 bottom-[6%] text-center">
          <p className="font-mono text-5xl font-semibold leading-none tracking-tight">
            {salud == null ? '--' : valor}<span className="text-xl text-niebla">/100</span>
          </p>
        </div>
      </div>

      <div className="relative mt-3 flex items-center justify-center gap-2">
        <Icono size={18} className={t.texto} aria-hidden="true" />
        <p className={`text-lg font-bold ${t.texto}`}>{d.texto}</p>
      </div>
      <p className="relative mt-1 text-center text-sm text-niebla">{d.detalle}</p>
    </section>
  );
}
