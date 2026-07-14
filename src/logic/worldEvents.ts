import { statDropMasterIds, worldEventDefinitions, worldEventIds } from '../data/worldEvents';
import type { Unit, Weapon, WorldEventDefinition } from '../types';

export function rollWorldEvent(): WorldEventDefinition {
  const id = worldEventIds[Math.floor(Math.random() * worldEventIds.length)];
  return worldEventDefinitions[id];
}

export function restExceptLookout(players: Unit[], lookoutId: string): Unit[] {
  const rested = players.filter((unit) => unit.id !== lookoutId && !unit.unavailable && unit.hp > 0);
  rested.forEach((unit) => {
    unit.hp = Math.min(unit.maxHp, unit.hp + Math.ceil(unit.maxHp * 0.5));
  });
  return rested;
}

export function applyRuggedPathDamage(players: Unit[], damage = 5): void {
  players.forEach((unit) => {
    if (unit.unavailable || unit.hp <= 0) return;
    unit.hp = Math.max(1, unit.hp - damage);
  });
}

export function rollStatDropMasterId(): string {
  return statDropMasterIds[Math.floor(Math.random() * statDropMasterIds.length)];
}

export function repairWeaponHalf(weapon: Weapon): number {
  const before = weapon.durability;
  weapon.durability = Math.min(weapon.maxDurability, weapon.durability + Math.ceil(weapon.maxDurability * 0.5));
  return weapon.durability - before;
}
