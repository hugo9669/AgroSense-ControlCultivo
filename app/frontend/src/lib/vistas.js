import { LayoutDashboard, LineChart, BellRing, Bot } from 'lucide-react';

export const VISTAS = [
  { id: 'resumen', nombre: 'Resumen', icono: LayoutDashboard, descripcion: 'Estado actual de la planta' },
  { id: 'historial', nombre: 'Historial', icono: LineChart, descripcion: 'Tendencias procesadas por el ETL' },
  { id: 'alertas', nombre: 'Alertas', icono: BellRing, descripcion: 'Advertencias y errores del sistema' },
  { id: 'asistente', nombre: 'Asistente IA', icono: Bot, descripcion: 'Consultas al agrónomo virtual (Gemini)' },
];
