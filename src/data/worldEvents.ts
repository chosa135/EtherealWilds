import type { WorldEventDefinition, WorldEventId } from '../types';

export const worldEventDefinitions: Record<WorldEventId, WorldEventDefinition> = {
  smallShade: {
    id: 'smallShade',
    title: '小さな木陰',
    text: '探索者たちは小さな木陰を見つけた。休憩にはうってつけだが、周囲には魔物の痕跡も見られる。見張りを立てる必要がありそうだ……',
  },
  spiritSpring: {
    id: 'spiritSpring',
    title: '霊泉',
    text: '古木の根元に、淡い光をたたえた泉が湧いている。水面には力を宿した雫がひとつ、静かに揺れていた。',
  },
  ruggedPath: {
    id: 'ruggedPath',
    title: '険しい道',
    text: '近道らしき獣道は険しく、茨とぬかるみに覆われている。傷を負う覚悟で進むか、安全な迂回路を選ぶ必要がある。',
  },
  abandonedCamp: {
    id: 'abandonedCamp',
    title: '廃キャンプ',
    text: '打ち捨てられた野営跡に、まだ使えそうな砥石と薬包が残されていた。持ち出せるのはどちらかひとつだけだ。',
  },
};

export const worldEventIds = Object.keys(worldEventDefinitions) as WorldEventId[];

export const statDropMasterIds = [
  'strDrop1',
  'magDrop1',
  'sklDrop1',
  'spdDrop1',
  'defDrop1',
  'resDrop1',
] as const;
