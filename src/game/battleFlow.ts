import { H, W } from '../constants';
import { chooseEnemyAction } from '../logic/enemyAI';
import { resolveCombat } from '../logic/combatResolution';
import { equipWeapon } from '../logic/inventory';
import { MAP_CLEAR_EXP } from '../logic/growth';
import type { MapQueries } from '../logic/map';
import type { CombatIntent, Unit } from '../types';
import type { GameState } from './state';
import type { BattleUiState, PopupUiState } from './uiState';
import { enterBattle } from './worldFlow';

export type BattleFlowContext = {
  getGame: () => GameState;
  battleUi: BattleUiState;
  popupUi: PopupUiState;
  map: MapQueries;
  grantExp: (unit: Unit, amount: number) => void;
  clearSelection: () => void;
  startRewardSelection: () => void;
  resetWorldScroll: () => void;
  log: (message: string) => void;
  schedule?: (callback: () => void, delay: number) => void;
};

export function createBattleFlow(context: BattleFlowContext) {
  const schedule = context.schedule ?? ((callback, delay) => { setTimeout(callback, delay); });
  const livingPlayers = (): Unit[] => context.getGame().players.filter((unit) => !unit.unavailable && unit.hp > 0);
  const activePlayers = (): Unit[] => livingPlayers().filter((unit) => !unit.acted);
  const livingEnemies = (): Unit[] => context.getGame().enemies.filter((unit) => unit.hp > 0);
  const allUnits = (): Unit[] => [...livingPlayers(), ...livingEnemies()];

  const checkBattleEnd = (): void => {
    const game = context.getGame();
    if (livingEnemies().length === 0) {
      game.phase = 'battleEnd';
      context.battleUi.mode = 'idle';
      context.clearSelection();
      context.log('敵全滅');
      game.players.forEach((unit) => context.grantExp(unit, MAP_CLEAR_EXP));
      context.log(`マップクリア：味方全員がEXP+${MAP_CLEAR_EXP}`);
      context.popupUi.battleEndOpen = true;
      return;
    }
    if (livingPlayers().length === 0) {
      game.phase = 'result';
      game.runCleared = false;
      context.log('探索隊は撤退した');
    }
  };

  const resolve = (intent: CombatIntent): void => {
    resolveCombat(intent, { grantExp: context.grantExp, log: context.log });
    context.battleUi.pendingCombat = null;
    checkBattleEnd();
  };

  const returnToPlayerPhase = (): void => {
    livingPlayers().forEach((unit) => {
      unit.acted = false;
    });
    context.getGame().phase = 'player';
    context.log('自軍フェイズ');
  };

  const runEnemyTurn = (): void => {
    const game = context.getGame();
    for (const enemy of livingEnemies()) {
      const candidates = livingPlayers();
      if (candidates.length === 0) break;

      const decision = chooseEnemyAction(enemy, candidates, {
        width: W,
        height: H,
        units: allUnits(),
        tileAt: (point) => context.map.tileAt(point.x, point.y),
        moveCost: (point) => context.map.moveCost(point.x, point.y),
      });
      enemy.x = decision.destination.x;
      enemy.y = decision.destination.y;
      if (decision.kind === 'battle') {
        equipWeapon(enemy, decision.weapon);
        resolve({ attacker: enemy, defender: decision.target, firstAttackKind: 'normal' });
      }
      if (game.phase !== 'enemy') return;
    }
    if (game.phase === 'enemy') returnToPlayerPhase();
  };

  const beginEnemyTurn = (): void => {
    context.getGame().phase = 'enemy';
    context.battleUi.mode = 'idle';
    context.clearSelection();
    schedule(runEnemyTurn, 250);
  };

  return {
    start(battleIndex: number): void {
      enterBattle(context.getGame(), battleIndex);
      context.battleUi.mode = 'idle';
      context.clearSelection();
      context.log('戦闘開始');
    },

    resolve,
    checkBattleEnd,
    beginEnemyTurn,
    runEnemyTurn,
    returnToPlayerPhase,

    finishAction(): void {
      if (context.battleUi.selected) context.battleUi.selected.acted = true;
      context.clearSelection();
      context.battleUi.mode = 'idle';
      if (context.getGame().phase === 'player' && activePlayers().length === 0) beginEnemyTurn();
    },

    endPlayerTurn(): void {
      if (context.getGame().phase !== 'player') return;
      livingPlayers().forEach((unit) => {
        if (!unit.acted) unit.acted = true;
      });
      context.clearSelection();
      context.battleUi.mode = 'idle';
      context.log('ターン終了：行動可能な味方は待機した');
      beginEnemyTurn();
    },

    closeBattleEndPopup(): void {
      context.popupUi.battleEndOpen = false;
      context.resetWorldScroll();
      if (context.popupUi.levelUps.length === 0) context.startRewardSelection();
    },
  };
}

export type BattleFlow = ReturnType<typeof createBattleFlow>;
