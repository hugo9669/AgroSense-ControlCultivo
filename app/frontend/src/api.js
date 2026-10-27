import axios from 'axios';

const TOKEN_KEY = 'agro_tok';
const USER_KEY = 'agro_user';

export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const getUsuario = () => sessionStorage.getItem(USER_KEY) ?? 'admin';
export const setSesion = (token, usuario) => {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, usuario);
};
export const clearSesion = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
};

// Mismo origen: nginx hace proxy de /api hacia el servicio api (en desarrollo lo hace vite)
const http = axios.create({ baseURL: '/api', timeout: 15000 });

http.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export const login = (usuario, password) =>
  http.post('/login', { usuario, password }).then((r) => r.data);

export const getEstado = () => http.get('/estado').then((r) => r.data);
export const getPlantas = () => http.get('/plantas').then((r) => r.data);
export const getLecturas = (pid, limit = 60) =>
  http.get(`/plantas/${encodeURIComponent(pid)}/lecturas`, { params: { limit } }).then((r) => r.data);
export const getHistorial = (pid, horas = 24) =>
  http.get(`/plantas/${encodeURIComponent(pid)}/historial`, { params: { horas } }).then((r) => r.data);
export const getDiario = (pid, dias = 30) =>
  http.get(`/plantas/${encodeURIComponent(pid)}/diario`, { params: { dias } }).then((r) => r.data);
export const getAlertas = (limit = 50, planta) =>
  http.get('/alertas', { params: { limit, planta } }).then((r) => r.data);
export const getResumenAlertas = (planta) =>
  http.get('/alertas/resumen', { params: { planta } }).then((r) => r.data);

// Modelo predictivo agronómico (basado 100% en lecturas reales)
export const getPrediccion = (pid, horasFuturo = 12) =>
  http.get(`/plantas/${encodeURIComponent(pid)}/prediccion`, { params: { horas_futuro: horasFuturo } }).then((r) => r.data);

// Consulta a la tabla 'prediccion_diaria' en PostgreSQL con los pronósticos calculados de siguientes días
export const getPrediccionesGuardadas = (pid) =>
  http.get(`/plantas/${encodeURIComponent(pid)}/predicciones-guardadas`).then((r) => r.data);

// Envío directo de alerta o notificación a Telegram
export const enviarTelegramDirecto = (texto, chat_id = '') =>
  http.post('/notificaciones/telegram', { texto, chat_id }).then((r) => r.data);

// Helper para construir la URL del WebSocket hacia la API
export const getWsUrl = () => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/ws`;
};

export const chat = (pregunta, planta, historial = []) =>
  http.post('/chat', { pregunta, planta, historial }, { timeout: 90000 })
    .then((r) => String(r.data?.respuesta ?? ''));

// Mensaje legible para errores del chat (se conservan los casos del front original)
export const errorChat = (err) => {
  const st = err.response?.status;
  if (st === 503) return 'La IA no está configurada (falta GEMINI_API_KEY) o la base de datos no está disponible.';
  if (st === 401) return 'La sesión venció. Inicie sesión de nuevo.';
  if (st === 422) return 'La pregunta no es válida (¿demasiado larga?).';
  if (st === 502 || st === 504) return `La IA (Gemini) falló: ${err.response?.data?.detail ?? 'sin detalle'}`;
  if (err.code === 'ECONNABORTED') return 'La IA tardó demasiado en responder. Intente de nuevo.';
  return 'No se pudo obtener respuesta de la IA. Intente de nuevo.';
};

// Cierra sesión cuando la API responde 401 (token vencido). Devuelve la función para quitar el interceptor.
export const onUnauthorized = (fn) => {
  const id = http.interceptors.response.use(
    (r) => r,
    (err) => {
      if (err.response?.status === 401 && !err.config?.url?.endsWith('/login')) fn();
      return Promise.reject(err);
    },
  );
  return () => http.interceptors.response.eject(id);
};
