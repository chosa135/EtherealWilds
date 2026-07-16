import type { RewardCategory, RewardRarity } from '../types';

export type WeightedRewardRate<T extends string> = {
  value: T;
  weight: number;
};

export type RewardTableEntry = {
  itemMasterId: string;
  weight: number;
};

export const rarityRates: Array<WeightedRewardRate<RewardRarity>> = [
  { value: 'common', weight: 70 },
  { value: 'uncommon', weight: 25 },
  { value: 'rare', weight: 5 },
];

/** カテゴリ保証は入れず、3候補それぞれ独立に抽選する。 */
export const categoryRates: Array<WeightedRewardRate<RewardCategory>> = [
  { value: 'weapon', weight: 60 },
  { value: 'consumable', weight: 40 },
];

export const rewardTables: Record<`${RewardRarity}:${RewardCategory}`, RewardTableEntry[]> = {
  'common:weapon': [
    { itemMasterId: 'ironSword', weight: 10 },
    { itemMasterId: 'ironLance', weight: 10 },
    { itemMasterId: 'ironBow', weight: 10 },
    { itemMasterId: 'tome', weight: 10 },
  ],
  'uncommon:weapon': [
    { itemMasterId: 'porcelainSword', weight: 10 },
    { itemMasterId: 'porcelainLance', weight: 10 },
    { itemMasterId: 'porcelainBow', weight: 10 },
    { itemMasterId: 'oldTome', weight: 10 },
  ],
  'rare:weapon': [
    { itemMasterId: 'tamahaganeSword', weight: 10 },
    { itemMasterId: 'tamahaganeLance', weight: 10 },
    { itemMasterId: 'tamahaganeBow', weight: 10 },
    { itemMasterId: 'tamahaganeTome', weight: 10 },
  ],

  'common:consumable': [
    { itemMasterId: 'vulnerary', weight: 10 },
  ],
  'uncommon:consumable': [
    { itemMasterId: 'highVulnerary', weight: 8 },
    { itemMasterId: 'hpDrop2', weight: 5 },
    { itemMasterId: 'strDrop1', weight: 5 },
    { itemMasterId: 'magDrop1', weight: 5 },
    { itemMasterId: 'sklDrop1', weight: 5 },
    { itemMasterId: 'spdDrop1', weight: 5 },
    { itemMasterId: 'defDrop1', weight: 5 },
    { itemMasterId: 'resDrop1', weight: 5 },
  ],
  'rare:consumable': [
    { itemMasterId: 'hpDrop5', weight: 5 },
    { itemMasterId: 'strDrop3', weight: 5 },
    { itemMasterId: 'magDrop3', weight: 5 },
    { itemMasterId: 'sklDrop3', weight: 5 },
    { itemMasterId: 'spdDrop3', weight: 5 },
    { itemMasterId: 'defDrop3', weight: 5 },
    { itemMasterId: 'resDrop3', weight: 5 },
  ],
};
