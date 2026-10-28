import { useEffect, useState } from 'react';
import {
  Droplets, TrendingDown, TrendingUp, Minus, Clock, AlertTriangle,
  CheckCircle2, RefreshCw, Send, Database, ShieldCheck, Calendar,
  Thermometer, Sun, Sprout, AlertCircle
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine
} from 'recharts';
import { getPrediccion, getPrediccionesGuardadas } from '../api';

const CONFIG_VARIABLES = [
  {
    clave: 'soil_moisture',
    titulo: 'Humedad del suelo',
    unidad: '%',
    decimales: 1,
    icono: Sprout,
    colorReal: '#34d399',
    colorTrain: '#38bdf8',
    colorTest: '#fb923c',
    colorPred: '#9be15d',
  },
  {
    clave: 'temperature',
    titulo: 'Temperatura del aire',
    unidad: '°C',
    decimales: 1,
    icono: Thermometer,
    colorReal: '#34d399',
    colorTrain: '#38bdf8',
    colorTest: '#fb923c',
    colorPred: '#34d399',
  },
  {
    clave: 'luminosity',
    titulo: 'Luminosidad',
    unidad: 'lx',
    decimales: 0,
    icono: Sun,
    colorReal: '#facc15',
    colorTrain: '#38bdf8',
    colorTest: '#fb923c',
    colorPred: '#facc15',
  },
  {
    clave: 'humidity',
    titulo: 'Humedad del aire',
    unidad: '%',
    decimales: 1,
    icono: Droplets,
    colorReal: '#38bdf8',
    colorTrain: '#38bdf8',
    colorTest: '#fb923c',
    colorPred: '#34d399',
  },
];

function fmtVal(v, dec = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '--';
  return Number(v).toFixed(dec);
}

