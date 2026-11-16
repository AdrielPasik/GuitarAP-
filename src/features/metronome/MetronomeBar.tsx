import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { useMetronome } from '@/features/metronome/metronome-context';

function Beats({ className = '' }: { className?: string }) {
  const metro = useMetronome();
  return (
    <span
      className={`beats ${className}`}
      role="img"
      aria-label={`Pulso ${metro.beat + 1} de ${metro.beatsPerMeasure}`}
    >
      {Array.from({ length: metro.beatsPerMeasure }, (_, index) => (
        <i key={index} className={`${index === 0 ? 'accent ' : ''}${metro.running && metro.beat === index ? 'on' : ''}`} />
      ))}
    </span>
  );
}

function Stepper({ large = false }: { large?: boolean }) {
  const metro = useMetronome();
  return (
    <span className={`bpm-stepper${large ? ' large' : ''}`}>
      <button type="button" className="icon-btn" aria-label="Bajar BPM" onClick={() => metro.setBpm(metro.bpm - 1)}>
        <Icon name="minus" size={14} />
      </button>
      <input
        aria-label="BPM"
        type="number"
        inputMode="numeric"
        min={30}
        max={280}
        value={metro.bpm}
        onChange={(event) => metro.setBpm(Number(event.target.value))}
      />
      <span className="bpm-unit" aria-hidden="true">
        BPM
      </span>
      <button type="button" className="icon-btn" aria-label="Subir BPM" onClick={() => metro.setBpm(metro.bpm + 1)}>
        <Icon name="plus" size={14} />
      </button>
    </span>
  );
}

/** Compact global metronome. The audio engine lives in MetronomeProvider and never stops on navigation. */
export function MetronomeBar() {
  const metro = useMetronome();
  return (
    <div className="metronome" role="group" aria-label="Metrónomo">
      <button
        type="button"
        className={`play-btn${metro.running ? ' on' : ''}`}
        aria-label={metro.running ? 'Detener metrónomo' : 'Iniciar metrónomo'}
        aria-pressed={metro.running}
        onClick={metro.toggle}
      >
        <Icon name={metro.running ? 'stop' : 'play'} size={14} />
      </button>
      <Stepper />
      <Beats className="hide-narrow" />
      <Popover
        label="Ajustes del metrónomo"
        align="end"
        triggerClassName="icon-btn"
        trigger={<Icon name="chevron-down" size={14} />}
      >
        {() => (
          <div className="metro-panel">
            <button type="button" className="btn" onClick={metro.tap}>
              Marcar tempo (Tap)
            </button>
            <label className="field inline">
              <span>Compás</span>
              <select
                aria-label="Acento cada"
                value={metro.beatsPerMeasure}
                onChange={(event) => metro.setBeatsPerMeasure(Number(event.target.value))}
              >
                {[2, 3, 4, 5, 6, 7, 8, 12].map((beats) => (
                  <option key={beats} value={beats}>
                    {beats}/4
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline">
              <span>Volumen</span>
              <input
                aria-label="Volumen del metrónomo"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={metro.volume}
                onChange={(event) => metro.setVolume(Number(event.target.value))}
              />
            </label>
          </div>
        )}
      </Popover>
    </div>
  );
}

/** Slim strip for focus mode: nothing floats over the music, the music area leaves room for it. */
export function MetronomeStrip() {
  const metro = useMetronome();
  return (
    <div className="metronome-strip" role="group" aria-label="Metrónomo">
      <button
        type="button"
        className={`play-btn${metro.running ? ' on' : ''}`}
        aria-label={metro.running ? 'Detener metrónomo' : 'Iniciar metrónomo'}
        aria-pressed={metro.running}
        onClick={metro.toggle}
      >
        <Icon name={metro.running ? 'stop' : 'play'} size={14} />
      </button>
      <Stepper large />
      <Beats />
      <button type="button" className="btn btn-ghost" onClick={metro.tap}>
        Tap
      </button>
    </div>
  );
}
