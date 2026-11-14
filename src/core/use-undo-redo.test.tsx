import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUndoRedo } from '@/core/use-undo-redo';

describe('useUndoRedo', () => {
  it('restores and reapplies immutable values', () => {
    const { result } = renderHook(() => useUndoRedo({ values: [1] }));
    act(() => result.current.set((state) => ({ values: [...state.values, 2] })));
    act(() => result.current.undo());
    expect(result.current.value).toEqual({ values: [1] });
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.value).toEqual({ values: [1, 2] });
  });
});
