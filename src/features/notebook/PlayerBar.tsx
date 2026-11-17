import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import type { BlockPlayer } from '@/audio/useBlockPlayer';

/**
 * Compact player shared by every playable block: one Play/Pause, Stop, tempo with its source, and a popover
 * for the rest (sound, loop, click). The sound is a synthesis made in the browser, and it says so.
 */
export function PlayerBar({
  player,
  label,
  onBpm,
  onInstrument,
  disabled,
  emptyHint,
}: {
  player: BlockPlayer;
  label: string;
  /** Called with a new tempo: the block stores it (its own BPM). Absent = the tempo is read-only here. */
  onBpm?: (bpm: number) => void;
  onInstrument?: (instrument: 'piano' | 'guitar') => void;
  disabled?: boolean;
  emptyHint?: string;
}) {
  const { state } = player;
  const playing = state === 'playing';
  // Typing a tempo is committed on Enter or when leaving the field, so "1" on the way to "120" is never applied.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() && Number.isFinite(Number(draft))) onBpm?.(Math.max(30, Math.min(280, Math.round(Number(draft)))));
    setDraft(null);
  };
  return (
    <div className="player-bar" role="group" aria-label={`Reproducción de ${label}`}>
      <button
        type="button"
        className={`play-btn${playing ? ' on' : ''}`}
        aria-label={playing ? `Pausar ${label}` : state === 'paused' ? `Continuar ${label}` : `Reproducir ${label}`}
        title={disabled ? emptyHint : undefined}
        disabled={disabled}
        onClick={player.toggle}
      >
        <Icon name={playing ? 'pause' : 'play'} size={14} />
      </button>
      <button type="button" className="icon-btn" aria-label={`Detener ${label}`} disabled={state === 'idle'} onClick={player.stop}>
        <Icon name="stop" size={14} />
      </button>
      <span className="bpm-stepper compact">
        <button type="button" className="icon-btn" aria-label={`Bajar BPM de ${label}`} disabled={!onBpm} onClick={() => onBpm?.(player.bpm - 2)}>
          <Icon name="minus" size={12} />
        </button>
        <input
          aria-label={`BPM de ${label}`}
          type="number"
          inputMode="numeric"
          min={30}
          max={280}
          readOnly={!onBpm}
          value={draft ?? player.bpm}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setDraft(null);
          }}
        />
        <span className="bpm-unit" aria-hidden="true">BPM</span>
        <button type="button" className="icon-btn" aria-label={`Subir BPM de ${label}`} disabled={!onBpm} onClick={() => onBpm?.(player.bpm + 2)}>
          <Icon name="plus" size={12} />
        </button>
      </span>
      <span className="muted small tempo-source" title="De dónde sale el tempo: el del bloque, el del cuaderno o el del metrónomo">
        tempo del {player.source}
      </span>
      <Popover label={`Sonido de ${label}`} align="end" triggerClassName="icon-btn" trigger={<Icon name="settings" size={14} />}>
        {() => (
          <div className="pop-stack">
            <Segmented<'piano' | 'guitar'>
              label="Instrumento"
              value={player.instrument}
              onChange={(value) => (onInstrument ? onInstrument(value) : player.prefs.setInstrument(value))}
              options={[
                { value: 'piano', label: 'Piano', title: 'Piano sintetizado en tu navegador' },
                { value: 'guitar', label: 'Guitarra', title: 'Cuerda pulsada sintetizada: una aproximación, no una guitarra real' },
              ]}
            />
            <p className="muted small">Son sonidos sintetizados en tu navegador, sin descargas: una aproximación para escuchar tus ideas.</p>
            <label className="check">
              <input type="checkbox" checked={player.prefs.loop} onChange={(event) => player.prefs.setLoop(event.target.checked)} /> Repetir
            </label>
            <label className="check">
              <input type="checkbox" checked={player.prefs.click} onChange={(event) => player.prefs.setClick(event.target.checked)} /> Clic de metrónomo al reproducir
            </label>
          </div>
        )}
      </Popover>
    </div>
  );
}
