import { INVENTORY_SIZE, statLabels } from '../constants';
import type { Consumable, InventorySlot, Item, Unit, Weapon } from '../types';

export type ConsumableUseResult = {
  used: boolean;
  message: string;
};

export function inventorySlots(unit: Unit): InventorySlot[] {
  while (unit.inventory.length < INVENTORY_SIZE) unit.inventory.push(null);
  return unit.inventory.slice(0, INVENTORY_SIZE);
}

export function isWeapon(item: InventorySlot): item is Weapon {
  return !!item && item.category === 'weapon';
}

export function isConsumable(item: InventorySlot): item is Consumable {
  return !!item && item.category === 'consumable';
}

export function getEquippedWeapon(unit: Unit): Weapon | null {
  const item = inventorySlots(unit).find((slot) => isWeapon(slot) && slot.id === unit.equippedItemId);
  if (item && isWeapon(item)) return item;
  return null;
}

export function getFirstUsablePotion(unit: Unit): { item: Consumable; slotIndex: number } | null {
  const slots = inventorySlots(unit);
  const slotIndex = slots.findIndex((item) => isConsumable(item) && item.effect === 'heal' && item.uses > 0);
  if (slotIndex < 0) return null;
  return { item: slots[slotIndex] as Consumable, slotIndex };
}

export function equipWeapon(unit: Unit, weapon: Weapon): void {
  unit.equippedItemId = weapon.id;
}

export function allRepairTargets(players: Unit[]): Array<{ unit: Unit; weapon: Weapon }> {
  return players.flatMap((unit) =>
    inventorySlots(unit)
      .filter(isWeapon)
      .map((weapon) => ({ unit, weapon })),
  );
}

export function firstEmptySlotIndex(unit: Unit): number {
  return inventorySlots(unit).findIndex((slot) => slot === null);
}

export function addItemToFirstEmptySlot(unit: Unit, item: InventorySlot): boolean {
  if (!item) return false;
  const slotIndex = firstEmptySlotIndex(unit);
  if (slotIndex < 0) return false;
  unit.inventory[slotIndex] = item;
  return true;
}

function equipFirstAvailableWeapon(unit: Unit): void {
  const weapon = inventorySlots(unit).find(isWeapon);
  unit.equippedItemId = weapon?.id ?? null;
}

export function depositItem(unit: Unit, slotIndex: number, convoy: Item[]): Item | null {
  const item = inventorySlots(unit)[slotIndex];
  if (!item) return null;

  unit.inventory[slotIndex] = null;
  convoy.push(item);

  if (unit.equippedItemId === item.id) equipFirstAvailableWeapon(unit);
  return item;
}

export function withdrawItem(convoy: Item[], convoyIndex: number, unit: Unit): Item | null {
  const item = convoy[convoyIndex];
  if (!item || !addItemToFirstEmptySlot(unit, item)) return null;

  convoy.splice(convoyIndex, 1);
  return item;
}

export function useInventoryConsumable(unit: Unit, slotIndex: number): ConsumableUseResult {
  const item = inventorySlots(unit)[slotIndex];
  if (!isConsumable(item)) return { used: false, message: '使用できる道具ではありません' };

  if (item.effect === 'heal') {
    if (unit.unavailable) return { used: false, message: '戦闘不能中は回復アイテムを使用できません' };
    if (unit.hp >= unit.maxHp) return { used: false, message: 'HPは満タン' };

    const before = unit.hp;
    unit.hp = Math.min(unit.maxHp, unit.hp + item.amount);
    item.uses -= 1;
    if (item.uses <= 0) unit.inventory[slotIndex] = null;
    return { used: true, message: `${unit.name}は${item.name}でHPを${unit.hp - before}回復した` };
  }

  if (!item.stat) return { used: false, message: '使用できる道具ではありません' };

  unit[item.stat] += item.amount;
  item.uses -= 1;
  if (item.uses <= 0) unit.inventory[slotIndex] = null;
  return { used: true, message: `${unit.name}は${item.name}で${statLabels[item.stat]}+${item.amount}` };
}
