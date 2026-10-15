import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Loader2, User, Sparkles, Trash2 } from 'lucide-react';

const SUGERENCIAS = [
  '¿Debo regar la planta hoy?',
  'Resume el estado de la planta en 3 puntos',
  '¿Tiene suficiente luz?',
  'Explica las alertas recientes',
  '¿Cómo ha cambiado la temperatura en las últimas 24 h?',
];

/** Negritas **x** en una linea, sin innerHTML (seguro ante XSS) */
function enLinea(texto) {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith('**') && parte.endsWith('**')
      ? <strong key={i} className="font-semibold text-tinta">{parte.slice(2, -2)}</strong>
      : parte);
}

/** Markdown minimo para las respuestas de Gemini: parrafos, listas con - * o 1. y negritas */
function MiniMarkdown({ texto }) {
  const bloques = [];
  let lista = null;
  texto.split('\n').forEach((cruda, i) => {
    const linea = cruda.trim();
    const item = linea.match(/^([-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!lista) { lista = { ordenada: /\d/.test(item[1]), items: [] }; bloques.push(lista); }
      lista.items.push(item[2]);
      return;
    }
    lista = null;
    if (!linea) return;
    const titulo = linea.match(/^#{1,4}\s+(.*)$/);
    bloques.push(titulo ? { titulo: titulo[1], k: i } : { p: linea.replace(/^#+\s*/, ''), k: i });
  });
  return (
    <div className="space-y-2">
      {bloques.map((b, i) => {
        if (b.items) {
          const Tag = b.ordenada ? 'ol' : 'ul';
          return (
            <Tag key={i} className={`space-y-1 pl-5 ${b.ordenada ? 'list-decimal' : 'list-disc'} marker:text-brote`}>
              {b.items.map((it, j) => <li key={j}>{enLinea(it)}</li>)}
            </Tag>
          );
        }
        if (b.titulo) return <p key={i} className="font-semibold text-tinta">{enLinea(b.titulo)}</p>;
        return <p key={i}>{enLinea(b.p)}</p>;
      })}
    </div>
  );
}

export default function ChatPanel({ mensajes, enviando, onEnviar, onLimpiar, plantaId, iaActiva, compacto = false }) {
  const [texto, setTexto] = useState('');
  const finRef = useRef(null);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [mensajes, enviando]);

  const enviar = (t = texto) => {
    const pregunta = t.trim();
    if (!pregunta || enviando) return;
    setTexto('');
    onEnviar(pregunta);
  };

  return (
    <section className="panel flex h-full min-h-[420px] flex-col overflow-hidden" aria-label="Chat con el asistente IA">
      <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
        <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brote to-savia text-noche-950">
          <Bot size={20} aria-hidden="true" />
          <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-noche-900 ${iaActiva === false ? 'bg-coral' : 'bg-savia'}`} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">Agrónomo virtual</h3>
          <p className="text-xs text-niebla">
            {iaActiva === false ? 'IA sin configurar' : 'Gemini'} · contexto: <span className="font-mono">{plantaId ?? 'todas'}</span>
          </p>
        </div>
        {onLimpiar && mensajes.length > 1 && (
          <button onClick={onLimpiar} aria-label="Borrar conversación" title="Borrar conversación"
            className="ml-auto rounded-lg p-2 text-niebla transition hover:bg-white/5 hover:text-coral">
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className={`flex-1 space-y-4 overflow-y-auto px-5 py-5 ${compacto ? 'max-h-[340px]' : ''}`} aria-live="polite">
        {mensajes.map((m) => (
          <div key={m.id} className={`flex gap-3 ${m.rol === 'user' ? 'flex-row-reverse' : ''}`}>
            <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
              m.rol === 'user' ? 'bg-white/10 text-tinta' : 'bg-brote/15 text-brote'}`} aria-hidden="true">
              {m.rol === 'user' ? <User size={14} /> : <Sparkles size={14} />}
            </span>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              m.rol === 'user'
                ? 'rounded-tr-sm bg-brote text-noche-950 font-medium'
                : m.error
                  ? 'rounded-tl-sm border border-coral/30 bg-coral/10 text-coral'
                  : 'rounded-tl-sm border border-white/8 bg-white/[.04] text-tinta/90'}`}>
              <span className="sr-only">{m.rol === 'user' ? 'Usted:' : 'Asistente:'}</span>
              {m.rol === 'user' || m.error ? m.texto : <MiniMarkdown texto={m.texto} />}
            </div>
          </div>
        ))}
        {enviando && (
          <div className="flex gap-3">
            <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-brote/15 text-brote" aria-hidden="true"><Sparkles size={14} /></span>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-white/8 bg-white/[.04] px-4 py-3 text-sm text-niebla">
              <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Analizando datos del cultivo…
            </div>
          </div>
        )}
        <div ref={finRef} />
      </div>

      <div className="border-t border-white/8 p-4">
        {mensajes.length <= 1 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGERENCIAS.slice(0, compacto ? 3 : 5).map((s) => (
              <button key={s} onClick={() => enviar(s)} disabled={enviando}
                className="rounded-full border border-brote/25 bg-brote/5 px-3 py-1.5 text-xs font-medium text-brote transition hover:bg-brote/15">
                {s}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); enviar(); }}
          className="flex items-center gap-2 rounded-2xl border border-white/12 bg-noche-950/60 p-1.5 transition focus-within:border-brote focus-within:ring-4 focus-within:ring-brote/10">
          <label htmlFor="pregunta-ia" className="sr-only">Pregunta para el asistente</label>
          <input id="pregunta-ia" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1000}
            placeholder="Pregunta sobre riego, luz, alertas…" autoComplete="off"
            className="flex-1 bg-transparent px-3 py-2 text-sm text-tinta placeholder:text-niebla/70 focus:outline-none" />
          <button type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar pregunta"
            className="grid h-10 w-10 place-items-center rounded-xl bg-brote text-noche-950 transition hover:brightness-110 disabled:opacity-40">
            {enviando ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </form>
      </div>
    </section>
  );
}
