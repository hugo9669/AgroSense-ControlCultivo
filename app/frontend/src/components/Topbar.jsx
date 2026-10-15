import { RefreshCw, Wifi, WifiOff, Loader2, Clock, LogOut, Sprout } from 'lucide-react';
import { VISTAS } from '../lib/vistas';
import { haceCuanto } from '../lib/umbrales';

function Conexion({ conectado }) {
  if (conectado == null) {
    return <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold text-niebla ring-1 ring-white/10">
      <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Conectando…</span>;
  }
  return conectado
    ? <span className="inline-flex items-center gap-2 rounded-full bg-savia/10 px-3 py-1.5 text-xs font-semibold text-savia ring-1 ring-savia/30">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-savia opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-savia" />
        </span>
        <Wifi size={14} aria-hidden="true" /> En línea</span>
    : <span className="inline-flex items-center gap-2 rounded-full bg-coral/10 px-3 py-1.5 text-xs font-semibold text-coral ring-1 ring-coral/30">
        <WifiOff size={14} aria-hidden="true" /> Sin conexión</span>;
}

export default function Topbar({ vista, plantas, plantaId, onPlanta, ultimaLectura, ahora, conectado, refrescando, onRefrescar, onLogout }) {
  const v = VISTAS.find((x) => x.id === vista);
  const lecturaVieja = ultimaLectura && ahora - new Date(ultimaLectura).getTime() > 15 * 60 * 1000;
  return (
    <header className="sticky top-0 z-20 border-b border-white/8 bg-noche-950/80 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 mr-auto">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{v?.nombre}</h1>
          <p className="text-sm text-niebla">{v?.descripcion}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="relative flex items-center">
            <span className="sr-only">Planta</span>
            <Sprout size={16} className="pointer-events-none absolute left-3 text-brote" aria-hidden="true" />
            <select value={plantaId ?? ''} onChange={(e) => onPlanta(e.target.value)} disabled={!plantas.length}
              className="appearance-none rounded-full border border-white/12 bg-noche-850 py-2 pl-9 pr-8 text-sm font-semibold text-tinta focus:border-brote focus:outline-none disabled:opacity-60">
              {!plantas.length && <option value="">Sin plantas</option>}
              {plantas.map((p) => <option key={p.entity_id} value={p.entity_id}>{p.entity_id}</option>)}
            </select>
            <span className="pointer-events-none absolute right-3 text-xs text-niebla" aria-hidden="true">▾</span>
          </label>

          <span title={ultimaLectura ? new Date(ultimaLectura).toLocaleString() : 'Sin lecturas'}
            className={`hidden sm:inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
              lecturaVieja ? 'bg-ambar/10 text-ambar ring-ambar/30' : 'bg-white/5 text-niebla ring-white/10'}`}>
            <Clock size={14} aria-hidden="true" /> Lectura {haceCuanto(ultimaLectura, ahora)}
          </span>

          <Conexion conectado={conectado} />

          <button onClick={onRefrescar} aria-label="Actualizar datos" title="Actualizar datos"
            className="rounded-full border border-white/12 bg-noche-850 p-2 text-niebla transition hover:text-brote">
            <RefreshCw size={16} className={refrescando ? 'animate-spin' : ''} />
          </button>
          <button onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión"
            className="lg:hidden rounded-full border border-white/12 bg-noche-850 p-2 text-niebla hover:text-coral">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
