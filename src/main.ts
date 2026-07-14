import { H, LOG_H, LOG_W, LOG_X, LOG_Y, MAP_X, MAP_Y, TILE, W } from './constants';
import { worldNodes } from './data/maps';
import { createBattleFlow, type BattleFlow } from './game/battleFlow';
import { createPlayerActionFlow } from './game/playerActionFlow';
import { createPreparationFlow } from './game/preparationFlow';
import { giveRewardToConvoy, giveRewardToUnit } from './game/rewardFlow';
import { createRestFlow } from './game/restFlow';
import { createGameState } from './game/state';
import {
  createBattleUiState,
  createPopupUiState,
  createPreparationUiState,
  createRestUiState,
  createRewardUiState,
  createWorldEventUiState,
} from './game/uiState';
import { advanceWorldNode } from './game/worldFlow';
import { createWorldEventFlow } from './game/worldEventFlow';
import { registerCanvasInput } from './input/canvasInput';
import { addExp, levelUpLog } from './logic/growth';
import { equipWeapon } from './logic/inventory';
import { createMapQueries } from './logic/map';
import { createRewardOptions } from './logic/rewards';
import type { Button, Point, RewardOption, Unit } from './types';
import { buildButtons as createButtons } from './ui/buttons';
import { drawBackdrop, drawWindow } from './ui/canvas';
import { drawSidePanel } from './ui/panel';
import {
  drawBattleEndPopup as renderBattleEndPopup,
  drawLevelUpPopup as renderLevelUpPopup,
} from './ui/popups';
import { drawBattleScene } from './ui/screens/battleMap';
import {
  drawBattleChoiceScreen as renderBattleChoiceScreen,
  drawPreparationScreen as renderPreparationScreen,
  drawRestScreen as renderRestScreen,
  drawRewardScreen as renderRewardScreen,
  drawWorldEventScreen as renderWorldEventScreen,
} from './ui/screens/management';
import {
  drawWorldMap as renderWorldMap,
  maxWorldScroll,
  worldScrollForNode,
} from './ui/screens/worldMap';
import { drawLogWindow as renderLogWindow } from './ui/widgets';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;

let game = createGameState();
const battleUi = createBattleUiState();
const restUi = createRestUiState();
const preparationUi = createPreparationUiState();
const eventUi = createWorldEventUiState();
const rewardUi = createRewardUiState();
const popupUi = createPopupUiState();
let buttons: Button[] = [];
let logs: string[] = [];
let hover: Point | null = null;
let pointer: Point | null = null;
let worldScrollX = 0;

function log(message: string): void {
  logs.unshift(message);
  logs = logs.slice(0, 10);
}

function setWorldScroll(value: number): void {
  worldScrollX = Math.max(0, Math.min(maxWorldScroll(), value));
}

function centerWorldOnCurrentNode(): void {
  setWorldScroll(worldScrollForNode(game.currentWorldIndex));
}

function livingPlayers(): Unit[] {
  return game.players.filter((unit) => !unit.unavailable && unit.hp > 0);
}

function activePlayers(): Unit[] {
  return livingPlayers().filter((unit) => !unit.acted);
}

function livingEnemies(): Unit[] {
  return game.enemies.filter((unit) => unit.hp > 0);
}

function allUnits(): Unit[] {
  return [...livingPlayers(), ...livingEnemies()];
}

const mapQueries = createMapQueries(W, H, () => game.currentTiles, allUnits);

function grantExp(unit: Unit, amount: number): void {
  addExp(unit, amount).forEach((popup) => {
    log(levelUpLog(popup));
    popupUi.levelUps.push(popup);
  });
}

function returnToWorld(): void {
  game.phase = 'world';
  battleUi.mode = 'idle';
  rewardUi.selected = null;
  playerActionFlow.clearSelection();
  centerWorldOnCurrentNode();
}

function startRewardSelection(): void {
  game.phase = 'reward';
  battleUi.mode = 'idle';
  playerActionFlow.clearSelection();
  rewardUi.options = createRewardOptions(3);
  rewardUi.selected = null;
  log('戦闘報酬を1つ選択してください');
}

let battleFlow: BattleFlow;

const playerActionFlow = createPlayerActionFlow({
  state: battleUi,
  map: mapQueries,
  getLivingEnemies: livingEnemies,
  onActionFinished: () => battleFlow.finishAction(),
  log,
});

const restFlow = createRestFlow({
  getGame: () => game,
  battleUi,
  restUi,
  grantExp,
  clearSelection: playerActionFlow.clearSelection,
  log,
});

const preparationFlow = createPreparationFlow({
  getGame: () => game,
  battleUi,
  preparationUi,
  clearSelection: playerActionFlow.clearSelection,
  returnToWorld,
  log,
});

const worldEventFlow = createWorldEventFlow({
  getGame: () => game,
  battleUi,
  eventUi,
  grantExp,
  clearSelection: playerActionFlow.clearSelection,
  returnToWorld,
  log,
});

