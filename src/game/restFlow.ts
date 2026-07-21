import type { Unit, Weapon } from '../types';
import { REST_ACTION_MAX } from '../constants';
import type { GameState } from './state';
import type { BattleUiState, RestUiState } from './uiState';

export function healAtRest(players: Unit[]): void {
  players.filter((unit) => !unit.unavailable && unit.hp > 0).forEach((unit) => {
    unit.hp = Math.min(unit.maxHp, unit.hp + Math.ceil(unit.maxHp * 0.3));
  });
}

export function reviveAtRest(players: Unit[]): Unit | null {
  const target = players.find((unit) => unit.unavailable) ?? null;
  if (!target) return null;
  target.unavailable = false;
  target.hp = Math.max(1, Math.ceil(target.maxHp * 0.5));
  return target;
}

export function trainAtRest(players: Unit[], grantExp: (unit: Unit, amount: number) => void): void {
  players.filter((unit) => !unit.unavailable && unit.hp > 0).forEach((unit) => grantExp(unit, 30));
}

export function repairAtRest(weapon: Weapon): void {
  const recover = Math.ceil(weapon.maxDurability * 0.5);
  weapon.durability = Math.min(weapon.maxDurability, weapon.durability + recover);
}

export type RestFlowContext = {
  getGame: () => GameState;
  battleUi: BattleUiState;
  restUi: RestUiState;
  grantExp: (unit: Unit, amount: number) => void;
  clearSelection: () => void;
  log: (message: string) => void;
};

export function createRestFlow(context: RestFlowContext) {
  const consumeAction = (): void => {
    context.restUi.actionsLeft = Math.max(0, context.restUi.actionsLeft - 1);
    context.restUi.mode = 'main';
  };

  return {
    start(): void {
      context.getGame().phase = 'rest';
      context.battleUi.mode = 'idle';
      context.restUi.actionsLeft = REST_ACTION_MAX;
      context.restUi.mode = 'main';
      context.clearSelection();
      context.log('休憩所に到着した');
    },

    setMode(mode: RestUiState['mode']): void {
      context.restUi.mode = mode;
    },

    heal(): void {
      if (context.restUi.actionsLeft <= 0) return;
      healAtRest(context.getGame().players);
      consumeAction();
      context.log('休息：出撃可能な全員のHPを回復した');
    },

    revive(): void {
      if (context.restUi.actionsLeft <= 0) return;
      const target = reviveAtRest(context.getGame().players);
      if (!target) {
        context.log('復帰が必要な隊員はいない');
        return;
      }
      consumeAction();
      context.log(`復帰：${target.name}が戦列に戻った`);
    },

    train(): void {
      if (context.restUi.actionsLeft <= 0) return;
      trainAtRest(context.getGame().players, context.grantExp);
      consumeAction();
      context.log('鍛錬：出撃可能な全員がEXP+30');
    },

    startRepairSelection(): void {
      if (context.restUi.actionsLeft <= 0) return;
      context.restUi.mode = 'repairTarget';
      context.log('修繕する武器を選択してください');
    },

    repair(target: { unit: Unit; weapon: Weapon }): void {
      if (context.restUi.actionsLeft <= 0) return;
      repairAtRest(target.weapon);
      consumeAction();
      context.log(`修繕：${target.unit.name}の${target.weapon.name}を修繕した`);
    },
  };
}

export type RestFlow = ReturnType<typeof createRestFlow>;
