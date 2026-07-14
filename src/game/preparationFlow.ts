import { depositItem, useInventoryConsumable, withdrawItem } from '../logic/inventory';
import type { PreparationMode, Unit } from '../types';
import type { GameState } from './state';
import type { BattleUiState, PreparationUiState } from './uiState';

export type PreparationFlowContext = {
  getGame: () => GameState;
  battleUi: BattleUiState;
  preparationUi: PreparationUiState;
  clearSelection: () => void;
  returnToWorld: () => void;
  log: (message: string) => void;
};

export function createPreparationFlow(context: PreparationFlowContext) {
  return {
    start(): void {
      context.getGame().phase = 'preparation';
      context.battleUi.mode = 'idle';
      context.preparationUi.mode = 'selectUnit';
      context.preparationUi.unit = null;
      context.preparationUi.convoyPage = 0;
      context.clearSelection();
      context.log('身支度を始めた');
    },

    finish(): void {
      context.preparationUi.mode = 'selectUnit';
      context.preparationUi.unit = null;
      context.returnToWorld();
      context.log('身支度を終えた');
    },

    setMode(mode: PreparationMode): void {
      context.preparationUi.mode = mode;
    },

    setUnit(unit: Unit | null): void {
      context.preparationUi.unit = unit;
    },

    setConvoyPage(page: number): void {
      context.preparationUi.convoyPage = page;
    },

    useConsumable(unit: Unit, slotIndex: number): void {
      const result = useInventoryConsumable(unit, slotIndex);
      context.log(result.message);
    },

    deposit(unit: Unit, slotIndex: number): void {
      const item = depositItem(unit, slotIndex, context.getGame().convoy);
      if (item) context.log(`${unit.name}は${item.name}を輸送隊へ預けた`);
    },

    withdraw(unit: Unit, convoyIndex: number): void {
      const convoy = context.getGame().convoy;
      const item = withdrawItem(convoy, convoyIndex, unit);
      if (!item) {
        context.log(`${unit.name}の所持品に空きがありません`);
        return;
      }
      context.log(`${unit.name}は輸送隊から${item.name}を取り出した`);
      const pageCount = Math.max(1, Math.ceil(convoy.length / 8));
      context.preparationUi.convoyPage = Math.min(context.preparationUi.convoyPage, pageCount - 1);
    },
  };
}

export type PreparationFlow = ReturnType<typeof createPreparationFlow>;
