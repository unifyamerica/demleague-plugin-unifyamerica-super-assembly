// Who sees whose answers: a random regular graph, as in the original app (a ring where each node sees its
// nearest `degree` nodes, then a Maslov–Sneppen shuffle that keeps every node's degree). The random numbers come
// from a generator seeded with the assembly's id, so every request that launches an assembly picks the same
// graph: a launch can safely run twice.

/** Deterministic 32-bit generator (mulberry32) seeded from a string. Returns numbers in [0, 1). */
export function seededRandom(seed: string): () => number {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** For each of `nodes` nodes, the indexes of the nodes it sees. */
export function randomGraph(
  requestedDegree: number,
  nodes: number,
  random: () => number,
): number[][] {
  if (nodes <= 0) return [];
  const degree = Math.min(requestedDegree, nodes - 1);
  const net: number[][] = [];

  // A ring: each node sees its nearest `degree` nodes, alternating sides (-1, +1, -2, +2, …)
  for (let i = 0; i < nodes; i++) {
    const neighbors: number[] = [];
    for (let d = 0; d < degree; d++) {
      const offset = (Math.floor(d / 2) + 1) * (d % 2 === 0 ? -1 : 1);
      neighbors.push((((i + offset) % nodes) + nodes) % nodes);
    }
    net.push(neighbors);
  }

  // Rewire a–b, c–d into a–c, b–d when that adds no duplicate or self edge; too small a ring has no room
  if (nodes > degree * 2) {
    const pick = (n: number) => Math.floor(random() * n);
    for (let i = 0; i < nodes * degree * 1000; i++) {
      const a = pick(nodes);
      const b = net[a][pick(degree)];
      const c = pick(nodes);
      if (c === a || c === b) continue;
      const d = net[c][pick(degree)];
      if (d === a || d === b || net[a].includes(c) || net[b].includes(d))
        continue;
      // Only symmetric edges can be rewired (an odd degree leaves some one-way)
      const [ab, ba, cd, dc] = [
        net[a].indexOf(b),
        net[b].indexOf(a),
        net[c].indexOf(d),
        net[d].indexOf(c),
      ];
      if (ab < 0 || ba < 0 || cd < 0 || dc < 0) continue;
      net[a][ab] = c;
      net[b][ba] = d;
      net[c][cd] = a;
      net[d][dc] = b;
    }
  }
  return net;
}
