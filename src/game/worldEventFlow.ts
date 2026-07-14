import { createItem } from '../logic/factories';
import {
  applyRuggedPathDamage,
  repairWeaponHalf,
  restExceptLookout,
  rollStatDropMasterId,
  rollWorldEvent,
} from '../logic/worldEvents';
import type { Unit, Weapon, WorldEventMode } from '../types';
import type { GameState } from './state';
import type { BattleUiState, WorldEventUiState } from './uiState';

export type WorldEventFlowContext = {
  getGame: () => GameState;
  battleUi: BattleUiState;
  eventUi: WorldEventUiState;
  grantExp: (unit: Unit, amount: number) => void;
  clearSelection: () => void;
  returnToWorld: () => void;
  log: (message: string) => void;
};

export function createWorldEventFlow(context: WorldEventFlowContext) {
  const complete = (message: string): void => {
    context.eventUi.result = message;
    context.eventUi.mode = 'resolved';
    context.log(message);
  };

  return {
    start(): void {
      const game = context.getGame();
      context.eventUi.event = rollWorldEvent();
      context.eventUi.mode = 'choice';
      context.eventUi.result = '';
      game.phase = 'event';
      context.battleUi.mode = 'idle';
      context.clearSelection();
      context.log(`探索イベント：${context.eventUi.event.title}`);
    },

    setMode(mode: WorldEventMode): void {
      context.eventUi.mode = mode;
    },

    finish(): void {
      context.eventUi.event = null;
      context.eventUi.result = '';
      context.returnToWorld();
    },

    chooseShadeLookout(lookout: Unit): void {
      const rested = restExceptLookout(context.getGame().players, lookout.id);
      const restedNames = rested.map((unit) => unit.name).join('、');
      complete(`${lookout.name}に見張りを任せて休息した。${restedNames || '他の隊員'}は十分に体を休めることができた。`);
    },

    takeSpiritDrop(): void {
      const item = createItem({ category: 'consumable', masterId: rollStatDropMasterId() });
      if (!item) return;
      context.getGame().convoy.push(item);
      complete(`${item.name}を1つ入手し、輸送隊へ送った。`);
    },

    takeRuggedShortcut(): void {
      const players = context.getGame().players;
      applyRuggedPathDamage(players);
      players.forEach((unit) => context.grantExp(unit, 20));
      complete('険しい道を進んだ。味方全員のHPが5減少し、EXPを20獲得した。');
    },

    takeRuggedDetour(): void {
      context.getGame().players.forEach((unit) => context.grantExp(unit, 10));
      complete('安全な迂回路を進んだ。味方全員がEXPを10獲得した。');
    },

    repairCampWeapon(target: { unit: Unit; weapon: Weapon }): void {
      repairWeaponHalf(target.weapon);
      complete(`${target.unit.name}の${target.weapon.name}を最大耐久の50%ぶん修繕した。`);
    },

    takeCampMedicine(): void {
      const item = createItem({ category: 'consumable', masterId: 'vulnerary' });
      if (!item) return;
      context.getGame().convoy.push(item);
      complete('傷薬を1個入手し、輸送隊へ送った。');
    },
  };
}

export type WorldEventFlow = ReturnType<typeof createWorldEventFlow>;
