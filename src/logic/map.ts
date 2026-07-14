import { distance } from './combat';
import { getEquippedWeapon } from './inventory';
import type { MapDef, Point, Tile, Unit } from '../types';

export type MapQueries = {
  inBounds: (x: number, y: number) => boolean;
  tileAt: (x: number, y: number) => Tile;
  moveCost: (x: number, y: number) => number;
  pointKey: (point: Point) => string;
  unitAt: (x: number, y: number) => Unit | null;
  computeReachable: (unit: Unit) => Point[];
  computeAttackCellsFromPositions: (unit: Unit, positions: Point[]) => Point[];
  getPreviewRanges: (unit: Unit, allowMove: boolean) => { moveCells: Point[]; attackCells: Point[] };
};

export function parseTiles(mapDef: MapDef): Tile[][] {
  return mapDef.tiles.map((row) =>
    row.split('').map((cell) => (cell === 'f' ? 'forest' : cell === '#' ? 'wall' : 'plain')),
  );
}

export function createMapQueries(
  width: number,
  height: number,
  getTiles: () => Tile[][],
  getUnits: () => Unit[],
): MapQueries {
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const tileAt = (x: number, y: number): Tile => getTiles()[y]?.[x] ?? 'wall';
  const moveCost = (x: number, y: number): number => {
    const tile = tileAt(x, y);
    if (tile === 'wall') return 999;
    return tile === 'forest' ? 2 : 1;
  };
  const pointKey = (point: Point): string => `${point.x},${point.y}`;
  const unitAt = (x: number, y: number): Unit | null =>
    getUnits().find((unit) => unit.x === x && unit.y === y) ?? null;

  const computeReachable = (unit: Unit): Point[] => {
    const bestCosts = new Map<string, number>();
    const queue: Array<{ x: number; y: number; cost: number }> = [{ x: unit.x, y: unit.y, cost: 0 }];
    bestCosts.set(`${unit.x},${unit.y}`, 0);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        if (!inBounds(nx, ny) || tileAt(nx, ny) === 'wall') continue;

        const occupant = unitAt(nx, ny);
        if (occupant && occupant.id !== unit.id && occupant.team !== unit.team) continue;

        const nextCost = current.cost + moveCost(nx, ny);
        if (nextCost > unit.move) continue;

        const key = `${nx},${ny}`;
        if (!bestCosts.has(key) || nextCost < bestCosts.get(key)!) {
          bestCosts.set(key, nextCost);
          queue.push({ x: nx, y: ny, cost: nextCost });
        }
      }
    }

    return [...bestCosts.keys()]
      .map((key) => {
        const [x, y] = key.split(',').map(Number);
        return { x, y };
      })
      .filter((point) => {
        const occupant = unitAt(point.x, point.y);
        return !occupant || occupant.id === unit.id;
      });
  };

  const computeAttackCellsFromPositions = (unit: Unit, positions: Point[]): Point[] => {
    const weapon = getEquippedWeapon(unit);
    if (!weapon) return [];
    const cells = new Map<string, Point>();

    for (const position of positions) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (tileAt(x, y) === 'wall') continue;
          const cell = { x, y };
          const range = distance(position, cell);
          if (range >= weapon.rangeMin && range <= weapon.rangeMax) cells.set(pointKey(cell), cell);
        }
      }
    }
    return [...cells.values()];
  };

  const getPreviewRanges = (unit: Unit, allowMove: boolean): { moveCells: Point[]; attackCells: Point[] } => {
    const moveCells = allowMove ? computeReachable(unit) : [{ x: unit.x, y: unit.y }];
    const moveSet = new Set(moveCells.map(pointKey));
    const attackCells = computeAttackCellsFromPositions(unit, moveCells).filter(
      (point) => !moveSet.has(pointKey(point)),
    );
    return { moveCells, attackCells };
  };

  return { inBounds, tileAt, moveCost, pointKey, unitAt, computeReachable, computeAttackCellsFromPositions, getPreviewRanges };
}
