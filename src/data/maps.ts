import type { MapDef, WorldNode } from '../types';

/** 戦闘マップ。敵は enemyId + 配置だけを持つ。 */
export const battleMaps: MapDef[] = [
  {
    name: '幽樹海・浅層入口',
    tiles: ['........', '..f.....', '....#...', '.f......', '.....f..', '........'],
    enemies: [
      { id: 'e1', enemyId: 'monsterWeak', x: 5, y: 1 },
      { id: 'e2', enemyId: 'bowBandit', x: 6, y: 4 },
    ],
  },
  {
    name: '幽樹海・苔むす小径',
    tiles: ['..f.....', '..f..#..', '........', '.ff.....', '....f...', '........'],
    enemies: [
      { id: 'e3', enemyId: 'swordBandit', x: 5, y: 1 },
      { id: 'e4', enemyId: 'monsterWeak', x: 6, y: 3 },
      { id: 'e5', enemyId: 'cursePlant', x: 5, y: 5 },
    ],
  },
  {
    name: '幽樹海・倒木の広場',
    tiles: ['........', '.f..##..', '.f......', '....f...', '...##...', '........'],
    enemies: [
      { id: 'e6', enemyId: 'axeBandit', x: 5, y: 0 },
      { id: 'e7', enemyId: 'bowBandit', x: 6, y: 2 },
      { id: 'e8', enemyId: 'monsterMid', x: 5, y: 5 },
    ],
  },
  {
    name: '幽樹海・幽金の細脈',
    tiles: ['..f.....', '....#...', '.f..#...', '........', '...ff...', '........'],
    enemies: [
      { id: 'e9', enemyId: 'swordBandit', x: 5, y: 1 },
      { id: 'e10', enemyId: 'cursePlant', x: 6, y: 2 },
      { id: 'e11', enemyId: 'monsterLate', x: 6, y: 5 },
    ],
  },
  {
    name: '幽樹海・浅層最奥',
    tiles: ['........', '..f..#..', '..f.....', '....ff..', '.#......', '........'],
    enemies: [
      { id: 'e12', enemyId: 'axeBandit', x: 5, y: 0 },
      { id: 'e13', enemyId: 'bowBandit', x: 6, y: 2 },
      { id: 'e14', enemyId: 'boss', x: 6, y: 5 },
    ],
  },
  {
    name: '幽樹海・獣王の縄張り',
    tiles: ['..f.....', '....#...', '.f..#...', '........', '...ff...', '........'],
    enemies: [
      { id: 'e15', enemyId: 'axeBandit', x: 5, y: 1 },
      { id: 'e16', enemyId: 'cursePlant', x: 6, y: 2 },
      { id: 'e17', enemyId: 'forestBrute', x: 6, y: 5 },
    ],
  },
];

export const worldNodes: WorldNode[] = [
  { type: 'start' },
  { type: 'battle', battleIndex: 0 },
  { type: 'battle', battleIndex: 1 },
  { type: 'rest' },
  { type: 'battle', battleIndex: 2 },
  { type: 'event' },
  {
    type: 'battleChoice',
    battleChoices: [
      { label: '通常戦闘へ', description: '幽金の細脈を慎重に進む', battleIndex: 3 },
      { label: '強敵に挑む', description: '獣王の縄張りへ踏み込む', battleIndex: 5, strong: true },
    ],
  },
  { type: 'rest' },
  { type: 'battle', battleIndex: 4 },
  { type: 'end' },
];
