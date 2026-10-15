import { useState } from 'react';
import { motion } from 'framer-motion';
import { Leaf, User, Lock, Eye, EyeOff, Loader2, ArrowRight, AlertCircle, Radio, Database, Sparkles } from 'lucide-react';
import { login, setSesion } from '../api';

const PILARES = [
  { icono: Radio, texto: 'Sensado en tiempo real con FIWARE Orion' },
  { icono: Database, texto: 'Histórico crudo en CrateDB y DWH en Postgres' },
  { icono: Sparkles, texto: 'Recomendaciones de riego y luz con Gemini' },
];

export default function Login({ onLogin }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const ingresar = async (e) => {
    e.preventDefault();
    setCargando(true);
    setError('');
    try {
      const r = await login(usuario.trim(), password);
      setSesion(r.token, r.usuario ?? usuario.trim());
      onLogin();
    } catch (err) {
      setError(err.response?.status === 401
        ? 'Usuario o contraseña incorrectos.'
        : 'No se pudo contactar al servidor. Intente de nuevo.');
      setCargando(false);
    }
  };

  return (
    <div className="relative min-h-full w-full overflow-hidden bg-noche-950 rejilla-fondo flex items-center justify-center p-6">
      {/* Fondo: foto + halos animados */}
      <img src="/fondo-login.jpg" alt="" aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover opacity-[.12] mix-blend-luminosity" />
      <div aria-hidden="true" className="absolute -top-40 -left-40 h-[32rem] w-[32rem] rounded-full bg-brote/20 blur-3xl animate-brillo" />
      <div aria-hidden="true" className="absolute -bottom-48 -right-32 h-[36rem] w-[36rem] rounded-full bg-cielo/10 blur-3xl animate-brillo [animation-delay:-6s]" />

      <div className="relative z-10 grid w-full max-w-5xl items-center gap-10 lg:grid-cols-2">
        {/* Marca */}
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7 }}
          className="hidden lg:block">
          <div className="mb-8 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brote text-noche-950 shadow-[0_0_40px_-6px] shadow-brote/60">
              <Leaf size={26} strokeWidth={2.4} />
            </span>
            <span className="text-2xl font-bold tracking-tight">Agro<span className="text-brote">Sense</span></span>
          </div>
          <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight">
            Tu cultivo,<br />
            <span className="bg-gradient-to-r from-brote via-savia to-cielo bg-clip-text text-transparent">bajo control.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-niebla">
            Centro de control IoT para monitorear temperatura, humedad, luz y suelo de tus plantas, con alertas y un asistente agrónomo con IA.
          </p>
          <ul className="mt-8 space-y-3">
            {PILARES.map(({ icono: Icono, texto }) => (
              <li key={texto} className="flex items-center gap-3 text-sm text-tinta/90">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10 text-brote">
                  <Icono size={16} />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </motion.section>

        {/* Formulario */}
        <motion.section initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .5, delay: .1 }}
          className="panel mx-auto w-full max-w-md p-8 sm:p-10 backdrop-blur-xl bg-noche-900/70">
          <div className="mb-8 lg:hidden flex items-center gap-2">
            <Leaf className="text-brote" size={22} />
            <span className="text-xl font-bold">Agro<span className="text-brote">Sense</span></span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-niebla">Acceso al centro de control del cultivo</p>

          <form onSubmit={ingresar} className="mt-8 space-y-5">
            <div>
              <label htmlFor="usuario" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-niebla">Usuario</label>
              <div className="relative">
                <User aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-niebla" size={18} />
                <input id="usuario" type="text" required autoComplete="username" value={usuario}
                  onChange={(e) => setUsuario(e.target.value)} placeholder="admin"
                  className="w-full rounded-xl border border-white/15 bg-noche-950/60 py-3.5 pl-12 pr-4 text-sm text-tinta placeholder:text-niebla/60 transition focus:border-brote focus:outline-none focus:ring-4 focus:ring-brote/15" />
              </div>
            </div>

            <div>
              <label htmlFor="clave" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-niebla">Contraseña</label>
              <div className="relative">
                <Lock aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-niebla" size={18} />
                <input id="clave" type={verClave ? 'text' : 'password'} required autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                  className="w-full rounded-xl border border-white/15 bg-noche-950/60 py-3.5 pl-12 pr-12 text-sm text-tinta placeholder:text-niebla/60 transition focus:border-brote focus:outline-none focus:ring-4 focus:ring-brote/15" />
                <button type="button" onClick={() => setVerClave((v) => !v)}
                  aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-niebla hover:text-tinta">
                  {verClave ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <motion.p role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-xl border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-coral">
                <AlertCircle size={16} className="shrink-0" /> {error}
              </motion.p>
            )}

            <button type="submit" disabled={cargando}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-brote py-3.5 font-semibold text-noche-950 shadow-[0_10px_30px_-10px] shadow-brote/60 transition hover:brightness-110 active:scale-[.98] disabled:opacity-70">
              {cargando
                ? <><Loader2 className="animate-spin" size={18} /> Verificando…</>
                : <>Entrar al centro de control <ArrowRight size={18} className="transition group-hover:translate-x-0.5" /></>}
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-niebla/80">Sesión válida por 8 horas · Datos servidos desde AWS EC2</p>
        </motion.section>
      </div>
    </div>
  );
}
