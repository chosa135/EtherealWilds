import { INVENTORY_SIZE } from '../constants';
import type { Consumable, InventorySlot, Unit, Weapon } from '../types';

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
