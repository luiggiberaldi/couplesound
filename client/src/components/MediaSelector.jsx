import { useEffect, useMemo, useRef, useState } from 'react';
import { FileVideo, Link2, Music, Video } from 'lucide-react';
import { extractYouTubeId } from '../lib/playerAdapter';

const DEMOS = [
  {
    id: 'blazes',
    title: 'Demo · For Bigger Blazes',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
  },
  {
    id: 'escapes',
    title: 'Demo · For Bigger Escapes',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4'
  },
  {
    id: 'audio',
    title: 'Demo · Canción de prueba',
    src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
  }
];

const TABS = [
  { id: 'url', label: 'URL directa', icon: Link2 },
  { id: 'youtube', label: 'YouTube', icon: Video },
  { id: 'file', label: 'Archivo local', icon: FileVideo }
];

function normalizeName(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .trim();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function readDuration(file) {
  return new Promise((resolve) => {
    const element = document.createElement(file.type?.startsWith('audio/') ? 'audio' : 'video');
    element.preload = 'metadata';
    element.src = URL.createObjectURL(file);
    const finish = (duration) => {
      URL.revokeObjectURL(element.src);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    };
    element.onloadedmetadata = () => finish(element.duration);
    element.onerror = () => finish(0);
  });
}

function compareWithRoom(fileMeta, roomMedia) {
  const issues = [];
  if (!fileMeta || !roomMedia?.mirror) return issues;

  if (normalizeName(fileMeta.name) !== normalizeName(roomMedia.mirror.name)) {
    issues.push(`Nombre distinto: “${normalizeName(fileMeta.name)}” frente a “${normalizeName(roomMedia.mirror.name)}”.`);
  }
  const roomSize = Number(roomMedia.mirror.size) || 0;
  if (roomSize > 0 && Math.abs(fileMeta.size - roomSize) / roomSize > 0.02) {
    issues.push(`Tamaño distinto: ${formatBytes(fileMeta.size)} frente a ${formatBytes(roomSize)}.`);
  }
  const roomDuration = Number(roomMedia.duration) || 0;
  if (roomDuration > 0 && Math.abs((fileMeta.duration || 0) - roomDuration) > 1) {
    issues.push(`Duración distinta: ${formatClock(fileMeta.duration)} frente a ${formatClock(roomDuration)}.`);
  }
  return issues;
}

export default function MediaSelector({ room, canControl, onSelectMedia, localFile, onLocalFile, highlightFile }) {
  const [tab, setTab] = useState(highlightFile ? 'file' : 'url');
  const [url, setUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [fileMeta, setFileMeta] = useState(null);
  const [problems, setProblems] = useState([]);
  const [hint, setHint] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (highlightFile) setTab('file');
  }, [highlightFile]);

  const roomIsFile = room.media?.kind === 'file';

  const issues = useMemo(
    () => (roomIsFile ? compareWithRoom(fileMeta, room.media) : []),
    [fileMeta, roomIsFile, room.media]
  );

  const submitUrl = (source, title) => {
    if (!/^https?:\/\//i.test(source)) {
      setHint('La URL tiene que empezar por http:// o https://');
      return;
    }
    setHint('');
    onSelectMedia({ kind: 'url', src: source, title: title || source.split('/').pop() || 'Video', duration: 0 });
  };

  const submitYouTube = () => {
    const videoId = extractYouTubeId(youtubeUrl);
    if (!videoId) {
      setHint('No se reconoce un videoId de YouTube en ese enlace.');
      return;
    }
    setHint('');
    onSelectMedia({ kind: 'youtube', src: videoId, title: 'YouTube', duration: 0 });
  };

  const handleFile = async (file) => {
    if (!file) return;
    setHint('');
    onLocalFile(file);
    const duration = await readDuration(file);
    setFileMeta({ name: file.name, size: file.size, type: file.type || '', duration });
  };

  const publishFile = () => {
    if (!fileMeta) {
      setHint('Elige tu archivo primero.');
      return;
    }
    if (issues.length > 0) {
      setProblems(issues);
      return;
    }
    setProblems([]);
    onSelectMedia({
      kind: 'file',
      src: null,
      title: fileMeta.name,
      duration: fileMeta.duration,
      mirror: { name: fileMeta.name, size: fileMeta.size }
    });
  };

  return (
    <section className="glass rounded-3xl p-4">
      <div className="mb-4 flex gap-1 rounded-xl bg-slate-900/70 p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
              tab === id ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'url' && (
        <div className="space-y-3">
          <input
            className="field"
            placeholder="https://…/video.mp4"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            inputMode="url"
          />
          <button type="button" className="btn-primary w-full" onClick={() => submitUrl(url.trim())} disabled={!canControl}>
            Usar esta URL
          </button>
          <div className="space-y-2">
            {DEMOS.map((demo) => (
              <button
                key={demo.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-xl border border-white/5 bg-slate-900/50 px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5"
                onClick={() => submitUrl(demo.src, demo.title)}
                disabled={!canControl}
              >
                {demo.id === 'audio' ? (
                  <Music className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                ) : (
                  <Video className="h-4 w-4 text-violet-300" aria-hidden="true" />
                )}
                {demo.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'youtube' && (
        <div className="space-y-3">
          <input
            className="field"
            placeholder="https://youtube.com/watch?v=…"
            value={youtubeUrl}
            onChange={(event) => setYoutubeUrl(event.target.value)}
            inputMode="url"
          />
          <button type="button" className="btn-primary w-full" onClick={submitYouTube} disabled={!canControl}>
            Usar este video
          </button>
          <p className="text-[11px] leading-relaxed text-slate-500">
            YouTube sincroniza de forma aproximada (±300 ms): la API del reproductor no permite cambiar la velocidad ni
            la posición con precisión de milisegundos.
          </p>
        </div>
      )}

      {tab === 'file' && (
        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          <button type="button" className="btn-secondary w-full" onClick={() => fileInputRef.current?.click()}>
            <FileVideo className="h-4 w-4" aria-hidden="true" />
            {fileMeta ? 'Cambiar archivo' : 'Elegir mi archivo'}
          </button>

          {fileMeta && (
            <div className="rounded-xl bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
              <p className="truncate font-semibold">{fileMeta.name}</p>
              <p className="text-slate-500">
                {formatBytes(fileMeta.size)} · {formatClock(fileMeta.duration)}
              </p>
            </div>
          )}

          {roomIsFile && fileMeta && (
            <div className="rounded-xl bg-slate-900/60 px-3 py-2 text-xs">
              <p className="font-semibold text-slate-200">Archivo de la sala</p>
              <p className="truncate text-slate-400">{room.media.mirror?.name}</p>
              <p className="text-slate-500">
                {formatBytes(room.media.mirror?.size)} · {formatClock(room.media.duration)}
              </p>
              {issues.length === 0 ? (
                <p className="mt-2 text-emerald-300">Coincide: puedes sincronizar.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-amber-200">
                  {issues.map((issue) => (
                    <li key={issue}>· {issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!roomIsFile && (
            <button type="button" className="btn-primary w-full" onClick={publishFile} disabled={!canControl}>
              Publicar este archivo en la sala
            </button>
          )}

          {problems.length > 0 && (
            <p className="text-xs text-rose-300">
              No se puede sincronizar: el archivo no es el mismo que el de la sala.
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            El archivo no se sube a ningún sitio: cada dispositivo lo elige en local y solo se comparte su nombre,
            tamaño y duración para comprobar que es el mismo.
          </p>
        </div>
      )}

      {hint && <p className="mt-3 text-xs text-amber-200">{hint}</p>}
    </section>
  );
}
