import { statLabels } from '../constants';
import type { LevelUpPopup, StatKey, Unit } from '../types';
import { getPlayerClass } from './classes';

export const COMBAT_EXP = 10;
export const KILL_EXP = 20;
export const MAP_CLEAR_EXP = 30;

function weightedStat(growth: Record<StatKey, number>): StatKey {
  const entries = Object.entries(growth) as Array<[StatKey, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  let roll = Math.random() * total;

  for (const [key, weight] of entries) {
    roll -= Math.max(0, weight);
    if (roll <= 0) return key;
  }

  return 'str';
}

function levelUp(unit: Unit): LevelUpPopup {
  unit.level += 1;
  unit.maxHp += 1;
  unit.hp += 1;

  const gains: Partial<Record<StatKey, number>> = {};
  for (let i = 0; i < 3; i++) {
    const stat = weightedStat(unit.growth);
    unit[stat] += 1;
    gains[stat] = (gains[stat] ?? 0) + 1;
  }

  const playerClass = getPlayerClass(unit);
  if (playerClass) {
    const classStat = weightedStat(playerClass.growth);
    unit[classStat] += 1;
    gains[classStat] = (gains[classStat] ?? 0) + 1;
  }

  const gainedStats = Object.entries(gains).map(([key, amount]) => ({
    label: statLabels[key as StatKey],
    amount: amount as number,
  }));

  return {
    unitName: unit.name,
    level: unit.level,
    gains: [{ label: 'HP', amount: 1 }, ...gainedStats],
  };
}

export function addExp(unit: Unit, amount: number): LevelUpPopup[] {
  if (unit.team !== 'player') return [];

  const popups: LevelUpPopup[] = [];
  unit.exp += amount;
  while (unit.exp >= 100) {
    unit.exp -= 100;
    popups.push(levelUp(unit));
  }

  return popups;
}

export function levelUpLog(popup: LevelUpPopup): string {
  const gains = popup.gains.map((gain) => `${gain.label}+${gain.amount}`).join(' / ');
  return `${popup.unitName} Lv${popup.level}: ${gains}`;
}
