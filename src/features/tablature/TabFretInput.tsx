import type { TablatureContent } from '@/core/model';

type Cell = { column: number; string: number };

const landmarkFrets = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);

export function TabFretInput({
  content,
  selected,
  visibleFrets,
  autoAdvance,
  onVisibleFretsChange,
  onAutoAdvanceChange,
  onSelectColumn,
  onInput,
}: {
  content: TablatureContent;
  selected: Cell;
  visibleFrets: number;
  autoAdvance: boolean;
  onVisibleFretsChange: (value: number) => void;
  onAutoAdvanceChange: (value: boolean) => void;
  onSelectColumn: (column: number) => void;
  onInput: (string: number, fret: number) => void;
}) {
  const activeColumn = content.columns[selected.column];
  const frets = Array.from({ length: visibleFrets + 1 }, (_, fret) => fret);

  return (
    <section className="fret-input-panel" aria-label="Entrada visual por mástil">
      <div className="fret-input-heading">
        <div>
          <p className="eyebrow">Entrada sobre el instrumento</p>
          <h2>Mástil interactivo</h2>
          <p>
            Columna {selected.column + 1}: elegí una cuerda y un traste para escribir la nota en la
            tablatura.
          </p>
        </div>
        <div className="fret-input-options">
          <label>
            Trastes visibles
            <select
              aria-label="Trastes visibles"
              value={visibleFrets}
              onChange={(event) => onVisibleFretsChange(Number(event.target.value))}
            >
              {[5, 12, 15, 24].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="fret-auto-advance">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(event) => onAutoAdvanceChange(event.target.checked)}
            />
            Avanzar una columna tras cada nota
          </label>
        </div>
      </div>

      <div className="tab-position-strip" aria-label="Línea de tiempo de la tablatura">
        {content.columns.map((column, index) => {
          const noteCount = column.cells.filter((cell) => cell.fret !== undefined).length;
          return (
            <button
              key={column.id}
              className={index === selected.column ? 'active' : ''}
              aria-label={`Seleccionar columna ${index + 1}`}
              aria-pressed={index === selected.column}
              onClick={() => onSelectColumn(index)}
            >
              <span>{index + 1}</span>
              <i aria-hidden="true">{noteCount ? `${noteCount}n` : '·'}</i>
            </button>
          );
        })}
      </div>

      <div className="tab-fretboard-scroll">
        <div
          className="tab-fretboard"
          style={{ gridTemplateColumns: `4.4rem repeat(${visibleFrets}, minmax(3.35rem, 1fr))` }}
        >
          {frets.map((fret) => (
            <div
              key={`number-${fret}`}
              className={`fret-number ${fret === 0 ? 'open-string-label' : ''}`}
            >
              <span>{fret}</span>
              {fret > 0 && landmarkFrets.has(fret) ? (
                <i className={fret === 12 || fret === 24 ? 'double' : ''} aria-hidden="true" />
              ) : null}
            </div>
          ))}
          {content.tuning.map((tuning, stringIndex) =>
            frets.map((fret) => {
              const entered = activeColumn?.cells[stringIndex]?.fret === fret;
              const selectedPosition = entered && selected.string === stringIndex;
              return (
                <button
                  key={`${stringIndex}-${fret}`}
                  type="button"
                  data-testid={`tab-fret-${stringIndex}-${fret}`}
                  className={`fret-position ${fret === 0 ? 'open' : ''} ${entered ? 'entered' : ''} ${selectedPosition ? 'selected' : ''}`}
                  aria-label={`Cuerda ${6 - stringIndex} (${tuning.replace(/[0-9]/g, '')}), traste ${fret}, columna ${selected.column + 1}`}
                  aria-pressed={entered}
                  onClick={() => onInput(stringIndex, fret)}
                >
                  {fret === 0 ? (
                    <span className="string-name">{tuning.replace(/[0-9]/g, '')}</span>
                  ) : null}
                  {entered ? (
                    <strong>{fret}</strong>
                  ) : (
                    <span className="hit-zone" aria-hidden="true" />
                  )}
                </button>
              );
            }),
          )}
        </div>
      </div>
      <p className="fret-input-hint">
        La cejuela separa las cuerdas al aire del mástil. Los puntos marcan los trastes 3, 5, 7, 9 y
        sus equivalentes; el doble punto identifica 12 y 24.
      </p>
    </section>
  );
}
