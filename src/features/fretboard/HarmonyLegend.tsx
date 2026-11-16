import type { Role } from '@/core/harmony';
import { ROLE_INFO, ROLES } from '@/core/harmony';

/**
 * Compact legend of the harmonic functions present in a map. Each item is also a filter:
 * pressing it keeps that function in full color and softens the rest (purely visual).
 */
export function HarmonyLegend({
  present,
  emphasis,
  onChange,
  labelFor,
}: {
  present: Role[];
  emphasis: Role[] | undefined;
  onChange: (roles: Role[] | undefined) => void;
  /** Label shown in the swatch, e.g. "3" or "♭3", taken from the map itself. */
  labelFor: (role: Role) => string;
}) {
  const shown = ROLES.filter((role) => present.includes(role));
  if (!shown.length) return null;
  function toggle(role: Role) {
    // Nothing emphasized yet: pressing a degree isolates it. Afterwards it adds or removes degrees.
    if (!emphasis) {
      onChange([role]);
      return;
    }
    const next = emphasis.includes(role) ? emphasis.filter((item) => item !== role) : [...emphasis, role];
    // Nothing selected or everything selected both mean "show all in color".
    onChange(next.length === 0 || shown.every((item) => next.includes(item)) ? undefined : next);
  }
  return (
    <ul className="harmony-legend" aria-label="Leyenda armónica: tocá un grado para resaltarlo">
      {shown.map((role) => {
        const on = !emphasis || emphasis.includes(role);
        return (
          <li key={role}>
            <button
              type="button"
              aria-pressed={Boolean(emphasis) && on}
              className={`legend-item${emphasis && !on ? ' off' : ''}`}
              title={`${ROLE_INFO[role].name}: ${ROLE_INFO[role].description}`}
              onClick={() => toggle(role)}
            >
              <i className={`legend-dot role-${role}`} aria-hidden="true">
                {labelFor(role)}
              </i>
              {ROLE_INFO[role].name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
