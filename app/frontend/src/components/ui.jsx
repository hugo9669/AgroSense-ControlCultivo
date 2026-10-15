// Piezas visuales pequeñas reutilizadas por varias vistas
import { CheckCircle2, AlertTriangle, ArrowDown, ArrowUp, HelpCircle, AlertOctagon } from 'lucide-react';
import { ESTADOS } from '../lib/umbrales';

const ICONO_ESTADO = { ok: CheckCircle2, atencion: AlertTriangle, bajo: ArrowDown, alto: ArrowUp, 'sin-dato': HelpCircle };

/** Chip de estado: siempre icono + texto (no solo color) */
export function EstadoChip({ estado }) {
  const e = ESTADOS[estado] ?? ESTADOS['sin-dato'];
  const Icono = ICONO_ESTADO[estado] ?? HelpCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${e.clase}`}>
      <Icono size={12} aria-hidden="true" /> {e.texto}
    </span>
  );
}

export function SeveridadChip({ severidad }) {
  const error = severidad === 'error';
  const Icono = error ? AlertOctagon : AlertTriangle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
      error ? 'text-coral bg-coral/10 ring-coral/30' : 'text-ambar bg-ambar/10 ring-ambar/30'}`}>
      <Icono size={12} aria-hidden="true" /> {error ? 'Error' : 'Advertencia'}
    </span>
  );
}

/** Mini-grafica SVG sin dependencias */
export function Sparkline({ valores, color, alto = 36 }) {
  const datos = valores.filter((v) => v != null);
  if (datos.length < 2) {
    return <div style={{ height: alto }} className="flex items-center text-xs text-niebla/70">Sin tendencia aún</div>;
  }
  const min = Math.min(...datos);
  const max = Math.max(...datos);
  const rango = max - min || 1;
  const ancho = 100;
  const pts = datos.map((v, i) => [
    (i / (datos.length - 1)) * ancho,
    alto - 3 - ((v - min) / rango) * (alto - 6),
  ]);
  const linea = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,${alto} ${linea} ${ancho},${alto}`;
  const id = `sp-${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none" className="w-full" style={{ height: alto }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={linea} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Barra de rango: zona valida, zona optima resaltada y marcador del valor actual */
export function BarraRango({ def, valor }) {
  const [vmin, vmax] = def.valido;
  const pos = (x) => `${Math.max(0, Math.min(100, ((x - vmin) / (vmax - vmin)) * 100))}%`;
  return (
    <div className="relative mt-1 h-1.5 w-full rounded-full bg-white/8" aria-hidden="true">
      <div className="absolute inset-y-0 rounded-full bg-savia/35"
        style={{ left: pos(def.optimo[0]), width: `calc(${pos(def.optimo[1])} - ${pos(def.optimo[0])})` }} />
      {valor != null && (
        <div className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-tinta shadow-[0_0_8px] shadow-white/50"
          style={{ left: pos(valor) }} />
      )}
    </div>
  );
}

export function TituloPanel({ icono: Icono, titulo, children }) {
  return (
    <div className="flex items-center gap-2 border-b border-white/8 px-5 py-3.5">
      {Icono && <Icono size={17} className="text-brote" aria-hidden="true" />}
      <h3 className="text-sm font-semibold tracking-wide">{titulo}</h3>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export function Vacio({ icono: Icono, titulo, texto }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {Icono && <Icono size={28} className="text-niebla/60" aria-hidden="true" />}
      <p className="font-semibold text-tinta/90">{titulo}</p>
      {texto && <p className="max-w-sm text-sm text-niebla">{texto}</p>}
    </div>
  );
}
