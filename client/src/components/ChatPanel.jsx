import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { CHAT_MAX_LENGTH } from '../lib/constants';

export default function ChatPanel({ messages, onSend }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  const submit = async (event) => {
    event.preventDefault();
    const result = await onSend(text);
    if (result?.ok) {
      setText('');
      setNotice('');
      return;
    }
    if (result?.reason === 'espera') setNotice('Un mensaje cada 2 segundos. Espera un momento.');
  };

  return (
    <>
      <button
        type="button"
        className="btn-secondary fixed bottom-5 right-5 z-40 shadow-lg shadow-black/40"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X className="h-4 w-4" aria-hidden="true" /> : <MessageCircle className="h-4 w-4" aria-hidden="true" />}
        Chat
      </button>

      {open && (
        <section className="glass fixed bottom-20 right-5 z-40 flex h-[22rem] w-[min(22rem,calc(100vw-2.5rem))] flex-col rounded-3xl">
          <header className="border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-semibold">Chat de la sala</h2>
            <p className="text-xs text-slate-400">No se guarda: al recargar desaparece.</p>
          </header>

          <div ref={listRef} className="no-scrollbar flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="text-xs text-slate-400">Todavía no hay mensajes.</p>
            ) : (
              messages.map((message) => (
                <div key={message.id} className="text-sm">
                  <span className="text-xs font-semibold text-violet-200">{message.alias}</span>
                  <p className="break-words text-slate-200">{message.text}</p>
                </div>
              ))
            )}
          </div>

          <form onSubmit={submit} className="border-t border-white/10 p-3">
            {notice && <p className="mb-2 text-xs text-amber-200">{notice}</p>}
            <div className="flex gap-2">
              <input
                className="field py-2 text-sm"
                value={text}
                maxLength={CHAT_MAX_LENGTH}
                placeholder="Escribe un mensaje"
                onChange={(event) => setText(event.target.value)}
              />
              <button type="submit" className="btn-primary px-3" aria-label="Enviar mensaje" disabled={!text.trim()}>
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
