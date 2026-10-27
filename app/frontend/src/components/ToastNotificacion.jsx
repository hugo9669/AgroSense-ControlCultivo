import { motion, AnimatePresence } from 'framer-motion';
import { AlertOctagon, AlertTriangle, Sparkles, CheckCircle2, Info, X, Droplets, Send } from 'lucide-react';

const ICONOS = {
  error: AlertOctagon,
  warning: AlertTriangle,
  prediccion: Droplets,
  etl_sincronizado: CheckCircle2,
  info: Info,
};

const ESTILOS = {
  error: {
    borde: 'border-coral/40 bg-coral/10 text-coral',
    icono: 'bg-coral/20 text-coral',
    badge: 'bg-coral text-noche-950',
  },
  warning: {
    borde: 'border-ambar/40 bg-ambar/10 text-ambar',
    icono: 'bg-ambar/20 text-ambar',
    badge: 'bg-ambar text-noche-950',
  },
  prediccion: {
    borde: 'border-cielo/40 bg-cielo/10 text-cielo',
    icono: 'bg-cielo/20 text-cielo',
    badge: 'bg-cielo text-noche-950',
  },
  etl_sincronizado: {
    borde: 'border-brote/40 bg-brote/10 text-brote',
    icono: 'bg-brote/20 text-brote',
    badge: 'bg-brote text-noche-950',
  },
  info: {
    borde: 'border-white/20 bg-white/5 text-tinta',
    icono: 'bg-white/10 text-niebla',
    badge: 'bg-white/20 text-tinta',
  },
};

export default function ContenedorToasts({ notificaciones, onCerrar }) {
  if (!notificaciones || notificaciones.length === 0) return null;

  return (
    <aside aria-label="Notificaciones en tiempo real"
      className="fixed bottom-6 right-6 z-50 flex max-w-md flex-col gap-3 pointer-events-none">
      <AnimatePresence>
        {notificaciones.map((n) => {
          const tipo = n.tipo === 'prediccion' ? 'prediccion' : (n.severidad || 'info');
          const estilo = ESTILOS[tipo] ?? ESTILOS.info;
          const Icono = ICONOS[tipo] ?? (n.tipo === 'prediccion' ? Droplets : Info);

          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.9 }}
              transition={{ duration: 0.25 }}
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-2xl backdrop-blur-xl ${estilo.borde} bg-noche-900/90 text-tinta`}
              role="alert"
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${estilo.icono}`}>
                <Icono size={20} aria-hidden="true" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${estilo.badge}`}>
                    {n.tipo === 'prediccion' ? 'Predicción' : (n.severidad || 'Aviso')}
                  </span>
                  <span className="font-semibold text-xs tracking-wide">{n.titulo}</span>
                  <span className="ml-auto text-[10px] text-niebla">WebSocket</span>
                </div>
                <p className="mt-1 text-xs text-tinta/90 leading-relaxed">{n.mensaje}</p>

                {(n.severidad === 'warning' || n.severidad === 'error' || n.tipo === 'prediccion') && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <a
                      href="https://t.me/agrosense_mi_bot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/20 px-2.5 py-1 text-[11px] font-semibold text-sky-400 hover:bg-sky-500/30 transition shadow-sm"
                    >
                      <Send size={12} />
                      Ver en Telegram ✈️
                    </a>
                  </div>
                )}
              </div>

              <button
                onClick={() => onCerrar(n.id)}
                className="shrink-0 rounded-lg p-1 text-niebla hover:bg-white/10 hover:text-tinta transition"
                aria-label="Cerrar notificación"
              >
                <X size={15} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </aside>
  );
}
