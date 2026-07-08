import type { Point, Unit } from '../types';
import { distance, inRange } from './combat';

/**
 * 敵AIはここに集約する。
 * 現在は「攻撃可能ならHPが低い相手を狙う。無理なら最も近い位置へ進む」だけ。
 */
export function chooseEnemyAttackTarget(enemy: Unit, targets: Unit[]): Unit | null {
  return targets
    .filter((target) => inRange(enemy, target))
    .sort((a, b) => a.hp - b.hp)[0] ?? null;
}

export function chooseEnemyMoveDestination(
  enemy: Unit,
  targetCandidates: Unit[],
  reachable: Point[],
): Point {
  let best = { x: enemy.x, y: enemy.y };
  let bestScore = Number.POSITIVE_INFINITY;

  for (const point of reachable) {
    const score = Math.min(...targetCandidates.map((target) => distance(point, target)));
    if (score < bestScore) {
      best = point;
      bestScore = score;
    }
  }

  return best;
}
