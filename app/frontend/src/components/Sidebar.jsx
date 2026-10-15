import { Leaf, LogOut, Server, Database, Sparkles } from 'lucide-react';
import { VISTAS } from '../lib/vistas';

function Indicador({ ok, icono: Icono, texto }) {
  const tono = ok == null ? 'text-niebla' : ok ? 'text-savia' : 'text-coral';
  return (
    <li className="flex items-center gap-2 text-xs">
      <Icono size={14} className={tono} aria-hidden="true" />
      <span className="text-niebla">{texto}</span>
      <span className={`ml-auto font-semibold ${tono}`}>{ok == null ? '…' : ok ? 'OK' : 'Falla'}</span>
    </li>
  );
}

export default function Sidebar({ vista, onVista, alertasNuevas, estado, usuario, onLogout }) {
  return (
    <>
      {/* Escritorio */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-white/8 bg-noche-900/80 backdrop-blur">
        <div className="flex items-center gap-3 px-6 py-6">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brote text-noche-950 shadow-[0_0_30px_-6px] shadow-brote/60">
            <Leaf size={22} strokeWidth={2.4} />
          </span>
          <div>
            <p className="text-lg font-bold leading-none tracking-tight">Agro<span className="text-brote">Sense</span></p>
            <p className="mt-1 text-[11px] uppercase tracking-[.18em] text-niebla">Control de cultivo</p>
          </div>
        </div>

        <nav aria-label="Secciones" className="mt-2 flex-1 px-3">
          <ul className="space-y-1">
            {VISTAS.map(({ id, nombre, icono: Icono }) => {
              const activa = vista === id;
              return (
                <li key={id}>
                  <button onClick={() => onVista(id)} aria-current={activa ? 'page' : undefined}
                    className={`group relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${
                      activa ? 'bg-brote/12 text-tinta' : 'text-niebla hover:bg-white/5 hover:text-tinta'}`}>
                    {activa && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-brote" aria-hidden="true" />}
                    <Icono size={18} className={activa ? 'text-brote' : ''} aria-hidden="true" />
                    {nombre}
                    {id === 'alertas' && alertasNuevas > 0 && (
                      <span className="ml-auto rounded-full bg-coral px-2 py-0.5 text-[11px] font-bold text-noche-950">
                        {alertasNuevas > 99 ? '99+' : alertasNuevas}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="m-3 rounded-2xl border border-white/8 bg-white/[.02] p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.16em] text-niebla">Servicios</p>
          <ul className="space-y-2">
            <Indicador ok={estado?.api} icono={Server} texto="API" />
            <Indicador ok={estado?.db} icono={Database} texto="DWH Postgres" />
            <Indicador ok={estado == null ? null : estado.ia} icono={Sparkles} texto="IA Gemini" />
          </ul>
        </div>

        <div className="flex items-center gap-3 border-t border-white/8 px-5 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/8 text-sm font-bold uppercase">
            {usuario.slice(0, 2)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{usuario}</p>
            <p className="text-xs text-niebla">Administrador</p>
          </div>
          <button onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión"
            className="ml-auto rounded-lg p-2 text-niebla transition hover:bg-coral/10 hover:text-coral">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Movil: barra inferior */}
      <nav aria-label="Secciones" className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-noche-900/95 backdrop-blur">
        <ul className="grid grid-cols-4">
          {VISTAS.map(({ id, nombre, icono: Icono }) => {
            const activa = vista === id;
            return (
              <li key={id}>
                <button onClick={() => onVista(id)} aria-current={activa ? 'page' : undefined}
                  className={`relative flex w-full flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${activa ? 'text-brote' : 'text-niebla'}`}>
                  <Icono size={20} aria-hidden="true" />
                  {nombre.replace(' IA', '')}
                  {id === 'alertas' && alertasNuevas > 0 && (
                    <span className="absolute right-1/4 top-1.5 h-2 w-2 rounded-full bg-coral" aria-label={`${alertasNuevas} alertas`} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
