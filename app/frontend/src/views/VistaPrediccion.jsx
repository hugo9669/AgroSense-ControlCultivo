import { useEffect, useState } from 'react';
import {
  Droplets, TrendingDown, TrendingUp, Minus, Clock, AlertTriangle,
  CheckCircle2, RefreshCw, Send, Database, ShieldCheck, Calendar,
  BarChart3, Sparkles, AlertCircle
} from 'lucide-react';
import { TituloPanel } from '../components/ui';
import { getPrediccion, getPrediccionesGuardadas, enviarTelegramDirecto } from '../api';

export default function VistaPrediccion({ plantaId, tick, onVista }) {
  const [modeloVivo, setModeloVivo] = useState(null);
  const [prediccionesDb, setPrediccionesDb] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [enviandoTg, setEnviandoTg] = useState(false);
  const [tgExito, setTgExito] = useState(null);

  const cargarDatos = () => {
    if (!plantaId) return;
    setCargando(true);
    setError(false);

    Promise.all([
      getPrediccion(plantaId, 24).catch(() => null),
      getPrediccionesGuardadas(plantaId).catch(() => []),
    ])
      .then(([vivo, desdeDb]) => {
        setModeloVivo(vivo);
        setPrediccionesDb(desdeDb || []);
      })
      .catch(() => setError(true))
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    cargarDatos();
  }, [plantaId, tick]);

  const enviarAlertaTelegram = async () => {
    if (!modeloVivo && prediccionesDb.length === 0) return;
    setEnviandoTg(true);
    setTgExito(null);

    const hActual = modeloVivo?.humedad_actual ?? (prediccionesDb[0]?.soil_moisture_pred ?? 'N/D');
    const hRiego = modeloVivo?.horas_hasta_riego;
    const rec = modeloVivo?.recomendacion_agronomica ?? 'Revisar estado hídrico de la planta.';

    let texto = `*🌱 AgroSense · Alerta Predictiva Hídrica*\n` +
      `Planta: *${plantaId}*\n` +
      `💧 Humedad de suelo actual: *${hActual}%*\n`;

    if (hRiego !== null && hRiego !== undefined) {
      if (hRiego === 0) {
        texto += `🚨 *¡AGUA AGOTADA! El suelo está por debajo del umbral de estrés (30%). Riego urgente requerido.*\n`;
      } else {
        texto += `⚠️ *¡Atención! El agua se agotará en aprox. ${hRiego} horas.*\n`;
      }
    }

    if (modeloVivo?.tasa_cambio_por_dia) {
      texto += `📉 Tasa de variación: *${modeloVivo.tasa_cambio_por_dia}%/día*\n`;
    }

    texto += `📋 Recomendación: ${rec}\n` +
      `_Datos calculados desde PostgreSQL DWH._`;

    try {
      const res = await enviarTelegramDirecto(texto);
      if (res?.enviado) {
        setTgExito('¡Alerta enviada a Telegram con éxito! ✈️');
      } else {
        setTgExito(res?.motivo || 'Error al enviar a Telegram');
      }
    } catch {
      setTgExito('Error al conectar con la API de notificaciones');
    } finally {
      setEnviandoTg(false);
      setTimeout(() => setTgExito(null), 6000);
    }
  };

  const tablaDias = prediccionesDb.length > 0
    ? prediccionesDb
    : (modeloVivo?.predicciones_diarias || []);

  const esCritico = modeloVivo?.horas_hasta_riego !== null &&
    modeloVivo?.horas_hasta_riego !== undefined &&
    modeloVivo.horas_hasta_riego <= 6;

  return (
    <div className="space-y-6">
      {/* Cabecera de la vista */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-cielo/15 text-cielo">
              <Droplets size={20} />
            </span>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-tinta">
                Modelo Predictivo & Pronóstico Hídrico
              </h2>
              <p className="text-xs text-niebla">
                Datos calculados y persistidos en PostgreSQL (<code className="font-mono text-[11px] text-cielo">prediccion_diaria</code>) · Cero datos inventados
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={cargarDatos}
            disabled={cargando}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-tinta transition hover:bg-white/10 disabled:opacity-50"
            title="Refrescar predicciones"
          >
            <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
            Actualizar
          </button>

          <button
            onClick={enviarAlertaTelegram}
            disabled={enviandoTg || (!modeloVivo && tablaDias.length === 0)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold shadow-lg transition disabled:opacity-50 ${
              esCritico
                ? 'bg-coral text-noche-950 shadow-coral/30 hover:bg-coral/90 animate-pulse'
                : 'bg-sky-500 text-noche-950 shadow-sky-500/20 hover:bg-sky-400'
            }`}
          >
            <Send size={15} />
            {enviandoTg ? 'Enviando…' : 'Enviar a Telegram ✈️'}
          </button>
        </div>
      </div>

      {tgExito && (
        <div className="flex items-center gap-2 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-400">
          <CheckCircle2 size={16} />
          <span>{tgExito}</span>
        </div>
      )}

      {/* Alerta de Déficit Hídrico Inminente */}
      {esCritico && (
        <div className="rounded-2xl border border-coral/40 bg-coral/10 p-5 text-tinta shadow-xl">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-coral/20 text-coral">
              <AlertTriangle size={26} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-coral px-2 py-0.5 text-[10px] font-black uppercase text-noche-950">
                  ALERTA CRÍTICA
                </span>
                <h3 className="font-bold text-sm text-coral">
                  ¡El agua del suelo está a punto de agotarse!
                </h3>
              </div>
              <p className="mt-1 text-xs text-tinta/90 leading-relaxed">
                Según la tasa de evapotranspiración calculada en el DWH, el contenido de humedad descenderá
                por debajo del umbral de estrés hídrico (30%) en aproximadamente{' '}
                <strong className="text-white font-mono">{modeloVivo.horas_hasta_riego} horas</strong>.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={enviarAlertaTelegram}
                  className="rounded-lg bg-coral px-3 py-1.5 text-xs font-bold text-noche-950 hover:bg-coral/90 transition flex items-center gap-1.5"
                >
                  <Send size={14} />
                  Enviar Alerta Urgente a Telegram
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tarjetas resumen del modelo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Humedad actual */}
        <div className="panel p-5">
          <div className="flex items-center justify-between text-niebla">
            <span className="text-xs uppercase tracking-wider">Humedad Suelo Actual</span>
            <Droplets size={16} className="text-cielo" />
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-tinta">
            {modeloVivo?.humedad_actual ?? '--'}%
          </p>
          <span className="mt-1 block text-[11px] text-niebla">
            Umbral mínimo de riego: 30.0%
          </span>
        </div>

        {/* Tasa y tendencia */}
        <div className="panel p-5">
          <div className="flex items-center justify-between text-niebla">
            <span className="text-xs uppercase tracking-wider">Dinámica de Secado</span>
            {modeloVivo?.tasa_cambio_por_hora < -0.05 ? (
              <TrendingDown size={16} className="text-ambar" />
            ) : modeloVivo?.tasa_cambio_por_hora > 0.05 ? (
              <TrendingUp size={16} className="text-savia" />
            ) : (
              <Minus size={16} className="text-niebla" />
            )}
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-tinta">
            {modeloVivo?.tasa_cambio_por_dia != null
              ? `${modeloVivo.tasa_cambio_por_dia > 0 ? '+' : ''}${modeloVivo.tasa_cambio_por_dia}%/d`
              : '--'}
          </p>
          <span className="mt-1 block text-[11px] text-niebla">
            {modeloVivo?.tasa_cambio_por_hora != null
              ? `Tasa horaria: ${modeloVivo.tasa_cambio_por_hora}%/h`
              : 'En cálculo…'}
          </span>
        </div>

        {/* Tiempo hasta riego */}
        <div className="panel p-5">
          <div className="flex items-center justify-between text-niebla">
            <span className="text-xs uppercase tracking-wider">Tiempo hasta Riego</span>
            <Clock size={16} className="text-cielo" />
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-cielo">
            {modeloVivo?.horas_hasta_riego != null
              ? modeloVivo.horas_hasta_riego === 0
                ? '¡Inmediato!'
                : `${modeloVivo.horas_hasta_riego} h`
              : 'Seguro'}
          </p>
          <span className="mt-1 block text-[11px] text-niebla">
            {modeloVivo?.fecha_estimada_riego
              ? `Hora est.: ${new Date(modeloVivo.fecha_estimada_riego).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Reserva hídrica suficiente'}
          </span>
        </div>

        {/* Calidad del modelo en PostgreSQL */}
        <div className="panel p-5">
          <div className="flex items-center justify-between text-niebla">
            <span className="text-xs uppercase tracking-wider">Calibración en Postgres</span>
            <Database size={16} className="text-brote" />
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-tinta">
            R² {modeloVivo?.metricas_modelo?.r2 ?? '--'}
          </p>
          <span className="mt-1 block text-[11px] text-niebla">
            {modeloVivo?.muestras_reales
              ? `${modeloVivo.muestras_reales} lecturas reales analizadas`
              : 'Tabla prediccion_diaria'}
          </span>
        </div>
      </div>

      {/* Mensaje de espera si no hay suficientes datos reales */}
      {modeloVivo && !modeloVivo.disponible && (
        <div className="panel p-6">
          <div className="flex items-center gap-3 text-niebla">
            <Clock size={20} className="text-cielo" />
            <div>
              <h3 className="text-sm font-semibold text-tinta">Esperando Muestras Reales</h3>
              <p className="mt-0.5 text-xs text-niebla leading-relaxed">{modeloVivo.motivo}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabla de Predicciones Multi-Día desde PostgreSQL */}
      <section className="panel overflow-hidden" aria-labelledby="titulo-tabla-prediccion">
        <div className="border-b border-white/8 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="titulo-tabla-prediccion" className="text-base font-semibold text-tinta flex items-center gap-2">
                <Calendar size={18} className="text-cielo" />
                Predicciones de Siguientes Días (Tabla PostgreSQL: prediccion_diaria)
              </h3>
              <p className="text-xs text-niebla">
                Proyecciones calculadas automáticamente por el ETL y persistidas en la base de datos
              </p>
            </div>
            <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-xs text-niebla ring-1 ring-white/10">
              {tablaDias.length} días proyectados
            </span>
          </div>
        </div>

        {cargando ? (
          <div className="py-12 text-center text-xs text-niebla">
            Consultando predicciones desde PostgreSQL…
          </div>
        ) : tablaDias.length === 0 ? (
          <div className="py-12 text-center text-xs text-niebla">
            <AlertCircle size={24} className="mx-auto mb-2 text-niebla/60" />
            No hay predicciones guardadas todavía en la base de datos.
            <br />
            El ETL calculará y guardará las proyecciones automáticamente en cuanto existan lecturas del sensor.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/8 bg-white/[.01] text-[11px] uppercase tracking-wider text-niebla">
                <tr>
                  <th className="px-6 py-3.5">Fecha Proyectada</th>
                  <th className="px-6 py-3.5">Días Futuros</th>
                  <th className="px-6 py-3.5">Humedad Suelo Predicha</th>
                  <th className="px-6 py-3.5">Temp / Hum Aire</th>
                  <th className="px-6 py-3.5">Tendencia</th>
                  <th className="px-6 py-3.5">¿Requiere Riego?</th>
                  <th className="px-6 py-3.5">Recomendación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tablaDias.map((p, i) => {
                  const reqRiego = p.requiere_riego || p.soil_moisture_pred <= 30.0;
                  const hum = Number(p.soil_moisture_pred).toFixed(1);

                  return (
                    <tr
                      key={p.fecha_proyectada || i}
                      className={`transition hover:bg-white/[.02] ${
                        reqRiego ? 'bg-coral/[.03]' : ''
                      }`}
                    >
                      <td className="px-6 py-4 font-mono font-medium text-tinta">
                        {p.fecha_proyectada}
                      </td>
                      <td className="px-6 py-4 text-niebla">
                        +{p.dias_adelante ?? i + 1} {p.dias_adelante === 1 ? 'día' : 'días'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span
                            className={`font-mono text-sm font-bold ${
                              reqRiego
                                ? 'text-coral'
                                : Number(hum) < 40
                                ? 'text-ambar'
                                : 'text-savia'
                            }`}
                          >
                            {hum}%
                          </span>
                          <div className="h-1.5 w-20 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                reqRiego
                                  ? 'bg-coral'
                                  : Number(hum) < 40
                                  ? 'bg-ambar'
                                  : 'bg-savia'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(0, Number(hum)))}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-niebla font-mono">
                        {p.temp_pred != null ? `${Number(p.temp_pred).toFixed(1)}°C` : '--'} /{' '}
                        {p.hum_pred != null ? `${Number(p.hum_pred).toFixed(1)}%` : '--'}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            p.tendencia === 'secando'
                              ? 'bg-ambar/15 text-ambar'
                              : p.tendencia === 'humedeciendo'
                              ? 'bg-savia/15 text-savia'
                              : 'bg-white/5 text-niebla'
                          }`}
                        >
                          {p.tendencia}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {reqRiego ? (
                          <span className="inline-flex items-center gap-1 font-bold text-coral text-[11px]">
                            <AlertTriangle size={13} />
                            Sí (Crítico)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-savia text-[11px]">
                            <CheckCircle2 size={13} />
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-niebla max-w-xs truncate" title={p.recomendacion}>
                        {p.recomendacion || 'Condiciones estables.'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Explicación de la arquitectura de Eventos y Suscripciones */}
      <section className="panel p-6 border-white/10 bg-white/[.01]">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={18} className="text-brote" />
          <h4 className="text-sm font-semibold text-tinta">
            Verificación de Arquitectura Basada en Eventos y Suscripciones
          </h4>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs text-niebla">
          <div className="rounded-xl border border-white/6 bg-white/[.02] p-3.5">
            <span className="font-semibold text-tinta block mb-1">1. Ingesta Cifrada & Context Broker</span>
            El microcontrolador ESP32 transmite datos firmados con HMAC-SHA256 (y opcional TLS) a través del IoT Agent hacia Orion Context Broker.
          </div>
          <div className="rounded-xl border border-white/6 bg-white/[.02] p-3.5">
            <span className="font-semibold text-tinta block mb-1">2. Suscripción Orion &rarr; QuantumLeap</span>
            Suscripción NGSIv2 activa en Orion que notifica por eventos a QuantumLeap para persistir series temporales en CrateDB.
          </div>
          <div className="rounded-xl border border-white/6 bg-white/[.02] p-3.5">
            <span className="font-semibold text-tinta block mb-1">3. Crontab ETL & WebSockets</span>
            El ETL es ejecutado periódicamente por crontab en el contenedor. Si detecta anomalías o déficit hídrico, emite eventos en tiempo real al WebSocket y genera alertas directas a Telegram.
          </div>
        </div>
      </section>
    </div>
  );
}
