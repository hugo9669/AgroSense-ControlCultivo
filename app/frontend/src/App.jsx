import { Component, useEffect, useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import { getToken, clearSesion, onUnauthorized } from './api';

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-noche-950 p-6 text-center">
        <p className="font-semibold text-tinta">Ocurrió un error inesperado en la pantalla.</p>
        <button onClick={() => window.location.reload()}
          className="rounded-xl bg-brote px-5 py-2.5 font-semibold text-noche-950 hover:brightness-110">Recargar</button>
      </div>
    );
  }
}

export default function App() {
  const [autenticado, setAutenticado] = useState(() => !!getToken());
  const salir = () => { clearSesion(); setAutenticado(false); };

  // Token vencido o invalido: la API responde 401 y se vuelve al login
  useEffect(() => onUnauthorized(() => { clearSesion(); setAutenticado(false); }), []);

  return (
    <ErrorBoundary>
      {autenticado ? <Dashboard onLogout={salir} /> : <Login onLogin={() => setAutenticado(true)} />}
    </ErrorBoundary>
  );
}
