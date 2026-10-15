import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff, Hourglass, Loader2 } from 'lucide-react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import VistaResumen from '../views/VistaResumen';
import VistaAlertas from '../views/VistaAlertas';
import VistaAsistente from '../views/VistaAsistente';
import {
  getPlantas, getEstado, getAlertas, getResumenAlertas, getLecturas, chat, errorChat, getUsuario,
} from '../api';
import { VISTAS } from '../lib/vistas';
import { calcularSalud } from '../lib/umbrales';

// recharts solo se descarga al abrir Historial
const VistaHistorial = lazy(() => import('../views/VistaHistorial'));

const REFRESCO_MS = 30000;
const CHAT_KEY = 'agro_chat';
const BIENVENIDA = {
  id: 'bienvenida', rol: 'ai',
  texto: 'Hola, soy tu **agrónomo virtual**. Pregúntame por el estado de la planta, si conviene regar, la luz que recibe o qué significan las alertas.',
};

let secuencia = 0;
const nuevoId = () => `${Date.now()}-${secuencia++}`; // crypto.randomUUID exige HTTPS

const vistaDesdeHash = () => {
  const h = window.location.hash.slice(1);
  return VISTAS.some((v) => v.id === h) ? h : 'resumen';
};

const cargarChat = () => {
  try {
    const m = JSON.parse(sessionStorage.getItem(CHAT_KEY));
    return Array.isArray(m) && m.length ? m : [BIENVENIDA];
  } catch {
    return [BIENVENIDA];
  }
};

