import { useEffect, useState } from 'react';
import { Sparkles, TrendingDown, TrendingUp, Minus, AlertCircle, Droplets, Clock, BarChart3, CheckCircle2 } from 'lucide-react';
import { getPrediccion } from '../api';

export default function CardPrediccion({ plantaId, tick, onVerDetalle }) {
  const [pred, setPred] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!plantaId) return;
    let vivo = true;
    setCargando(true);
    getPrediccion(plantaId, 12)
      .then((data) => {
        if (vivo) {
          setPred(data);
          setError(false);
        }
      })
      .catch(() => {
        if (vivo) setError(true);
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => { vivo = false; };
  }, [plantaId, tick]);

  if (!plantaId) return null;

  return (
    <section className="panel relative overflow-hidden p-6" aria-labelledby="titulo-prediccion">
      {/* Halo de fondo */}
      <div aria-hidden="true" className="absolute -left-20 -top-20 h-52 w-52 rounded-full bg-cielo/10 blur-3xl" />

      <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-white/8 pb-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-cielo/15 text-cielo">
            <Droplets size={18} aria-hidden="true" />
          </span>
          <div>
            <h3 id="titulo-prediccion" className="text-sm font-semibold tracking-wide">
              Modelo Predictivo Hídrico
            </h3>
            <p className="text-[11px] text-niebla">
              Regresión OLS entrenada con lecturas reales del DWH (cero datos inventados)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {pred?.disponible && (
            <span className="rounded-full bg-white/5 px-2.5 py-1 font-mono text-[11px] text-niebla ring-1 ring-white/10">
              R² = {pred.metricas_modelo?.r2 ?? '--'} (Confianza {pred.metricas_modelo?.confianza})
            </span>
          )}
          {onVerDetalle && (
            <button
              onClick={onVerDetalle}
              className="rounded-lg bg-cielo/15 px-2.5 py-1 text-[11px] font-semibold text-cielo hover:bg-cielo/25 transition"
            >
              Ver pantalla completa →
            </button>
          )}
        </div>
      </div>

      {cargando ? (
        <div className="py-8 text-center text-xs text-niebla">Calibrando modelo predictivo sobre lecturas reales…</div>
      ) : error || !pred ? (
        <div className="flex items-center gap-2 py-6 text-xs text-niebla">
          <AlertCircle size={16} className="text-niebla" />
          No se pudo consultar el modelo predictivo en este momento.
        </div>
      ) : !pred.disponible ? (
        <div className="my-4 rounded-xl border border-white/10 bg-white/[.02] p-4 text-xs text-niebla">
          <div className="flex items-center gap-2 font-medium text-tinta">
            <Clock size={15} className="text-cielo" />
            Estado del Modelo: En Espera de Muestras
          </div>
          <p className="mt-1.5 leading-relaxed">{pred.motivo}</p>
        </div>
      ) : (
        <div className="relative mt-4 space-y-4">
          {/* Métricas destacadas */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-white/6 bg-white/[.02] p-3">
              <span className="text-[10px] uppercase tracking-wider text-niebla">Humedad Actual</span>
              <p className="mt-0.5 font-mono text-xl font-bold text-tinta">{pred.humedad_actual}%</p>
            </div>

            <div className="rounded-xl border border-white/6 bg-white/[.02] p-3">
              <span className="text-[10px] uppercase tracking-wider text-niebla">Tasa de Variación</span>
              <p className="mt-0.5 flex items-center gap-1 font-mono text-xl font-bold text-tinta">
                {pred.tasa_cambio_por_hora < -0.05 ? (
                  <TrendingDown size={18} className="text-ambar" />
                ) : pred.tasa_cambio_por_hora > 0.05 ? (
                  <TrendingUp size={18} className="text-savia" />
                ) : (
                  <Minus size={18} className="text-niebla" />
                )}
                {pred.tasa_cambio_por_hora > 0 ? `+${pred.tasa_cambio_por_hora}` : pred.tasa_cambio_por_hora}%/h
              </p>
            </div>

            <div className="rounded-xl border border-white/6 bg-white/[.02] p-3">
              <span className="text-[10px] uppercase tracking-wider text-niebla">Próximo Riego En</span>
              <p className="mt-0.5 font-mono text-xl font-bold text-cielo">
                {pred.horas_hasta_riego != null ? (
                  pred.horas_hasta_riego === 0 ? '¡Ahora!' : `${pred.horas_hasta_riego} h`
                ) : (
                  'No urgente'
                )}
              </p>
            </div>

            <div className="rounded-xl border border-white/6 bg-white/[.02] p-3">
              <span className="text-[10px] uppercase tracking-wider text-niebla">Muestras Reales</span>
              <p className="mt-0.5 font-mono text-xl font-bold text-niebla">{pred.muestras_reales}</p>
            </div>
          </div>

          {/* Recomendación agronómica */}
          <div className={`rounded-xl border p-3.5 text-xs leading-relaxed ${
            pred.horas_hasta_riego != null && pred.horas_hasta_riego <= 4
              ? 'border-ambar/30 bg-ambar/10 text-ambar'
              : 'border-brote/30 bg-brote/10 text-savia'
          }`}>
            <span className="font-semibold uppercase tracking-wider text-[10px] block mb-1">
              Recomendación Agronómica Predictiva:
            </span>
            {pred.recomendacion_agronomica}
          </div>

          {/* Proyección horaria paso a paso */}
          {pred.proyecciones && pred.proyecciones.length > 0 && (
            <div>
              <span className="text-[11px] font-semibold text-niebla uppercase tracking-wider block mb-2">
                Proyección de Humedad (Próximas Horas)
              </span>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {pred.proyecciones.filter((_, i) => [0, 1, 2, 4, 7, 11].includes(i)).map((p) => (
                  <div key={p.horas_desde_ahora} className="rounded-lg border border-white/6 bg-white/[.01] p-2 text-center">
                    <span className="block text-[10px] text-niebla">+{p.horas_desde_ahora}h</span>
                    <span className="font-mono text-sm font-semibold text-tinta">
                      {p.humedad_suelo_estimada}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