function TooltipPrediccion({ active, payload, label, unidad, decimales }) {
  if (!active || !payload?.length) return null;
  const horaStr = new Date(label).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="rounded-xl border border-white/10 bg-noche-900/95 px-3.5 py-2.5 text-xs shadow-xl backdrop-blur">
      <p className="mb-1.5 font-mono font-semibold text-tinta">{horaStr}</p>
      {payload.map((p) => {
        if (p.dataKey === 'banda_max' || p.dataKey === 'banda_min' || p.value == null) return null;
        return (
          <p key={p.dataKey} className="flex items-center gap-2 text-niebla">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span>{p.name}:</span>
            <span className="font-mono font-semibold text-tinta">
              {fmtVal(p.value, decimales)} {unidad}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function TarjetaGraficaPrediccion({ conf, modeloVar }) {
  const Icono = conf.icono;
  if (!modeloVar || !modeloVar.disponible || !modeloVar.serie_grafica?.length) {
    return (
      <article className="panel p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Icono size={18} style={{ color: conf.colorPred }} />
            <h3 className="text-base font-bold text-tinta">{conf.titulo}</h3>
          </div>
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-niebla">
            Sin evaluar
          </span>
        </div>
        <p className="mt-4 text-xs text-niebla">
          Acumulando lecturas continuas en el DWH para entrenar el pronóstico recursivo de {conf.titulo.toLowerCase()}…
        </p>
      </article>
    );
  }

  const {
    horizonte,
    tendencia_hora,
    horas_ventana,
    muestras_ventana,
    n_train,
    n_test,
    r2,
    rmse,
    ultima_lectura_ts,
    serie_grafica,
  } = modeloVar;

  const h1 = horizonte?.h1 ?? {};
  const h3 = horizonte?.h3 ?? {};
  const h6 = horizonte?.h6 ?? {};
  const signo = tendencia_hora > 0 ? '+' : '';

  const valoresY = [];
  serie_grafica.forEach((p) => {
    if (p.real != null) valoresY.push(p.real);
    if (p.prediccion != null) valoresY.push(p.prediccion);
    if (p.banda_min != null) valoresY.push(p.banda_min);
    if (p.banda_max != null) valoresY.push(p.banda_max);
  });
  const minY = valoresY.length ? Math.min(...valoresY) : 0;
  const maxY = valoresY.length ? Math.max(...valoresY) : 100;
  const span = Math.max(maxY - minY, conf.clave === 'luminosity' ? 50 : 2);
  const domMin = Math.max(0, Number((minY - span * 0.18).toFixed(conf.decimales)));
  const domMax = Number((maxY + span * 0.18).toFixed(conf.decimales));

  const evaluado = r2 != null && muestras_ventana >= 6;

  return (
    <article className="panel p-6 flex flex-col justify-between">
      <div>
        {/* Cabecera estilo tarjeta de pronóstico */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Icono size={19} style={{ color: conf.colorPred }} />
            <h3 className="text-lg font-bold tracking-tight text-tinta">{conf.titulo}</h3>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              evaluado
                ? 'bg-savia/15 text-savia ring-1 ring-savia/30'
                : 'bg-white/8 text-niebla'
            }`}
          >
            {evaluado ? `Evaluado · R² ${fmtVal(r2, 2)}` : 'Sin evaluar'}
          </span>
        </div>

        {/* Subtítulo con proyecciones a 1h, 3h y 6h ± incertidumbre */}
        <p className="mt-2 text-xs leading-relaxed text-niebla">
          en 1 h:{' '}
          <strong className="font-mono text-tinta">
            {fmtVal(h1.valor, conf.decimales)} ± {fmtVal(h1.error, conf.decimales)} {conf.unidad}
          </strong>
          ; en 3 h:{' '}
          <strong className="font-mono text-tinta">
            {fmtVal(h3.valor, conf.decimales)} ± {fmtVal(h3.error, conf.decimales)} {conf.unidad}
          </strong>
          ; en 6 h:{' '}
          <strong className="font-mono text-tinta">
            {fmtVal(h6.valor, conf.decimales)} ± {fmtVal(h6.error, conf.decimales)} {conf.unidad}
          </strong>{' '}
          <span className="text-niebla/80">
            (tendencia {signo}{fmtVal(tendencia_hora, conf.decimales === 0 ? 1 : 2)} {conf.unidad}/h, últimas {horas_ventana} h)
          </span>
        </p>

        {/* Leyenda compacta Entrenamiento / Prueba / Predicciones */}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-niebla">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-sky-400" />
            Entrenamiento ({n_train})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-orange-400" />
            Prueba ({n_test})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-emerald-400" />
            Predicciones (+6 h)
          </span>
        </div>
      </div>

      {/* Gráfica de serie temporal + predicción recursiva */}
      <div className="my-4 h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={serie_grafica} margin={{ top: 14, right: 14, left: -14, bottom: 0 }}>
            <defs>
              <linearGradient id={`banda-${conf.clave}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgb(255 255 255 / .06)" vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => new Date(v).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
              stroke="#9fb5aa"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              minTickGap={36}
            />
            <YAxis
              domain={[domMin, domMax]}
              stroke="#9fb5aa"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={46}
              tickFormatter={(v) => fmtVal(v, conf.decimales === 0 ? 0 : 1)}
            />
            <Tooltip
              content={<TooltipPrediccion unidad={conf.unidad} decimales={conf.decimales} />}
              cursor={{ stroke: 'rgb(255 255 255 / .18)' }}
            />
            {ultima_lectura_ts && (
              <ReferenceLine
                x={ultima_lectura_ts}
                stroke="#9fb5aa"
                strokeDasharray="3 3"
                strokeOpacity={0.6}
                label={{
                  value: 'última lectura',
                  position: 'insideTopRight',
                  fill: '#9fb5aa',
                  fontSize: 10,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="banda_max"
              stroke="none"
              fill={`url(#banda-${conf.clave})`}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="entrenamiento"
              name="Entrenamiento"
              stroke="#38bdf8"
              strokeWidth={2.2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="prueba"
              name="Prueba"
              stroke="#fb923c"
              strokeWidth={2.2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="prediccion"
              name="Predicciones"
              stroke="#34d399"
              strokeWidth={2.4}
              dot={(props) => {
                const { cx, cy, payload } = props;
                if (payload?.ts === ultima_lectura_ts && cx && cy) {
                  return (
                    <circle
                      key={`dot-${payload.ts}`}
                      cx={cx}
                      cy={cy}
                      r={4.5}
                      fill="#34d399"
                      stroke="#050d0a"
                      strokeWidth={1.5}
                    />
                  );
                }
                return null;
              }}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Pie de tarjeta con métricas de la ventana */}
      <p className="border-t border-white/8 pt-3 text-xs text-niebla">
        <span className="font-mono text-tinta">{muestras_ventana}</span> lecturas reales en la ventana ·{' '}
        R² <span className="font-mono text-tinta">{fmtVal(r2, 2)}</span> ·{' '}
        RMSE <span className="font-mono text-tinta">{fmtVal(rmse, conf.decimales)} {conf.unidad}</span> ·{' '}
        tendencia <span className="font-mono text-tinta">{signo}{fmtVal(tendencia_hora, conf.decimales === 0 ? 1 : 2)} {conf.unidad}/h</span>
      </p>
    </article>
  );
}

export default function VistaPrediccion({ plantaId, tick }) {
  const [modeloVivo, setModeloVivo] = useState(null);
  const [prediccionesDb, setPrediccionesDb] = useState([]);
  const [cargando, setCargando] = useState(true);

  const cargarDatos = () => {
    if (!plantaId) return;
    setCargando(true);

    Promise.all([
      getPrediccion(plantaId, 24).catch(() => null),
      getPrediccionesGuardadas(plantaId).catch(() => []),
    ])
      .then(([vivo, desdeDb]) => {
        setModeloVivo(vivo);
        setPrediccionesDb(desdeDb || []);
      })
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    cargarDatos();
  }, [plantaId, tick]);

  const tablaDias = prediccionesDb.length > 0
    ? prediccionesDb
    : (modeloVivo?.predicciones_diarias || []);

  const esCritico = modeloVivo?.horas_hasta_riego !== null &&
    modeloVivo?.horas_hasta_riego !== undefined &&
    modeloVivo.horas_hasta_riego <= 6;

  const modelosVars = modeloVivo?.modelos_variables || {};

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
                Modelo Predictivo & Pronóstico Multivariable
              </h2>
              <p className="text-xs text-niebla">
                Interpolación 1D, validación Train/Test y pronóstico recursivo sobre lecturas reales del DWH (<code className="font-mono text-[11px] text-cielo">lectura_limpia</code>)
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-2 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3.5 py-2 text-xs font-medium text-sky-400">
            <Send size={14} />
            Alertas automáticas a Telegram activas ✈️
          </span>

          <button
            onClick={cargarDatos}
            disabled={cargando}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-tinta transition hover:bg-white/10 disabled:opacity-50"
            title="Refrescar predicciones"
          >
            <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

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
                El aviso automático ya fue despachado a Telegram por el ETL.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tarjetas resumen del modelo hídrico */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="panel p-5">
          <div className="flex items-center justify-between text-niebla">
            <span className="text-xs uppercase tracking-wider">Humedad Suelo Actual</span>
            <Droplets size={16} className="text-cielo" />
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-tinta">
            {modeloVivo?.humedad_actual ?? '--'}%
          </p>
          <span className="mt-1 block text-[11px] text-niebla">
            Umbral crítico: 30.0% · Ideal: 40–70%
          </span>
        </div>

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
              ? `Est.: ${new Date(modeloVivo.fecha_estimada_riego).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
              : 'Reserva hídrica suficiente'}
          </span>
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between text-niebla">
            <span className="text-xs uppercase tracking-wider">Calibración OLS / Recursiva</span>
            <Database size={16} className="text-brote" />
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-tinta">
            R² {modeloVivo?.metricas_modelo?.r2 ?? '--'}
          </p>
          <span className="mt-1 block text-[11px] text-niebla">
            {modeloVivo?.muestras_reales
              ? `${modeloVivo.muestras_reales} lecturas post-riego · RMSE ${modeloVivo?.metricas_modelo?.rmse ?? '--'}%`
              : 'Tabla prediccion_diaria'}
          </span>
        </div>
      </div>

      {/* Gráficas de Predicción Multivariable (Humedad del Suelo, Temperatura, Luminosidad, Humedad del Aire) */}
      <section className="space-y-4" aria-label="Gráficas de predicción por variable">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {CONFIG_VARIABLES.map((conf) => (
            <TarjetaGraficaPrediccion
              key={conf.clave}
              conf={conf}
              modeloVar={modelosVars[conf.clave]}
            />
          ))}
        </div>
      </section>

      {/* Tabla de Predicciones Multi-Día desde PostgreSQL */}
      <section className="panel overflow-hidden" aria-labelledby="titulo-tabla-prediccion">
        <div className="border-b border-white/8 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="titulo-tabla-prediccion" className="text-base font-semibold text-tinta flex items-center gap-2">
                <Calendar size={18} className="text-cielo" />
                Pronóstico Hídrico de Siguientes Días (Tabla PostgreSQL: prediccion_diaria)
              </h3>
              <p className="text-xs text-niebla">
                Curva de agotamiento FAO-56 calculada por el ETL y persistida en la base de datos
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
    </div>
  );
}
