import { MAX_STRONG_PER_MAP } from '../constants';
import { battleMaps, worldNodes } from '../data/maps';
import { createEnemyUnit } from '../logic/factories';
import { parseTiles } from '../logic/map';
import type { WorldNode } from '../types';
import type { GameState } from './state';

const playerStarts = [
  { x: 1, y: 2 },
  { x: 1, y: 3 },
  { x: 0, y: 2 },
  { x: 0, y: 3 },
];

export function enterBattle(state: GameState, battleIndex: number): void {
  const map = battleMaps[battleIndex];
  state.currentBattleIndex = battleIndex;
  state.currentTiles = parseTiles(map);
  state.enemies = map.enemies.map(createEnemyUnit);
  state.players.forEach((unit, index) => {
    unit.x = playerStarts[index].x;
    unit.y = playerStarts[index].y;
    unit.acted = unit.unavailable;
    unit.strongLeft = MAX_STRONG_PER_MAP;
  });
  state.phase = 'player';
}

export function advanceWorldNode(state: GameState): WorldNode {
  if (state.currentWorldIndex < worldNodes.length - 1) state.currentWorldIndex += 1;
  return worldNodes[state.currentWorldIndex];
}
