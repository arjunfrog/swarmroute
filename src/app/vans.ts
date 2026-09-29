/**
 * Keeps each van's identity (and therefore its colour and number) stable when a new plan arrives:
 * every new route inherits the id of the old route it shares the most stops with.
 */
export interface VanAssignment {
  routes: number[][];
  ids: number[];
}

export function matchVanIds(prev: VanAssignment | null, next: number[][]): number[] {
  if (!prev || prev.routes.length === 0) return next.map((_, k) => k);
  const owner = new Map<number, number>();
  prev.routes.forEach((r, k) => r.forEach((c) => owner.set(c, prev.ids[k])));

  const pairs: { j: number; id: number; shared: number }[] = [];
  next.forEach((r, j) => {
    const count = new Map<number, number>();
    for (const c of r) {
      const id = owner.get(c);
      if (id !== undefined) count.set(id, (count.get(id) ?? 0) + 1);
    }
    count.forEach((shared, id) => pairs.push({ j, id, shared }));
  });
  pairs.sort((a, b) => b.shared - a.shared || a.id - b.id);

  const ids = new Array<number>(next.length).fill(-1);
  const used = new Set<number>();
  for (const p of pairs) {
    if (ids[p.j] !== -1 || used.has(p.id)) continue;
    ids[p.j] = p.id;
    used.add(p.id);
  }
  let free = 0;
  for (let j = 0; j < ids.length; j++) {
    if (ids[j] !== -1) continue;
    while (used.has(free)) free++;
    ids[j] = free;
    used.add(free);
  }
  return ids;
}
