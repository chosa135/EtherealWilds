import { consumableMasters } from '../data/items';
import { categoryRates, rarityRates, rewardTables, type WeightedRewardRate } from '../data/rewards';
import { weaponMasters } from '../data/weapons';
import type { RewardCategory, RewardOption, RewardRarity } from '../types';

let nextRewardId = 1;

function rollWeighted<T extends string>(entries: Array<WeightedRewardRate<T>>): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;

  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }

  return entries[0].value;
}

function pickTableEntry(rarity: RewardRarity, category: RewardCategory): string {
  const table = rewardTables[`${rarity}:${category}`];
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;

  for (const entry of table) {
    roll -= entry.weight;
    if (roll <= 0) return entry.itemMasterId;
  }

  return table[0].itemMasterId;
}

function getRewardName(category: RewardCategory, itemMasterId: string): string {
  if (category === 'weapon') return weaponMasters[itemMasterId]?.name ?? itemMasterId;
  return consumableMasters[itemMasterId]?.name ?? itemMasterId;
}

export function createRewardOptions(count = 3): RewardOption[] {
  return Array.from({ length: count }, () => {
    const rarity = rollWeighted(rarityRates);
    const category = rollWeighted(categoryRates);
    const itemMasterId = pickTableEntry(rarity, category);

    return {
      id: `reward-${nextRewardId++}`,
      rarity,
      category,
      itemMasterId,
      name: getRewardName(category, itemMasterId),
    };
  });
}
