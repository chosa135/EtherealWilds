import { consumableMasters } from '../data/items';
import { categoryRates, rarityRates, rewardTables, type WeightedRewardRate } from '../data/rewards';
import { weaponMasters } from '../data/weapons';
import type { RewardCategory, RewardOption, RewardRarity } from '../types';

let nextRewardId = 1;

type RewardCandidate = {
  rarity: RewardRarity;
  category: RewardCategory;
  itemMasterId: string;
  weight: number;
};

function rollWeighted<T extends string>(entries: Array<WeightedRewardRate<T>>): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;

  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }

  return entries[0].value;
}

function rollRewardCandidate(candidates: RewardCandidate[]): RewardCandidate {
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  let roll = Math.random() * total;

  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) return candidate;
  }

  return candidates[0];
}

function buildAllRewardCandidates(): RewardCandidate[] {
  return rarityRates.flatMap((rarityRate) =>
    categoryRates.flatMap((categoryRate) => {
      const table = rewardTables[`${rarityRate.value}:${categoryRate.value}`];
      const tableWeight = table.reduce((sum, entry) => sum + entry.weight, 0);

      return table.map((entry) => ({
        rarity: rarityRate.value,
        category: categoryRate.value,
        itemMasterId: entry.itemMasterId,
        weight: rarityRate.weight * categoryRate.weight * (entry.weight / tableWeight),
      }));
    }),
  );
}

function pickRewardCandidate(usedItemMasterIds: Set<string>): RewardCandidate {
  const rarity = rollWeighted(rarityRates);
  const category = rollWeighted(categoryRates);
  const table = rewardTables[`${rarity}:${category}`]
    .filter((entry) => !usedItemMasterIds.has(entry.itemMasterId))
    .map((entry) => ({
      rarity,
      category,
      itemMasterId: entry.itemMasterId,
      weight: entry.weight,
    }));

  if (table.length > 0) return rollRewardCandidate(table);

  const fallbackCandidates = buildAllRewardCandidates().filter(
    (candidate) => !usedItemMasterIds.has(candidate.itemMasterId),
  );

  if (fallbackCandidates.length > 0) return rollRewardCandidate(fallbackCandidates);

  return rollRewardCandidate(buildAllRewardCandidates());
}

function getRewardName(category: RewardCategory, itemMasterId: string): string {
  if (category === 'weapon') return weaponMasters[itemMasterId]?.name ?? itemMasterId;
  return consumableMasters[itemMasterId]?.name ?? itemMasterId;
}

export function createRewardOptions(count = 3): RewardOption[] {
  const usedItemMasterIds = new Set<string>();

  return Array.from({ length: count }, () => {
    const candidate = pickRewardCandidate(usedItemMasterIds);
    usedItemMasterIds.add(candidate.itemMasterId);

    return {
      id: `reward-${nextRewardId++}`,
      rarity: candidate.rarity,
      category: candidate.category,
      itemMasterId: candidate.itemMasterId,
      name: getRewardName(candidate.category, candidate.itemMasterId),
    };
  });
}
