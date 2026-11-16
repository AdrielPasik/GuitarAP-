/**
 * Deterministic fret entry. No timers: the result of a key never depends on how fast
 * it was typed.
 *
 * - A first digit that cannot start a longer valid fret (0, 3-9 for a 24-fret neck) is
 *   committed immediately.
 * - A first digit that can (1 or 2) stays pending until a second digit, Enter, Tab,
 *   Space or navigation confirms it.
 * - A second digit that would exceed the maximum is rejected: it never leaks into
 *   another cell or replaces the pending value.
 */
export type DigitResult =
  | { kind: 'value'; value: number; pending: boolean }
  | { kind: 'rejected' };

export function canExtend(value: number, maxFret: number) {
  return value > 0 && value * 10 <= maxFret;
}

export function enterDigit(pending: number | null, digit: number, maxFret = 24): DigitResult {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return { kind: 'rejected' };
  if (pending === null) {
    if (digit > maxFret) return { kind: 'rejected' };
    return { kind: 'value', value: digit, pending: canExtend(digit, maxFret) };
  }
  const value = pending * 10 + digit;
  return value <= maxFret ? { kind: 'value', value, pending: false } : { kind: 'rejected' };
}