battleFlow = createBattleFlow({
  getGame: () => game,
  battleUi,
  popupUi,
  map: mapQueries,
  grantExp,
  clearSelection: playerActionFlow.clearSelection,
  startRewardSelection,
  resetWorldScroll: () => { worldScrollX = 0; },
  log,
});

function chooseBattle(battleIndex: number): void {
  game.selectedBattleChoiceIndex = battleIndex;
  battleFlow.start(battleIndex);
}

function advanceWorld(): void {
  const node = advanceWorldNode(game);
  if (node.type === 'battle' && node.battleIndex !== undefined) return battleFlow.start(node.battleIndex);
  if (node.type === 'event') return worldEventFlow.start();
  if (node.type === 'battleChoice') {
    game.phase = 'battleChoice';
    battleUi.mode = 'idle';
    playerActionFlow.clearSelection();
    log('進む戦場を選択してください');
    return;
  }
  if (node.type === 'rest') return restFlow.start();
  if (node.type === 'end') {
    game.phase = 'result';
    game.runCleared = true;
    log('幽樹海・浅層探索 完了');
    return;
  }
  returnToWorld();
}

function selectReward(option: RewardOption): void {
  rewardUi.selected = option;
  log(`${option.name}を誰に持たせますか？`);
}

function assignRewardToUnit(unit: Unit): void {
  if (!rewardUi.selected) return;
  if (!giveRewardToUnit(rewardUi.selected, unit)) {
    log(`${unit.name}の所持品に空きがありません`);
    return;
  }
  log(`${unit.name}は${rewardUi.selected.name}を受け取った`);
  rewardUi.options = [];
  rewardUi.selected = null;
  returnToWorld();
}

function assignRewardToConvoy(): void {
  if (!rewardUi.selected) return;
  if (!giveRewardToConvoy(rewardUi.selected, game.convoy)) return;
  log(`${rewardUi.selected.name}を輸送隊へ送った`);
  rewardUi.options = [];
  rewardUi.selected = null;
  returnToWorld();
}

function skipReward(): void {
  rewardUi.options = [];
  rewardUi.selected = null;
  log('報酬を受け取らずに進んだ');
  returnToWorld();
}

function resetRun(): void {
  game = createGameState();
  Object.assign(battleUi, createBattleUiState());
  Object.assign(restUi, createRestUiState());
  Object.assign(preparationUi, createPreparationUiState());
  Object.assign(eventUi, createWorldEventUiState());
  Object.assign(rewardUi, createRewardUiState());
  Object.assign(popupUi, createPopupUiState());
  logs = [];
  playerActionFlow.clearSelection();
  log('探索準備完了');
}

function buildButtons(): void {
  buttons = createButtons({
    phase: game.phase,
    currentWorldIndex: game.currentWorldIndex,
    mode: battleUi.mode,
    selected: battleUi.selected,
    pendingCombat: battleUi.pendingCombat,
    livingEnemies: livingEnemies(),
    players: game.players,
    currentEvent: eventUi.event,
    eventMode: eventUi.mode,
    rewardOptions: rewardUi.options,
    selectedReward: rewardUi.selected,
    convoy: game.convoy,
    preparationMode: preparationUi.mode,
    preparationUnit: preparationUi.unit,
    convoyPage: preparationUi.convoyPage,
    restActionsLeft: restUi.actionsLeft,
    restMode: restUi.mode,
    activePlayerCount: activePlayers().length,
  }, {
    advanceWorld,
    startPreparation: preparationFlow.start,
    chooseBattle,
    endPlayerTurn: battleFlow.endPlayerTurn,
    resetRun,
    finishWorldEvent: worldEventFlow.finish,
    chooseShadeLookout: worldEventFlow.chooseShadeLookout,
    takeSpiritDrop: worldEventFlow.takeSpiritDrop,
    takeRuggedShortcut: worldEventFlow.takeRuggedShortcut,
    takeRuggedDetour: worldEventFlow.takeRuggedDetour,
    repairCampWeapon: worldEventFlow.repairCampWeapon,
    takeCampMedicine: worldEventFlow.takeCampMedicine,
    setEventMode: worldEventFlow.setMode,
    cancelSelection: playerActionFlow.cancelSelection,
    selectTargets: playerActionFlow.selectTargets,
    setMode: playerActionFlow.setMode,
    finishAction: battleFlow.finishAction,
    equipBattleWeapon: (weapon) => {
      if (!battleUi.selected) return;
      equipWeapon(battleUi.selected, weapon);
      log(`${battleUi.selected.name}は${weapon.name}を装備した`);
      battleUi.mode = 'menu';
    },
    useConsumable: playerActionFlow.useConsumable,
    returnToMenu: playerActionFlow.returnToMenu,
    executePendingCombat: () => {
      if (!battleUi.pendingCombat) return;
      battleFlow.resolve(battleUi.pendingCombat);
      battleFlow.finishAction();
    },
    selectReward,
    assignRewardToUnit,
    assignRewardToConvoy,
    clearSelectedReward: () => { rewardUi.selected = null; },
    skipReward,
    setPreparationUnit: preparationFlow.setUnit,
    setPreparationMode: preparationFlow.setMode,
    setConvoyPage: preparationFlow.setConvoyPage,
    finishPreparation: preparationFlow.finish,
    depositPreparationItem: preparationFlow.deposit,
    withdrawPreparationItem: preparationFlow.withdraw,
    equipPreparationWeapon: (unit, weapon) => {
      equipWeapon(unit, weapon);
      log(`${unit.name}は${weapon.name}を装備した`);
      preparationUi.mode = 'unitMenu';
    },
    usePreparationConsumable: preparationFlow.useConsumable,
    returnToWorld,
    restHeal: restFlow.heal,
    restRevive: restFlow.revive,
    restTrain: restFlow.train,
    startRepairSelection: restFlow.startRepairSelection,
    repairWeapon: restFlow.repair,
    setRestMode: restFlow.setMode,
  });
}

