import { useEffect, useRef } from 'react';
import { createYouTubePlayer } from '../lib/playerAdapter';

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!window.__swYouTubeApiPromise) {
    window.__swYouTubeApiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === 'function') previous();
        resolve(window.YT);
      };
      if (!document.getElementById('sw-youtube-api')) {
        const script = document.createElement('script');
        script.id = 'sw-youtube-api';
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.head.appendChild(script);
      }
    });
  }
  return window.__swYouTubeApiPromise;
}

export default function YouTubePlayer({ videoId, onPlayer, onEnded }) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current || !YT?.Player) return;
      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          controls: 0,
          disablekb: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            if (!cancelled) onPlayer?.(createYouTubePlayer(playerRef.current));
          },
          onStateChange: (event) => {
            if (!cancelled && event.data === YT.PlayerState?.ENDED) onEnded?.();
          }
        }
      });
    });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {
        // El iframe puede haberse ido ya con el desmontaje.
      }
      playerRef.current = null;
    };
  }, [videoId, onPlayer, onEnded]);

  return (
    <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
