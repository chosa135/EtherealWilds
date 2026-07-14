import { createItem } from '../logic/factories';
import { addItemToFirstEmptySlot } from '../logic/inventory';
import type { Item, RewardOption, Unit } from '../types';

export function giveRewardToUnit(option: RewardOption, unit: Unit): boolean {
  const item = createItem({ category: option.category, masterId: option.itemMasterId });
  return !!item && addItemToFirstEmptySlot(unit, item);
}

export function giveRewardToConvoy(option: RewardOption, convoy: Item[]): boolean {
  const item = createItem({ category: option.category, masterId: option.itemMasterId });
  if (!item) return false;
  convoy.push(item);
  return true;
}