function screenToCell(mx: number, my: number): Point | null {
  const x = Math.floor((mx - MAP_X) / TILE);
  const y = Math.floor((my - MAP_Y) / TILE);
  return mapQueries.inBounds(x, y) ? { x, y } : null;
}

function handleCanvasClick(mx: number, my: number): void {
  if (popupUi.battleEndOpen) {
    battleFlow.closeBattleEndPopup();
    return;
  }
  if (popupUi.levelUps.length > 0) {
    popupUi.levelUps.shift();
    if (popupUi.levelUps.length === 0 && game.phase === 'battleEnd') startRewardSelection();
    return;
  }
  for (const button of buttons) {
    if (mx >= button.x && mx <= button.x + button.w && my >= button.y && my <= button.y + button.h) {
      if (!button.disabled) button.action();
      return;
    }
  }
  if (game.phase !== 'player') return;
  const cell = screenToCell(mx, my);
  if (!cell) return;
  const clickedUnit = mapQueries.unitAt(cell.x, cell.y);

  if (battleUi.mode === 'idle') {
    playerActionFlow.selectUnit(clickedUnit);
  } else if (battleUi.mode === 'move') {
    playerActionFlow.chooseMove(cell);
  } else if (battleUi.mode === 'targetAttack' || battleUi.mode === 'targetStrong') {
    playerActionFlow.confirmTarget(cell);
  }
}

registerCanvasInput(canvas, {
  getPhase: () => game.phase,
  getButtons: () => buttons,
  screenToCell,
  onPointerMove: (nextPointer, nextHover) => {
    pointer = nextPointer;
    hover = nextHover;
  },
  onPointerLeave: () => {
    hover = null;
    pointer = null;
  },
  onWorldScroll: (delta) => setWorldScroll(worldScrollX + delta),
  onClick: handleCanvasClick,
});

function draw(): void {
  drawBackdrop(ctx, canvas.width, canvas.height);
  drawWindow(ctx, MAP_X - 12, MAP_Y - 12, W * TILE + 24, H * TILE + 24, { inset: true });

  if (game.phase === 'world') renderWorldMap(ctx, game.currentWorldIndex, game.selectedBattleChoiceIndex, worldScrollX);
  else if (game.phase === 'preparation') renderPreparationScreen(ctx, game.convoy, game.players, preparationUi.unit);
  else if (game.phase === 'event') renderWorldEventScreen(ctx, eventUi.event, eventUi.mode, eventUi.result);
  else if (game.phase === 'battleChoice') renderBattleChoiceScreen(ctx, worldNodes[game.currentWorldIndex].battleChoices ?? []);
  else if (game.phase === 'reward') renderRewardScreen(ctx, rewardUi.options, rewardUi.selected);
  else if (game.phase === 'rest') renderRestScreen(ctx, game.players);
  else {
    drawBattleScene(ctx, {
      mode: battleUi.mode,
      selected: battleUi.selected,
      hover,
      reachable: battleUi.reachable,
      targets: battleUi.targets,
      players: game.players,
      enemies: game.enemies,
      map: mapQueries,
    });
  }

  renderLogWindow(ctx, logs, LOG_X, LOG_Y, LOG_W, LOG_H);
  buildButtons();
  drawSidePanel(ctx, {
    canvasHeight: canvas.height,
    phase: game.phase,
    mode: battleUi.mode,
    selected: battleUi.selected,
    hover,
    pendingCombat: battleUi.pendingCombat,
    map: mapQueries,
    selectedReward: rewardUi.selected,
    currentEvent: eventUi.event,
    eventMode: eventUi.mode,
    restActionsLeft: restUi.actionsLeft,
    restMode: restUi.mode,
    preparationUnit: preparationUi.unit,
    preparationMode: preparationUi.mode,
    convoyPage: preparationUi.convoyPage,
    convoyLength: game.convoy.length,
    runCleared: game.runCleared,
    buttons,
    pointer,
  });
  renderLevelUpPopup(ctx, canvas.width, canvas.height, popupUi.levelUps);
  renderBattleEndPopup(ctx, canvas.width, canvas.height, popupUi.battleEndOpen);
  requestAnimationFrame(draw);
}

resetRun();
draw();
