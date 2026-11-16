import type { LibraryNode } from '@/core/model';

/** "Covers / Pink Floyd" for a folder or song id; empty at the library root. */
export function pathOf(nodes: LibraryNode[], nodeId: string | null | undefined) {
  const names: string[] = [];
  let current = nodes.find((node) => node.id === nodeId);
  while (current && names.length < 12) {
    names.unshift(current.name);
    const parent: string | null = current.parentId;
    current = nodes.find((node) => node.id === parent);
  }
  return names.join(' / ');
}

/** Ancestors from the root down to (and including) the node. */
export function ancestry(nodes: LibraryNode[], nodeId: string | null) {
  const chain: LibraryNode[] = [];
  let current = nodes.find((node) => node.id === nodeId);
  while (current && chain.length < 12) {
    chain.unshift(current);
    const parent: string | null = current.parentId;
    current = nodes.find((node) => node.id === parent);
  }
  return chain;
}
