const EMOJIS = ['👏', '🔥', '😂', '❤️', '🎉'];

export default function Reactions({ reactions, onSend }) {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" aria-hidden="true">
        {reactions.map((reaction, index) => (
          <span
            key={reaction.id}
            className="animate-reaction absolute bottom-24 text-3xl"
            style={{ left: `${12 + ((index * 17) % 72)}%` }}
          >
            {reaction.emoji}
          </span>
        ))}
      </div>

      <section className="glass flex flex-wrap items-center gap-2 rounded-3xl px-3 py-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Reacciones</span>
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="rounded-xl px-2 py-1 text-xl transition hover:bg-white/10 active:scale-95"
            onClick={() => onSend(emoji)}
            aria-label={`Reaccionar con ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </section>
    </>
  );
}
