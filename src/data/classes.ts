import type { PlayerClassId, PlayerClassMaster } from '../types';

/** 下級職マスター。成長率は職業成長1ポイントの抽選重みとして扱う。 */
export const playerClassMasters: Record<PlayerClassId, PlayerClassMaster> = {
  swordfighter: {
    id: 'swordfighter',
    name: '剣士',
    statModifiers: { spd: 2 },
    skill: 'nimble',
    skillName: '身軽',
    skillDescription: '回避+10',
    growth: { str: 1, mag: 0, skl: 2, spd: 4, def: 0, res: 0 },
  },
  lancer: {
    id: 'lancer',
    name: '槍兵',
    statModifiers: { def: 2 },
    skill: 'defensiveStance',
    skillName: '守勢',
    skillDescription: '相手から攻撃された時、被ダメージ-2',
    growth: { str: 2, mag: 0, skl: 1, spd: 0, def: 4, res: 0 },
  },
  archer: {
    id: 'archer',
    name: '弓兵',
    statModifiers: { skl: 2 },
    skill: 'fullDraw',
    skillName: '渾身',
    skillDescription: 'HP最大時、与ダメージ+2',
    growth: { str: 1, mag: 0, skl: 4, spd: 2, def: 0, res: 0 },
  },
  mage: {
    id: 'mage',
    name: '魔道士',
    statModifiers: { res: 2 },
    skill: 'focus',
    skillName: '集中',
    skillDescription: '自分から攻撃した時、命中+10',
    growth: { str: 0, mag: 4, skl: 0, spd: 1, def: 0, res: 2 },
  },
};
