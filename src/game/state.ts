import { battleMaps } from '../data/maps';
import { createPlayerUnits } from '../logic/factories';
import { parseTiles } from '../logic/map';
import type { Item, Phase, Tile, Unit } from '../types';

export type GameState = {
  players: Unit[];
  enemies: Unit[];
  currentTiles: Tile[][];
  phase: Phase;
  currentWorldIndex: number;
  currentBattleIndex: number;
  runCleared: boolean;
  convoy: Item[];
  selectedBattleChoiceIndex: number | null;
};

export function createGameState(): GameState {
  return {
    players: createPlayerUnits(),
    enemies: [],
    currentTiles: parseTiles(battleMaps[0]),
    phase: 'world',
    currentWorldIndex: 0,
    currentBattleIndex: 0,
    runCleared: false,
    convoy: [],
    selectedBattleChoiceIndex: null,
  };
}
