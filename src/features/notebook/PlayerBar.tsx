import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import type { BlockPlayer } from '@/audio/useBlockPlayer';
import { clampBpm, type TempoSource } from '@/audio/tempo';
import { useNotebookInfo } from '@/features/notebook/notebook-context';

const SOURCE_LABEL: Record<TempoSource, string> = {
  práctica: 'tempo de práctica',
  bloque: 'tempo propio',
  canción: 'tempo de la canción',
  preferencia: 'tempo predeterminado',
  sistema: 'tempo predeterminado',
};

/**
 * Compact player shared by every playable block: Play/Pause, Stop, tempo, and a popover for the rest.
 * The number is the tempo the block will play at and says where it comes from. Editing it sets a *practice*
 * tempo (temporary, never saved); the block's own tempo is an explicit exception chosen in the popover.
 */
export function PlayerBar({
  player,
  label,
  onBlockBpm,
  onInstrument,
  disabled,
  emptyHint,
}: {
  player: BlockPlayer;
  label: string;
  /** Sets (number) or clears (undefined) the block's own tempo. Absent = the block cannot be edited (reading). */
  onBlockBpm?: (bpm: number | undefined) => void;
  /** Saves the instrument in the block; `undefined` returns the block to the default for its kind. */
  onInstrument?: (instrument: 'piano' | 'guitar' | undefined) => void;
  disabled?: boolean;
  emptyHint?: string;
}) {
  const { state } = player;
  const info = useNotebookInfo();
  const playing = state === 'playing';
  // Typing a tempo is committed on Enter or when leaving the field, so "1" on the way to "120" is never applied.
  const [draft, setDraft] = useState<string | null>(null);
  const [ownDraft, setOwnDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() && Number.isFinite(Number(draft))) player.setPractice(clampBpm(Number(draft)));
    setDraft(null);
  };
  const practice = player.source === 'práctica';
  const hasOwn = player.blockBpm !== undefined;
  const songBpm = info.docBpm;
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
      <span className="instrument-pick" role="group" aria-label={`Instrumento de ${label}`}>
        {(['piano', 'guitar'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={player.instrument === id ? 'on' : ''}
            aria-pressed={player.instrument === id}
            title={`Escuchar con ${id === 'piano' ? 'piano' : 'guitarra'} (solo para probar: no cambia la canción)`}
            onClick={() => player.setTemporaryInstrument(id === player.savedInstrument.id ? undefined : id)}
          >
            {id === 'piano' ? 'Piano' : 'Guitarra'}
          </button>
        ))}
        {player.instrumentSource === 'temporary' && (
          <>
            <span className="instrument-note" role="status">probando</span>
            {onInstrument && (
              <button
                type="button"
                className="pin"
                title={`Fijar ${player.instrument === 'piano' ? 'piano' : 'guitarra'} en este bloque (se guarda en la canción)`}
                aria-label={`Fijar ${player.instrument === 'piano' ? 'piano' : 'guitarra'} en este bloque`}
                onClick={() => {
                  onInstrument(player.instrument);
                  player.setTemporaryInstrument(undefined);
                }}
              >
                Fijar
              </button>
            )}
          </>
        )}
      </span>
      <span className={`bpm-stepper compact${practice ? ' practice' : hasOwn ? ' own' : ''}`}>
        <button type="button" className="icon-btn" aria-label={`Bajar BPM de ${label}`} onClick={() => player.setPractice(player.bpm - 2)}>
          <Icon name="minus" size={12} />
        </button>
        <input
          aria-label={`BPM de ${label}`}
          type="number"
          inputMode="numeric"
          min={30}
          max={280}
          value={draft ?? player.bpm}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setDraft(null);
          }}
        />
        <span className="bpm-unit" aria-hidden="true">BPM</span>
        <button type="button" className="icon-btn" aria-label={`Subir BPM de ${label}`} onClick={() => player.setPractice(player.bpm + 2)}>
          <Icon name="plus" size={12} />
        </button>
      </span>
      <span className={`tempo-source ${player.source}`} title="De dónde sale el tempo: práctica (temporal), propio del bloque, de la canción o predeterminado">
        {SOURCE_LABEL[player.source]}
      </span>
      {practice && (
        <button
          type="button"
          className="btn btn-link"
          onClick={player.resetPractice}
          title="El tempo de práctica es temporal: la canción conserva el suyo"
        >
          Volver a {player.base.bpm} BPM
        </button>
      )}
      <Popover label={`Sonido y tempo de ${label}`} align="end" triggerClassName="icon-btn" trigger={<Icon name="settings" size={14} />}>
        {(close) => (
          <div className="pop-stack">
            {onBlockBpm && (
              <fieldset className="tempo-choice">
                <legend>Tempo de este bloque</legend>
                <label className="check">
                  <input
                    type="radio"
                    name={`tempo-${label}`}
                    checked={!hasOwn}
                    onChange={() => {
                      onBlockBpm(undefined);
                      setOwnDraft(null);
                    }}
                  />
                  <span>Usar BPM de la canción{songBpm ? ` (${songBpm})` : ''}</span>
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name={`tempo-${label}`}
                    checked={hasOwn}
                    onChange={() => onBlockBpm(clampBpm(songBpm ?? player.base.bpm))}
                  />
                  <span>BPM propio</span>
                </label>
                {hasOwn && (
                  <input
                    type="number"
                    aria-label={`BPM propio de ${label}`}
                    min={30}
                    max={280}
                    value={ownDraft ?? player.blockBpm}
                    onChange={(event) => setOwnDraft(event.target.value)}
                    onBlur={() => {
                      if (ownDraft !== null && ownDraft.trim() && Number.isFinite(Number(ownDraft))) onBlockBpm(clampBpm(Number(ownDraft)));
                      setOwnDraft(null);
                    }}
                    onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                  />
                )}
                <p className="muted small">
                  {hasOwn ? 'Este bloque ignora los cambios de BPM de la canción hasta que vuelvas a «Usar BPM de la canción».' : 'Si cambiás el BPM de la canción, este bloque lo sigue.'}
                </p>
              </fieldset>
            )}
            <Segmented<'piano' | 'guitar'>
              label="Instrumento"
              value={player.savedInstrument.id}
              onChange={(value) => {
                player.setTemporaryInstrument(undefined);
                if (onInstrument) onInstrument(value);
                else player.prefs.setInstrumentFor(player.kind, value);
              }}
              options={[
                { value: 'piano', label: 'Piano', title: 'Piano sintetizado en tu navegador' },
                { value: 'guitar', label: 'Guitarra', title: 'Cuerda pulsada sintetizada: una aproximación, no una guitarra real' },
              ]}
            />
            {onInstrument && player.instrumentSource === 'block' && (
              <button type="button" className="btn btn-link" onClick={() => onInstrument(undefined)}>
                Volver al predeterminado ({player.kind === 'melody' ? 'melodías' : player.kind === 'tablature' ? 'tablaturas' : 'acordes'}: {player.prefs.instrumentFor(player.kind) === 'piano' ? 'piano' : 'guitarra'})
              </button>
            )}
            <p className="muted small">Son sonidos sintetizados en tu navegador, sin descargas: una aproximación para escuchar tus ideas.</p>
            <label className="check">
              <input type="checkbox" checked={player.prefs.loop} onChange={(event) => player.prefs.setLoop(event.target.checked)} /> Repetir
            </label>
            <label className="check">
              <input type="checkbox" checked={player.prefs.click} onChange={(event) => player.prefs.setClick(event.target.checked)} /> Clic de metrónomo al reproducir
            </label>
            <button type="button" className="btn" onClick={close}>Listo</button>
          </div>
        )}
      </Popover>
    </div>
  );
}
