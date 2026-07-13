import { playerClassMasters } from '../data/classes';
import type { ClassSkill, PlayerClassMaster, StatKey, Unit } from '../types';

export function getPlayerClass(unit: Unit): PlayerClassMaster | null {
  return unit.classId ? playerClassMasters[unit.classId] : null;
}

export function effectiveStat(unit: Unit, stat: StatKey): number {
  return unit[stat] + (getPlayerClass(unit)?.statModifiers[stat] ?? 0);
}

export function hasClassSkill(unit: Unit, skill: ClassSkill): boolean {
  return getPlayerClass(unit)?.skill === skill;
}
