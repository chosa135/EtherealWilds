import { inRange } from '../logic/combat';
import { useInventoryConsumable } from '../logic/inventory';
import type { MapQueries } from '../logic/map';
import type { Mode, Point, Unit } from '../types';
import type { BattleUiState } from './uiState';

export type PlayerActionFlowContext = {
  state: BattleUiState;
  map: MapQueries;
  getLivingEnemies: () => Unit[];
  onActionFinished: () => void;
  log: (message: string) => void;
};

export function createPlayerActionFlow(context: PlayerActionFlowContext) {
  const clearSelection = (): void => {
    context.state.selected = null;
    context.state.selectedOrigin = null;
    context.state.reachable = [];
    context.state.targets = [];
    context.state.pendingCombat = null;
  };

  const returnToMenu = (): void => {
    context.state.targets = [];
    context.state.pendingCombat = null;
    context.state.mode = 'menu';
  };

  const cancelSelection = (): void => {
    const { selected, selectedOrigin } = context.state;
    if (selected && selectedOrigin) {
      selected.x = selectedOrigin.x;
      selected.y = selectedOrigin.y;
    }
    clearSelection();
    context.state.mode = 'idle';
    context.log('選択を解除した');
  };

  return {
    clearSelection,
    returnToMenu,
    cancelSelection,

    setMode(mode: Mode): void {
      context.state.mode = mode;
    },

    selectUnit(unit: Unit | null): boolean {
      if (!unit || unit.team !== 'player' || unit.acted || unit.unavailable) return false;
      context.state.selected = unit;
      context.state.selectedOrigin = { x: unit.x, y: unit.y };
      context.state.reachable = context.map.computeReachable(unit);
      context.state.mode = 'move';
      context.log(`${unit.name}を選択`);
      return true;
    },

    chooseMove(cell: Point): boolean {
      const selected = context.state.selected;
      const canStand = context.state.reachable.some((point) => point.x === cell.x && point.y === cell.y);
      if (selected && canStand) {
        selected.x = cell.x;
        selected.y = cell.y;
        context.state.mode = 'menu';
        return true;
      }
      cancelSelection();
      return false;
    },

    selectTargets(strong: boolean): void {
      const selected = context.state.selected;
      if (!selected) return;
      context.state.targets = context.getLivingEnemies().filter((enemy) => inRange(selected, enemy));
      context.state.mode = strong ? 'targetStrong' : 'targetAttack';
      context.log('攻撃対象を選択してください');
    },

    confirmTarget(cell: Point): boolean {
      const selected = context.state.selected;
      if (!selected || (context.state.mode !== 'targetAttack' && context.state.mode !== 'targetStrong')) return false;
      const target = context.state.targets.find((unit) => unit.x === cell.x && unit.y === cell.y);
      if (!target) {
        returnToMenu();
        return false;
      }
      context.state.pendingCombat = {
        attacker: selected,
        defender: target,
        firstAttackKind: context.state.mode === 'targetStrong' ? 'strong' : 'normal',
      };
      context.state.mode = 'confirmCombat';
      return true;
    },

    useConsumable(unit: Unit, slotIndex: number): void {
      const result = useInventoryConsumable(unit, slotIndex);
      context.log(result.message);
      if (result.used) context.onActionFinished();
    },
  };
}

export type PlayerActionFlow = ReturnType<typeof createPlayerActionFlow>;
