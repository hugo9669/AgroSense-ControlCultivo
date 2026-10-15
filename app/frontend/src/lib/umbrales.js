// Umbrales alineados con el ETL (app/etl/etl.py: VALID y WARN). Si cambias uno, cambia el otro.
import { Thermometer, Droplets, Sun, Sprout } from 'lucide-react';

export const VARIABLES = [
  {
    clave: 'temperature', nombre: 'Temperatura', corto: 'Temp. aire', unidad: '°C', decimales: 1,
    icono: Thermometer, color: '#fb923c', valido: [-10, 60], optimo: [10, 35], ideal: [15, 30],
    histAvg: 'temp_avg', histMin: 'temp_min', histMax: 'temp_max',
  },
  {
    clave: 'humidity', nombre: 'Humedad del aire', corto: 'Hum. aire', unidad: '%', decimales: 0,
    icono: Droplets, color: '#38bdf8', valido: [0, 100], optimo: [30, 90], ideal: [40, 80],
    histAvg: 'hum_avg',
  },
  {
    clave: 'luminosity', nombre: 'Luminosidad', corto: 'Luz', unidad: 'lx', decimales: 0,
    icono: Sun, color: '#facc15', valido: [0, 120000], optimo: [1000, 80000], ideal: [5000, 60000],
    histAvg: 'lux_avg',
  },
  {
    clave: 'soil_moisture', nombre: 'Humedad del suelo', corto: 'Hum. suelo', unidad: '%', decimales: 0,
    icono: Sprout, color: '#9be15d', valido: [0, 100], optimo: [20, 80], ideal: [40, 70],
    histAvg: 'soil_avg',
  },
];

export const VAR_POR_CLAVE = Object.fromEntries(VARIABLES.map((v) => [v.clave, v]));

export const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
export const fmt = (v, d = 0) => (v == null ? '--' : Number(v).toLocaleString('es-CO', {
  minimumFractionDigits: d, maximumFractionDigits: d,
}));

/** Estado de una variable: 'sin-dato' | 'bajo' | 'alto' | 'atencion' | 'ok' */
export function estadoVariable(def, valor) {
  if (valor == null) return 'sin-dato';
  if (valor < def.optimo[0]) return 'bajo';
  if (valor > def.optimo[1]) return 'alto';
  if (valor < def.ideal[0] || valor > def.ideal[1]) return 'atencion';
  return 'ok';
}

export const ESTADOS = {
  ok:         { texto: 'Óptimo',   clase: 'text-savia bg-savia/10 ring-savia/30' },
  atencion:   { texto: 'Atención', clase: 'text-ambar bg-ambar/10 ring-ambar/30' },
  bajo:       { texto: 'Bajo',     clase: 'text-coral bg-coral/10 ring-coral/30' },
  alto:       { texto: 'Alto',     clase: 'text-coral bg-coral/10 ring-coral/30' },
  'sin-dato': { texto: 'Sin dato', clase: 'text-niebla bg-white/5 ring-white/15' },
};

/**
 * Indice de salud 0-100. Solo penaliza lo que se conoce; un valor nulo (sensor con error)
 * resta poco porque no se sabe el estado real.
 */
export function calcularSalud(lectura) {
  if (!lectura) return null;
  let puntos = 100;
  const t = num(lectura.temperature);
  const h = num(lectura.humidity);
  const l = num(lectura.luminosity);
  const s = num(lectura.soil_moisture);

  if (t == null) puntos -= 8;
  else {
    if (t < 15 || t > 30) puntos -= 15;
    if (t < 10 || t > 35) puntos -= 20;
  }
  if (h == null) puntos -= 5;
  else if (h < 30 || h > 90) puntos -= 10;
  if (l == null) puntos -= 5;
  else if (l < 1000) puntos -= 15;
  if (s == null) puntos -= 10;
  else if (s < 40) puntos -= Math.min(45, (40 - s) * 1.5);
  else if (s > 85) puntos -= 15; // encharcamiento

  return Math.round(Math.max(0, Math.min(100, puntos)));
}

export function diagnosticoSalud(salud) {
  if (salud == null) return { texto: 'Sin lecturas', tono: 'niebla', detalle: 'Esperando datos del sensor' };
  if (salud >= 80) return { texto: 'Óptimo', tono: 'savia', detalle: 'La planta está en buenas condiciones' };
  if (salud >= 50) return { texto: 'En riesgo', tono: 'ambar', detalle: 'Hay variables fuera del rango ideal' };
  return { texto: 'Crítico', tono: 'coral', detalle: 'Requiere intervención inmediata' };
}

/** "hace 3 min" */
export function haceCuanto(fecha, ahora) {
  if (!fecha) return '—';
  const s = Math.max(0, Math.round((ahora - new Date(fecha).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export const fechaCorta = (f) => new Date(f).toLocaleString('es-CO', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});
export const horaCorta = (f) => new Date(f).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
