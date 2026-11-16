import { forwardRef } from 'react';
import { ROLE_INFO, ROLES } from '@/core/harmony';
import { FretboardCanvas } from '@/features/fretboard/FretboardCanvas';
import { legendLabel, markersForAll, markersForPosition, rolesPresent } from '@/features/fretboard/map-markers';
import { resolvedView, visibleRange } from '@/features/fretboard/operations';
import { TabBlock } from '@/features/tablature/TabBlock';
import type { ExportItem, ExportSettings } from '@/features/export/export-plan';

export const SHEET_WIDTH = 1000;

/**
 * The page that gets exported, drawn from the real musical content, not from the screen. It has no
 * buttons, menus or selection, and its colors come from the theme chosen for the export. Everything
 * marked `data-export-unit` is something a PDF page may break before but never through.
 */
export const ExportSheet = forwardRef<HTMLDivElement, { title: string; items: ExportItem[]; settings: ExportSettings }>(
  function ExportSheet({ title, items, settings }, ref) {
    return (
      <div
        ref={ref}
        className="export-sheet"
        data-theme={settings.theme}
        data-bg={settings.theme === 'dark' && settings.background === 'white' ? 'paper' : settings.background}
        style={{ width: SHEET_WIDTH }}
      >
        {settings.title && title.trim() && (
          <h1 className="ex-title" data-export-unit>
            {title}
          </h1>
        )}
        {items.map((item) => {
          if (item.kind === 'text' && item.text) {
            if (item.text.style === 'note' && !settings.notes) return null;
            return item.text.style === 'heading' ? (
              <h2 key={item.key} className="ex-heading" data-export-unit>
                {item.text.value}
              </h2>
            ) : (
              <p key={item.key} className="ex-note" data-export-unit>
                {item.text.value}
              </p>
            );
          }
          if (item.kind === 'tablature' && item.tab) {
            return (
              <section key={item.key} className="ex-item ex-tab">
                {item.caption && (
                  <h3 className="ex-caption" data-export-unit>
                    {item.caption}
                  </h3>
                )}
                <TabBlock blockId={`export-${item.key}`} content={item.tab} readOnly onChange={() => undefined} />
              </section>
            );
          }
          if (item.kind === 'map' && item.map) {
            const { content, position, positionIndex, complete } = item.map;
            const view = resolvedView(content);
            const range = visibleRange(content);
            const options = { show: view.labels, emphasis: view.emphasis, extensions: view.extensions };
            const markers = complete
              ? markersForAll(content, options)
              : position
                ? markersForPosition(content, position, positionIndex, options)
                : [];
            const present = rolesPresent(content, view.extensions);
            return (
              <section key={item.key} className="ex-item" data-export-unit>
                {item.caption && <h3 className="ex-caption">{item.caption}</h3>}
                <FretboardCanvas
                  tuning={content.tuning}
                  latin={content.latin}
                  from={range.from}
                  to={range.to}
                  markers={markers}
                  label={item.caption || 'Mástil'}
                  maxCell={70}
                  minCell={30}
                />
                {settings.legend && view.legend && present.length > 0 && (
                  <ul className="harmony-legend static" aria-hidden="true">
                    {ROLES.filter((role) => present.includes(role)).map((role) => (
                      <li key={role} className="legend-item">
                        <i className={`legend-dot role-${role}`}>{legendLabel(content, role, view.extensions)}</i>
                        {ROLE_INFO[role].name}
                      </li>
                    ))}
                  </ul>
                )}
                {settings.notes && position?.comments && <p className="ex-note small">{position.comments}</p>}
              </section>
            );
          }
          return null;
        })}
      </div>
    );
  },
);
