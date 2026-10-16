import { randomGraph, seededRandom } from './neighbors';

const isSymmetric = (net: number[][]) =>
  net.every((neighbors, i) => neighbors.every((n) => net[n].includes(i)));

describe('seededRandom', () => {
  it('should repeat for the same seed and differ for another', () => {
    const a = seededRandom('64b000000000000000000001');
    const b = seededRandom('64b000000000000000000001');
    const c = seededRandom('64b000000000000000000002');
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('randomGraph', () => {
  it('should give everyone 4 distinct neighbors, both ways, other than themselves', () => {
    const net = randomGraph(4, 30, seededRandom('assembly'));
    expect(net).toHaveLength(30);
    net.forEach((neighbors, i) => {
      expect(new Set(neighbors).size).toBe(4);
      expect(neighbors).not.toContain(i);
    });
    expect(isSymmetric(net)).toBe(true);
  });

  it('should be the same graph for the same seed', () => {
    expect(randomGraph(4, 20, seededRandom('x'))).toEqual(
      randomGraph(4, 20, seededRandom('x')),
    );
  });

  it('should shuffle away from the ring', () => {
    const ring = randomGraph(4, 9, () => 0.5).map((n) => [...n].sort());
    const shuffled = randomGraph(4, 30, seededRandom('x'));
    expect(
      shuffled.some((neighbors, i) => !neighbors.includes((i + 1) % 30)),
    ).toBe(true);
    expect(ring[0]).toEqual([1, 2, 7, 8]);
  });

  it('should cope with small groups', () => {
    expect(randomGraph(4, 0, seededRandom('x'))).toEqual([]);
    expect(randomGraph(4, 1, seededRandom('x'))).toEqual([[]]);
    expect(
      randomGraph(4, 3, seededRandom('x')).map((n) => [...n].sort()),
    ).toEqual([
      [1, 2],
      [0, 2],
      [0, 1],
    ]);
  });
});
