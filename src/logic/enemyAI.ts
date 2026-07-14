import type { Point, Tile, Unit, Weapon } from '../types';
import { buildCombatPreview, distance } from './combat';
import { isWeapon } from './inventory';

export type EnemyAiBoard = {
  width: number;
  height: number;
  units: Unit[];
  tileAt: (point: Point) => Tile;
  moveCost: (point: Point) => number;
};

export type EnemyBattleDecision = {
  kind: 'battle';
  destination: Point;
  target: Unit;
  weapon: Weapon;
  predictedDamage: number;
  category: 'A' | 'B' | 'C';
};

export type EnemyMoveDecision = {
  kind: 'move';
  destination: Point;
  target: Unit | null;
};

export type EnemyDecision = EnemyBattleDecision | EnemyMoveDecision;

type ReachableDestination = Point & {
  moveCostUsed: number;
};

type BattleCandidate = EnemyBattleDecision & {
  categoryRank: number;
  stableOrder: number;
};

const neighborOffsets: Point[] = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function stablePointCompare(a: Point, b: Point): number {
  return a.y - b.y || a.x - b.x;
}

function inBounds(point: Point, board: EnemyAiBoard): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < board.width && point.y < board.height;
}

function unitAt(point: Point, board: EnemyAiBoard): Unit | null {
  return board.units.find((unit) => unit.hp > 0 && unit.x === point.x && unit.y === point.y) ?? null;
}

function canTraverse(enemy: Unit, point: Point, board: EnemyAiBoard, targetId?: string): boolean {
  if (!inBounds(point, board) || board.tileAt(point) === 'wall') return false;

  const occupant = unitAt(point, board);
  if (!occupant || occupant.id === enemy.id || occupant.team === enemy.team) return true;
  return occupant.id === targetId;
}

function reachableDestinations(enemy: Unit, board: EnemyAiBoard): ReachableDestination[] {
  const bestCosts = new Map<string, number>([[pointKey(enemy), 0]]);
  const queue: ReachableDestination[] = [{ x: enemy.x, y: enemy.y, moveCostUsed: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.moveCostUsed - b.moveCostUsed || stablePointCompare(a, b));
    const current = queue.shift()!;
    if (current.moveCostUsed !== bestCosts.get(pointKey(current))) continue;

    for (const offset of neighborOffsets) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      if (!canTraverse(enemy, next, board)) continue;

      const nextCost = current.moveCostUsed + board.moveCost(next);
      if (nextCost > enemy.move) continue;

      const key = pointKey(next);
      if (nextCost >= (bestCosts.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      bestCosts.set(key, nextCost);
      queue.push({ ...next, moveCostUsed: nextCost });
    }
  }

  return [...bestCosts.entries()]
    .map(([key, moveCostUsed]) => {
      const [x, y] = key.split(',').map(Number);
      return { x, y, moveCostUsed };
    })
    .filter((point) => {
      const occupant = unitAt(point, board);
      return !occupant || occupant.id === enemy.id;
    })
    .sort(stablePointCompare);
}

function shortestPathDistance(enemy: Unit, start: Point, target: Unit, board: EnemyAiBoard): number {
  const bestCosts = new Map<string, number>([[pointKey(start), 0]]);
  const queue: Array<Point & { cost: number }> = [{ ...start, cost: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost || stablePointCompare(a, b));
    const current = queue.shift()!;
    if (current.cost !== bestCosts.get(pointKey(current))) continue;
    if (current.x === target.x && current.y === target.y) return current.cost;

    for (const offset of neighborOffsets) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      if (!canTraverse(enemy, next, board, target.id)) continue;

      const nextCost = current.cost + board.moveCost(next);
      const key = pointKey(next);
      if (nextCost >= (bestCosts.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      bestCosts.set(key, nextCost);
      queue.push({ ...next, cost: nextCost });
    }
  }

  return Number.POSITIVE_INFINITY;
}

function enumerateBattleCandidates(
  enemy: Unit,
  targets: Unit[],
  destinations: ReachableDestination[],
): BattleCandidate[] {
  const weapons = enemy.inventory.filter(isWeapon);
  const candidates: BattleCandidate[] = [];
  let stableOrder = 0;

  for (const destination of destinations) {
    for (const target of targets) {
      for (const weapon of weapons) {
        const currentOrder = stableOrder++;
        const attackDistance = distance(destination, target);
        if (attackDistance < weapon.rangeMin || attackDistance > weapon.rangeMax) continue;

        const actingEnemy: Unit = {
          ...enemy,
          x: destination.x,
          y: destination.y,
          equippedItemId: weapon.id,
        };
        const preview = buildCombatPreview({
          attacker: actingEnemy,
          defender: target,
          firstAttackKind: 'normal',
        });
        const predictedDamage = preview.lines
          .filter((line) => line.available && line.actor.id === enemy.id)
          .reduce((sum, line) => sum + line.damage, 0);
        const canDefeat = predictedDamage >= target.hp;
        const receivesCounter = preview.lines.some((line) => line.available && line.actor.id === target.id);
        const category = canDefeat ? 'A' : receivesCounter ? 'C' : 'B';
        const categoryRank = category === 'A' ? 0 : category === 'B' ? 1 : 2;

        candidates.push({
          kind: 'battle',
          destination: { x: destination.x, y: destination.y },
          target,
          weapon,
          predictedDamage,
          category,
          categoryRank,
          stableOrder: currentOrder,
        });
      }
    }
  }

  return candidates;
}

function chooseBattle(candidates: BattleCandidate[]): EnemyBattleDecision | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  return [...candidates].sort((a, b) =>
    a.categoryRank - b.categoryRank
    || b.predictedDamage - a.predictedDamage
    || a.stableOrder - b.stableOrder,
  )[0];
}

function chooseMove(
  enemy: Unit,
  targets: Unit[],
  destinations: ReachableDestination[],
  board: EnemyAiBoard,
): EnemyMoveDecision {
  if (targets.length === 0) {
    return { kind: 'move', destination: { x: enemy.x, y: enemy.y }, target: null };
  }

  const target = targets
    .map((candidate, stableOrder) => ({
      target: candidate,
      distance: shortestPathDistance(enemy, enemy, candidate, board),
      stableOrder,
    }))
    .sort((a, b) => a.distance - b.distance || a.stableOrder - b.stableOrder)[0].target;

  const destination = destinations
    .map((point, stableOrder) => ({
      point,
      distance: shortestPathDistance(enemy, point, target, board),
      stableOrder,
    }))
    .sort((a, b) =>
      a.distance - b.distance
      || b.point.moveCostUsed - a.point.moveCostUsed
      || a.stableOrder - b.stableOrder,
    )[0].point;

  return {
    kind: 'move',
    destination: { x: destination.x, y: destination.y },
    target,
  };
}

/** 同じ盤面からは常に同じ行動を返す、敵1体ぶんの行動決定。 */
export function chooseEnemyAction(enemy: Unit, targets: Unit[], board: EnemyAiBoard): EnemyDecision {
  const destinations = reachableDestinations(enemy, board);
  const battle = chooseBattle(enumerateBattleCandidates(enemy, targets, destinations));
  return battle ?? chooseMove(enemy, targets, destinations, board);
}