export default function Dashboard({ onLogout }) {
  const [vista, setVista] = useState(vistaDesdeHash);
  const [plantas, setPlantas] = useState([]);
  const [plantaSel, setPlantaSel] = useState(null);
  const [estado, setEstado] = useState(null);
  const [conectado, setConectado] = useState(null); // null = cargando; true/false = ultimo refresco
  const [detalle, setDetalle] = useState({ alertas: [], resumen: null, lecturas: [] });
  const [tick, setTick] = useState(0);
  const [refrescando, setRefrescando] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  const [mensajes, setMensajes] = useState(cargarChat);
  const [enviando, setEnviando] = useState(false);

  const plantaId = plantaSel ?? plantas[0]?.entity_id ?? null;
  const planta = plantas.find((p) => p.entity_id === plantaId) ?? null;

  // Navegacion por hash (#resumen, #historial...) para que funcione el boton "atras"
  useEffect(() => {
    const alCambiar = () => setVista(vistaDesdeHash());
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);
  const irA = (id) => {
    if (window.location.hash.slice(1) !== id) window.location.hash = id;
    setVista(id);
  };

  // Reloj para "hace X min"
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // Datos globales: plantas + salud de servicios
  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      const est = await getEstado().catch(() => null);
      if (vivo) setEstado(est ?? { api: false, db: false, ia: false, modelo: null });
      try {
        const p = await getPlantas();
        if (!vivo) return;
        setPlantas(p);
        setConectado(true);
      } catch {
        if (vivo) setConectado(false);
      }
    };
    cargar();
    const id = setInterval(cargar, REFRESCO_MS);
    return () => { vivo = false; clearInterval(id); };
  }, [tick]);

  // Datos de la planta seleccionada
  useEffect(() => {
    if (!plantaId) return undefined;
    let vivo = true;
    const cargar = async () => {
      try {
        const [alertas, resumen, lecturas] = await Promise.all([
          getAlertas(50, plantaId), getResumenAlertas(plantaId), getLecturas(plantaId, 60),
        ]);
        if (vivo) setDetalle({ alertas, resumen, lecturas });
      } catch {
        /* el indicador de conexion lo maneja el efecto global */
      } finally {
        if (vivo) setRefrescando(false);
      }
    };
    cargar();
    const id = setInterval(cargar, REFRESCO_MS);
    return () => { vivo = false; clearInterval(id); };
  }, [plantaId, tick]);

  useEffect(() => {
    sessionStorage.setItem(CHAT_KEY, JSON.stringify(mensajes.slice(-40)));
  }, [mensajes]);

  const refrescar = () => {
    setRefrescando(true);
    setAhora(Date.now());
    setTick((t) => t + 1);
  };

  const enviarIA = async (pregunta) => {
    const historial = mensajes
      .filter((m) => m.id !== 'bienvenida' && !m.error)
      .slice(-8)
      .map(({ rol, texto }) => ({ rol, texto }));
    setMensajes((prev) => [...prev, { id: nuevoId(), rol: 'user', texto: pregunta }]);
    setEnviando(true);
    try {
      const texto = await chat(pregunta, plantaId, historial);
      setMensajes((prev) => [...prev, { id: nuevoId(), rol: 'ai', texto: texto || 'La IA no devolvió contenido.' }]);
    } catch (err) {
      setMensajes((prev) => [...prev, { id: nuevoId(), rol: 'ai', error: true, texto: errorChat(err) }]);
    } finally {
      setEnviando(false);
    }
  };

  const preguntarDesdeResumen = (p) => {
    irA('asistente');
    enviarIA(p);
  };

  const salud = calcularSalud(planta);
  const datosFrescos = planta ? ahora - new Date(planta.ts).getTime() < 15 * 60 * 1000 : false;
  const alertas24 = (detalle.resumen?.error?.h24 ?? 0) + (detalle.resumen?.warning?.h24 ?? 0);
  const chatProps = {
    mensajes, enviando, onEnviar: enviarIA, onLimpiar: () => setMensajes([BIENVENIDA]),
  };

  let contenido;
  if (vista === 'historial') {
    contenido = (
      <Suspense fallback={<p className="flex items-center gap-2 text-sm text-niebla"><Loader2 size={16} className="animate-spin" /> Cargando gráficas…</p>}>
        <VistaHistorial plantaId={plantaId} />
      </Suspense>
    );
  } else if (vista === 'alertas') contenido = <VistaAlertas plantaId={plantaId} refrescoClave={tick} />;
  else if (vista === 'asistente') {
    contenido = <VistaAsistente chat={chatProps} planta={planta} plantaId={plantaId} estado={estado} alertas={detalle.alertas} />;
  } else {
    contenido = (
      <VistaResumen planta={planta} lecturas={detalle.lecturas} alertas={detalle.alertas} resumenAlertas={detalle.resumen}
        salud={salud} estado={estado} datosFrescos={datosFrescos} onVista={irA} onPreguntar={preguntarDesdeResumen} />
    );
  }

  return (
    <div className="flex h-full bg-noche-950">
      <Sidebar vista={vista} onVista={irA} alertasNuevas={alertas24} estado={estado} usuario={getUsuario()} onLogout={onLogout} />

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <Topbar vista={vista} plantas={plantas} plantaId={plantaId} onPlanta={setPlantaSel} ultimaLectura={planta?.ts}
          ahora={ahora} conectado={conectado} refrescando={refrescando} onRefrescar={refrescar} onLogout={onLogout} />

        <main className="rejilla-fondo flex-1 px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:pb-10">
          <div className="mx-auto max-w-[1600px] space-y-6">
            {conectado === false && (
              <p role="alert" className="flex items-center gap-3 rounded-2xl border border-coral/30 bg-coral/10 px-5 py-4 text-sm text-coral">
                <WifiOff size={18} className="shrink-0" aria-hidden="true" />
                No hay conexión con la API o la base de datos. Se reintentará automáticamente cada 30 segundos.
              </p>
            )}
            {conectado && plantas.length === 0 && (
              <p className="flex items-center gap-3 rounded-2xl border border-cielo/30 bg-cielo/10 px-5 py-4 text-sm text-cielo">
                <Hourglass size={18} className="shrink-0" aria-hidden="true" />
                Esperando las primeras lecturas del sensor. El ETL las carga al DWH cada 5 minutos.
              </p>
            )}
            <AnimatePresence mode="wait">
              <motion.div key={vista} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}>
                {contenido}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
