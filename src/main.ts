/**
 * Ethereal Wilds Prototype
 *
 * v10 の方針:
 * - main.ts は「ゲーム状態」「進行」「入力」「描画」の接着に寄せる。
 * - 武器・アイテム・味方ユニット・敵ユニットは data/ に外部化。
 * - 戦闘計算は logic/combat.ts、所持品処理は logic/inventory.ts、敵AIは logic/enemyAI.ts に分離。
 */

import {
  H,
  INVENTORY_SIZE,
  LOG_H,
  LOG_W,
  LOG_X,
  LOG_Y,
  MAP_X,
  MAP_Y,
  MAX_STRONG_PER_MAP,
  PANEL_X,
  PANEL_W,
  REST_ACTION_MAX,
  TILE,
  W,
  statLabels,
} from './constants';
import { battleMaps, worldNodes } from './data/maps';
import { createRewardOptions } from './logic/rewards';
import { chooseEnemyAction } from './logic/enemyAI';
import { createEnemyUnit, createItem, createPlayerUnits } from './logic/factories';
import { addExp, COMBAT_EXP, KILL_EXP, MAP_CLEAR_EXP, levelUpLog } from './logic/growth';
import { effectiveStat, getPlayerClass } from './logic/classes';
import {
  applyRuggedPathDamage,
  repairWeaponHalf,
  restExceptLookout,
  rollStatDropMasterId,
  rollWorldEvent,
} from './logic/worldEvents';
import {
  addItemToFirstEmptySlot,
  allRepairTargets,
  depositItem,
  equipWeapon,
  getEquippedWeapon,
  inventorySlots,
  isConsumable,
  isWeapon,
  useInventoryConsumable,
  withdrawItem,
} from './logic/inventory';
import {
  attackSpec,
  buildCombatPreview,
  canAffordStrike,
  canDouble,
  damageFor,
  distance,
  hitRate,
  inRange,
  roll2RN,
} from './logic/combat';
import type {
  AttackKind,
  Button,
  CombatIntent,
  InventorySlot,
  LevelUpPopup,
  MapDef,
  Mode,
  Phase,
  Point,
  PreparationMode,
  RestMode,
  RewardOption,
  Tile,
  Item,
  Unit,
  Weapon,
  WorldEventDefinition,
  WorldEventMode,
} from './types';
import {
  drawBackdrop,
  drawButton as renderButton,
  drawSectionHeader,
  drawSegmentedGauge,
  drawText as renderText,
  drawWrappedText,
  drawWindow,
} from './ui/canvas';
import { palette, typography } from './ui/theme';
import { drawHpStatus, drawLogWindow as renderLogWindow } from './ui/widgets';

// -----------------------------------------------------------------------------
// Canvas
// -----------------------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;

const WORLD_VIEWPORT_X = MAP_X + 12;
const WORLD_VIEWPORT_WIDTH = W * TILE - 24;
const WORLD_NODE_GAP = 112;
const WORLD_ROUTE_PADDING = 56;
const WORLD_CONTENT_WIDTH = WORLD_ROUTE_PADDING * 2 + (worldNodes.length - 1) * WORLD_NODE_GAP;

const drawText = (
  text: string,
  x: number,
  y: number,
  color: string = palette.text,
  size: number = typography.body,
): void => {
  renderText(ctx, text, x, y, color, size);
};

// -----------------------------------------------------------------------------
// ゲーム状態
// -----------------------------------------------------------------------------

let players = createPlayerUnits();
let enemies: Unit[] = [];
let currentTiles: Tile[][] = parseTiles(battleMaps[0]);

let phase: Phase = 'world';
let mode: Mode = 'idle';
let currentWorldIndex = 0;
let currentBattleIndex = 0;
let selected: Unit | null = null;
let selectedOrigin: Point | null = null;
let reachable: Point[] = [];
let targets: Unit[] = [];
let pendingCombat: CombatIntent | null = null;
let buttons: Button[] = [];
let logs: string[] = [];
let hover: Point | null = null;
let pointer: Point | null = null;
let runCleared = false;
let levelUpPopups: LevelUpPopup[] = [];
let restActionsLeft = REST_ACTION_MAX;
let restMode: RestMode = 'main';
let rewardOptions: RewardOption[] = [];
let selectedReward: RewardOption | null = null;
let convoy: Item[] = [];
let preparationMode: PreparationMode = 'selectUnit';
let preparationUnit: Unit | null = null;
let convoyPage = 0;
let currentEvent: WorldEventDefinition | null = null;
let eventMode: WorldEventMode = 'choice';
let eventResult = '';
let selectedBattleChoiceIndex: number | null = null;
let battleEndPopupOpen = false;
let worldScrollX = 0;

// -----------------------------------------------------------------------------
// 汎用処理
// -----------------------------------------------------------------------------

function log(message: string): void {
  logs.unshift(message);
  logs = logs.slice(0, 10);
}

function maxWorldScroll(): number {
  return Math.max(0, WORLD_CONTENT_WIDTH - WORLD_VIEWPORT_WIDTH);
}

function setWorldScroll(value: number): void {
  worldScrollX = Math.max(0, Math.min(maxWorldScroll(), value));
}

function centerWorldOnCurrentNode(): void {
  const currentNodeX = WORLD_ROUTE_PADDING + currentWorldIndex * WORLD_NODE_GAP;
  setWorldScroll(currentNodeX - WORLD_VIEWPORT_WIDTH / 2);
}

function parseTiles(mapDef: MapDef): Tile[][] {
  return mapDef.tiles.map((row) =>
    row.split('').map((cell) => (cell === 'f' ? 'forest' : cell === '#' ? 'wall' : 'plain')),
  );
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < W && y < H;
}

function tileAt(x: number, y: number): Tile {
  return currentTiles[y]?.[x] ?? 'wall';
}

function moveCost(x: number, y: number): number {
  const tile = tileAt(x, y);
  if (tile === 'wall') return 999;
  if (tile === 'forest') return 2;
  return 1;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

// -----------------------------------------------------------------------------
// ユニット検索・移動範囲
// -----------------------------------------------------------------------------

function livingPlayers(): Unit[] {
  return players.filter((unit) => !unit.unavailable && unit.hp > 0);
}

function activePlayers(): Unit[] {
  return livingPlayers().filter((unit) => !unit.acted);
}

function livingEnemies(): Unit[] {
  return enemies.filter((unit) => unit.hp > 0);
}

function allUnits(): Unit[] {
  return [...livingPlayers(), ...livingEnemies()];
}

function unitAt(x: number, y: number): Unit | null {
  return allUnits().find((unit) => unit.x === x && unit.y === y) ?? null;
}

function isPlayer(unit: Unit | null): unit is Unit {
  return !!unit && unit.team === 'player';
}

/**
 * 同陣営ユニットのマスは「通過可能・停止不可」。
 * 敵対陣営ユニットのマスは通過も停止も不可。
 */
function computeReachable(unit: Unit): Point[] {
  const bestCosts = new Map<string, number>();
  const queue: Array<{ x: number; y: number; cost: number }> = [{ x: unit.x, y: unit.y, cost: 0 }];

  bestCosts.set(`${unit.x},${unit.y}`, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = current.x + dx;
      const ny = current.y + dy;

      if (!inBounds(nx, ny) || tileAt(nx, ny) === 'wall') continue;

      const occupant = unitAt(nx, ny);
      if (occupant && occupant.id !== unit.id && occupant.team !== unit.team) continue;

      const nextCost = current.cost + moveCost(nx, ny);
      if (nextCost > unit.move) continue;

      const key = `${nx},${ny}`;
      if (!bestCosts.has(key) || nextCost < bestCosts.get(key)!) {
        bestCosts.set(key, nextCost);
        queue.push({ x: nx, y: ny, cost: nextCost });
      }
    }
  }

  // 停止できるのは、空きマスか自分の元マスだけ。
  return [...bestCosts.keys()]
    .map((key) => {
      const [x, y] = key.split(',').map(Number);
      return { x, y };
    })
    .filter((point) => {
      const occupant = unitAt(point.x, point.y);
      return !occupant || occupant.id === unit.id;
    });
}

function canStand(x: number, y: number): boolean {
  return reachable.some((point) => point.x === x && point.y === y);
}

function computeAttackCellsFromPositions(unit: Unit, positions: Point[]): Point[] {
  const weapon = getEquippedWeapon(unit);
  if (!weapon) return [];

  const cells = new Map<string, Point>();

  for (const position of positions) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (tileAt(x, y) === 'wall') continue;

        const d = distance(position, { x, y });
        if (d >= weapon.rangeMin && d <= weapon.rangeMax) {
          cells.set(`${x},${y}`, { x, y });
        }
      }
    }
  }

  return [...cells.values()];
}

function getPreviewRanges(unit: Unit, allowMove: boolean): { moveCells: Point[]; attackCells: Point[] } {
  const moveCells = allowMove ? computeReachable(unit) : [{ x: unit.x, y: unit.y }];
  const moveSet = new Set(moveCells.map(pointKey));
  const attackCells = computeAttackCellsFromPositions(unit, moveCells).filter(
    (point) => !moveSet.has(pointKey(point)),
  );

  return { moveCells, attackCells };
}

// -----------------------------------------------------------------------------
// 戦闘実処理
// -----------------------------------------------------------------------------

function consumeDurability(unit: Unit, amount: number): void {
  if (unit.team !== 'player') return;

  const weapon = getEquippedWeapon(unit);
  if (!weapon) return;

  weapon.durability = Math.max(0, weapon.durability - amount);
}

function grantExp(unit: Unit, amount: number): void {
  const popups = addExp(unit, amount);
  popups.forEach((popup) => {
    log(levelUpLog(popup));
    levelUpPopups.push(popup);
  });
}

function grantCombatExpOnce(unit: Unit, combatExpGranted: Set<string>): void {
  if (combatExpGranted.has(unit.id)) return;
  combatExpGranted.add(unit.id);
  grantExp(unit, COMBAT_EXP);
}

/** 1戦闘中にプレイヤー側が武器を振れば、基本EXPは1回だけ入る。 */
function executeStrike(
  actor: Unit,
  target: Unit,
  kind: AttackKind,
  combatExpGranted: Set<string>,
  combatInitiatorId: string,
): void {
  const spec = attackSpec(kind, actor, target);

  if (!canAffordStrike(actor, kind)) {
    log(`${actor.name}の武器耐久が足りない`);
    return;
  }

  consumeDurability(actor, spec.durabilityCost);

  if (actor.team === 'player') {
    grantCombatExpOnce(actor, combatExpGranted);
  }

  const hit = hitRate(actor, target, combatInitiatorId);
  if (!roll2RN(hit)) {
    log(`${actor.name}の${spec.label}: ${target.name}に外れた（命中${hit}%）`);
    return;
  }

  const damage = damageFor(actor, target, kind, combatInitiatorId);
  target.hp = Math.max(0, target.hp - damage);

  const details: string[] = [];
  if (kind === 'strong') details.push(`技差+${spec.skillDamageBonus}`);

  log(`${actor.name}の${spec.label}: ${target.name}に${damage}ダメージ${details.length ? `（${details.join(' / ')}）` : ''}`);

  if (target.hp <= 0) {
    defeatUnit(target);
    if (actor.team === 'player') {
      grantExp(actor, KILL_EXP);
    }
  }
}

function doCombat(intent: CombatIntent): void {
  const { attacker, defender, firstAttackKind } = intent;
  const combatExpGranted = new Set<string>();
  const combatInitiatorId = attacker.id;

  if (attacker.team === 'player' && firstAttackKind === 'strong') {
    attacker.strongLeft -= 1;
  }

  executeStrike(attacker, defender, firstAttackKind, combatExpGranted, combatInitiatorId);

  if (defender.hp > 0 && attacker.hp > 0 && inRange(defender, attacker)) {
    executeStrike(defender, attacker, 'normal', combatExpGranted, combatInitiatorId);
  }

  if (defender.hp > 0 && attacker.hp > 0 && inRange(defender, attacker) && canDouble(defender, attacker)) {
    executeStrike(defender, attacker, 'normal', combatExpGranted, combatInitiatorId);
  }

  if (attacker.hp > 0 && defender.hp > 0 && canDouble(attacker, defender)) {
    executeStrike(attacker, defender, 'normal', combatExpGranted, combatInitiatorId);
  }

  pendingCombat = null;
  checkBattleEnd();
}

function defeatUnit(unit: Unit): void {
  if (unit.team === 'player') {
    unit.unavailable = true;
    unit.acted = true;
    log(`${unit.name}は戦闘不能になり、後方へ撤退した`);
    return;
  }

  log(`${unit.name}を撃破した`);
}

// -----------------------------------------------------------------------------
// 進行管理: ワールドマップ・戦闘・休憩所
// -----------------------------------------------------------------------------

function startBattle(battleIndex: number): void {
  const map = battleMaps[battleIndex];

  currentBattleIndex = battleIndex;
  currentTiles = parseTiles(map);
  enemies = map.enemies.map(createEnemyUnit);

  const starts = [
    { x: 1, y: 2 },
    { x: 1, y: 3 },
    { x: 0, y: 2 },
    { x: 0, y: 3 },
  ];

  players.forEach((unit, index) => {
    unit.x = starts[index].x;
    unit.y = starts[index].y;
    unit.acted = unit.unavailable;
    unit.strongLeft = MAX_STRONG_PER_MAP;
  });

  phase = 'player';
  mode = 'idle';
  clearSelection();
  log('戦闘開始');
}

function startRest(): void {
  phase = 'rest';
  mode = 'idle';
  restActionsLeft = REST_ACTION_MAX;
  restMode = 'main';
  clearSelection();
  log('休憩所に到着した');
}

function returnToWorld(): void {
  phase = 'world';
  mode = 'idle';
  selectedReward = null;
  clearSelection();
  centerWorldOnCurrentNode();
}

function startPreparation(): void {
  phase = 'preparation';
  mode = 'idle';
  preparationMode = 'selectUnit';
  preparationUnit = null;
  convoyPage = 0;
  clearSelection();
  log('身支度を始めた');
}

function finishPreparation(): void {
  preparationMode = 'selectUnit';
  preparationUnit = null;
  returnToWorld();
  log('身支度を終えた');
}

function startWorldEvent(): void {
  currentEvent = rollWorldEvent();
  eventMode = 'choice';
  eventResult = '';
  phase = 'event';
  mode = 'idle';
  clearSelection();
  log(`探索イベント：${currentEvent.title}`);
}

function completeWorldEvent(message: string): void {
  eventResult = message;
  eventMode = 'resolved';
  log(message);
}

function finishWorldEvent(): void {
  currentEvent = null;
  eventResult = '';
  returnToWorld();
}

function chooseShadeLookout(lookout: Unit): void {
  const rested = restExceptLookout(players, lookout.id);
  const restedNames = rested.map((unit) => unit.name).join('、');
  completeWorldEvent(`${lookout.name}に見張りを任せて休息した。${restedNames || '他の隊員'}は十分に体を休めることができた。`);
}

function takeSpiritDrop(): void {
  const item = createItem({ category: 'consumable', masterId: rollStatDropMasterId() });
  if (!item) return;
  convoy.push(item);
  completeWorldEvent(`${item.name}を1つ入手し、輸送隊へ送った。`);
}

function takeRuggedShortcut(): void {
  applyRuggedPathDamage(players);
  players.forEach((unit) => grantExp(unit, 20));
  completeWorldEvent('険しい道を進んだ。味方全員のHPが5減少し、EXPを20獲得した。');
}

function takeRuggedDetour(): void {
  players.forEach((unit) => grantExp(unit, 10));
  completeWorldEvent('安全な迂回路を進んだ。味方全員がEXPを10獲得した。');
}

function repairCampWeapon(target: { unit: Unit; weapon: Weapon }): void {
  repairWeaponHalf(target.weapon);
  completeWorldEvent(`${target.unit.name}の${target.weapon.name}を最大耐久の50%ぶん修繕した。`);
}

function takeCampMedicine(): void {
  const item = createItem({ category: 'consumable', masterId: 'vulnerary' });
  if (!item) return;
  convoy.push(item);
  completeWorldEvent('傷薬を1個入手し、輸送隊へ送った。');
}

function chooseBattle(battleIndex: number): void {
  selectedBattleChoiceIndex = battleIndex;
  startBattle(battleIndex);
}

function advanceWorld(): void {
  if (currentWorldIndex < worldNodes.length - 1) currentWorldIndex += 1;

  const node = worldNodes[currentWorldIndex];
  if (node.type === 'battle' && node.battleIndex !== undefined) return startBattle(node.battleIndex);
  if (node.type === 'event') return startWorldEvent();
  if (node.type === 'battleChoice') {
    phase = 'battleChoice';
    mode = 'idle';
    clearSelection();
    log('進む戦場を選択してください');
    return;
  }
  if (node.type === 'rest') return startRest();
  if (node.type === 'end') {
    phase = 'result';
    runCleared = true;
    log('幽樹海・浅層探索 完了');
    return;
  }

  returnToWorld();
}

function checkBattleEnd(): void {
  if (livingEnemies().length === 0) {
    phase = 'battleEnd';
    mode = 'idle';
    clearSelection();
    log('敵全滅');
    players.forEach((unit) => grantExp(unit, MAP_CLEAR_EXP));
    log(`マップクリア：味方全員がEXP+${MAP_CLEAR_EXP}`);
    battleEndPopupOpen = true;
    return;
  }

  if (livingPlayers().length === 0) {
    phase = 'result';
    runCleared = false;
    log('探索隊は撤退した');
  }
}

function startRewardSelection(): void {
  phase = 'reward';
  mode = 'idle';
  clearSelection();
  rewardOptions = createRewardOptions(3);
  selectedReward = null;
  log('戦闘報酬を1つ選択してください');
}

function closeBattleEndPopup(): void {
  battleEndPopupOpen = false;
  worldScrollX = 0;
  if (levelUpPopups.length === 0) startRewardSelection();
}

function selectReward(option: RewardOption): void {
  selectedReward = option;
  log(`${option.name}を誰に持たせますか？`);
}

function assignRewardToUnit(unit: Unit): void {
  if (!selectedReward) return;

  const item = createItem({ category: selectedReward.category, masterId: selectedReward.itemMasterId });
  if (!item || !addItemToFirstEmptySlot(unit, item)) {
    log(`${unit.name}の所持品に空きがありません`);
    return;
  }

  log(`${unit.name}は${selectedReward.name}を受け取った`);
  rewardOptions = [];
  selectedReward = null;
  returnToWorld();
}

function assignRewardToConvoy(): void {
  if (!selectedReward) return;

  const item = createItem({ category: selectedReward.category, masterId: selectedReward.itemMasterId });
  if (!item) return;

  convoy.push(item);
  log(`${selectedReward.name}を輸送隊へ送った`);
  rewardOptions = [];
  selectedReward = null;
  returnToWorld();
}

function skipReward(): void {
  rewardOptions = [];
  selectedReward = null;
  log('報酬を受け取らずに進んだ');
  returnToWorld();
}

function finishAction(): void {
  if (selected) selected.acted = true;
  clearSelection();
  mode = 'idle';

  if (phase === 'player' && activePlayers().length === 0) beginEnemyTurn();
}

function beginEnemyTurn(): void {
  phase = 'enemy';
  mode = 'idle';
  clearSelection();
  setTimeout(runEnemyTurn, 250);
}

function endPlayerTurn(): void {
  if (phase !== 'player') return;

  livingPlayers().forEach((unit) => {
    if (!unit.acted) unit.acted = true;
  });

  clearSelection();
  mode = 'idle';
  log('ターン終了：行動可能な味方は待機した');
  beginEnemyTurn();
}

function runEnemyTurn(): void {
  for (const enemy of livingEnemies()) {
    const candidates = livingPlayers();
    if (candidates.length === 0) break;

    const decision = chooseEnemyAction(enemy, candidates, {
      width: W,
      height: H,
      units: allUnits(),
      tileAt: (point) => tileAt(point.x, point.y),
      moveCost: (point) => moveCost(point.x, point.y),
    });
    enemy.x = decision.destination.x;
    enemy.y = decision.destination.y;

    if (decision.kind === 'battle') {
      equipWeapon(enemy, decision.weapon);
      doCombat({ attacker: enemy, defender: decision.target, firstAttackKind: 'normal' });
    }

    if (phase !== 'enemy') return;
  }

  if (phase === 'enemy') {
    livingPlayers().forEach((unit) => {
      unit.acted = false;
      // 強撃回数はターンでは回復しない。マップ開始時のみ回復。
    });

    phase = 'player';
    log('自軍フェイズ');
  }
}

// -----------------------------------------------------------------------------
// 休憩所処理
// -----------------------------------------------------------------------------

function consumeRestAction(): void {
  restActionsLeft = Math.max(0, restActionsLeft - 1);
  restMode = 'main';
}

function restHeal(): void {
  if (restActionsLeft <= 0) return;

  for (const unit of livingPlayers()) {
    unit.hp = Math.min(unit.maxHp, unit.hp + Math.ceil(unit.maxHp * 0.5));
  }

  consumeRestAction();
  log('休息：出撃可能な全員のHPを回復した');
}

function restRevive(): void {
  if (restActionsLeft <= 0) return;

  const target = players.find((unit) => unit.unavailable);
  if (!target) {
    log('復帰が必要な隊員はいない');
    return;
  }

  target.unavailable = false;
  target.hp = Math.max(1, Math.ceil(target.maxHp * 0.5));
  consumeRestAction();
  log(`復帰：${target.name}が戦列に戻った`);
}

function restTrain(): void {
  if (restActionsLeft <= 0) return;

  for (const unit of livingPlayers()) grantExp(unit, 30);

  consumeRestAction();
  log('鍛錬：出撃可能な全員がEXP+30');
}

function startRepairSelection(): void {
  if (restActionsLeft <= 0) return;
  restMode = 'repairTarget';
  log('修繕する武器を選択してください');
}

function repairWeapon(target: { unit: Unit; weapon: Weapon }): void {
  if (restActionsLeft <= 0) return;

  const recover = Math.ceil(target.weapon.maxDurability * 0.5);
  target.weapon.durability = Math.min(target.weapon.maxDurability, target.weapon.durability + recover);

  consumeRestAction();
  log(`修繕：${target.unit.name}の${target.weapon.name}を修繕した`);
}

// -----------------------------------------------------------------------------
// 選択・メニュー操作
// -----------------------------------------------------------------------------

function clearSelection(): void {
  selected = null;
  selectedOrigin = null;
  reachable = [];
  targets = [];
  pendingCombat = null;
}

function cancelSelection(): void {
  if (selected && selectedOrigin) {
    selected.x = selectedOrigin.x;
    selected.y = selectedOrigin.y;
  }

  clearSelection();
  mode = 'idle';
  log('選択を解除した');
}

function returnToMenu(): void {
  targets = [];
  pendingCombat = null;
  mode = 'menu';
}

function useConsumable(unit: Unit, slotIndex: number): void {
  const result = useInventoryConsumable(unit, slotIndex);
  log(result.message);
  if (!result.used) return;
  finishAction();
}

function usePreparationConsumable(unit: Unit, slotIndex: number): void {
  const result = useInventoryConsumable(unit, slotIndex);
  log(result.message);
}

function depositPreparationItem(unit: Unit, slotIndex: number): void {
  const item = depositItem(unit, slotIndex, convoy);
  if (item) log(`${unit.name}は${item.name}を輸送隊へ預けた`);
}

function withdrawPreparationItem(unit: Unit, convoyIndex: number): void {
  const item = withdrawItem(convoy, convoyIndex, unit);
  if (!item) {
    log(`${unit.name}の所持品に空きがありません`);
    return;
  }

  log(`${unit.name}は輸送隊から${item.name}を取り出した`);
  const pageCount = Math.max(1, Math.ceil(convoy.length / 8));
  convoyPage = Math.min(convoyPage, pageCount - 1);
}

function selectTargets(strong: boolean): void {
  if (!selected) return;

  targets = livingEnemies().filter((enemy) => inRange(selected!, enemy));
  mode = strong ? 'targetStrong' : 'targetAttack';
  log('攻撃対象を選択してください');
}

function resetRun(): void {
  players = createPlayerUnits();
  enemies = [];
  currentWorldIndex = 0;
  currentBattleIndex = 0;
  phase = 'world';
  mode = 'idle';
  runCleared = false;
  levelUpPopups = [];
  restActionsLeft = REST_ACTION_MAX;
  restMode = 'main';
  rewardOptions = [];
  selectedReward = null;
  convoy = [];
  preparationMode = 'selectUnit';
  preparationUnit = null;
  convoyPage = 0;
  currentEvent = null;
  eventMode = 'choice';
  eventResult = '';
  selectedBattleChoiceIndex = null;
  battleEndPopupOpen = false;
  logs = [];
  clearSelection();
  log('探索準備完了');
}

// -----------------------------------------------------------------------------
// ボタン構築
// -----------------------------------------------------------------------------

function buildButtons(): void {
  buttons = [];

  if (phase === 'world') {
    buttons.push({
      label: worldNodes[currentWorldIndex].type === 'start' ? '探索開始' : '次へ',
      x: PANEL_X + 16,
      y: 180,
      w: 180,
      h: 36,
      action: advanceWorld,
      disabled: currentWorldIndex >= worldNodes.length - 1,
    });
    buttons.push({
      label: '身支度',
      x: PANEL_X + 16,
      y: 224,
      w: 180,
      h: 36,
      action: startPreparation,
    });
    return;
  }

  if (phase === 'preparation') {
    buildPreparationButtons();
    return;
  }

  if (phase === 'event') {
    buildWorldEventButtons();
    return;
  }

  if (phase === 'battleChoice') {
    const choices = worldNodes[currentWorldIndex].battleChoices ?? [];
    choices.forEach((choice, index) => {
      buttons.push({
        label: choice.label,
        x: PANEL_X + 16,
        y: 190 + index * 48,
        w: 300,
        h: 38,
        action: () => chooseBattle(choice.battleIndex),
      });
    });
    return;
  }

  if (phase === 'player') {
    buttons.push({
      label: 'ターン終了',
      x: PANEL_X + 246,
      y: 474,
      w: 210,
      h: 34,
      action: endPlayerTurn,
      disabled: activePlayers().length === 0,
    });
  }

  if (phase === 'reward') {
    buildRewardButtons();
    return;
  }

  if (phase === 'rest') {
    buildRestButtons();
    return;
  }

  if (phase === 'result') {
    buttons.push({ label: '最初から遊ぶ', x: PANEL_X + 16, y: 318, w: 190, h: 34, action: resetRun });
    return;
  }

  buildActionButtons();
}

function buildWorldEventButtons(): void {
  let y = 260;
  const add = (label: string, action: () => void, disabled = false): void => {
    buttons.push({ label, x: PANEL_X + 16, y, w: 360, h: 34, action, disabled });
    y += 39;
  };

  if (!currentEvent) return;

  if (eventMode === 'resolved') {
    add('探索を続ける', finishWorldEvent);
    return;
  }

  if (eventMode === 'shadeLookout') {
    players.forEach((unit) => add(`${unit.name}を見張り役にする`, () => chooseShadeLookout(unit), unit.unavailable));
    add('戻る', () => { eventMode = 'choice'; });
    return;
  }

  if (eventMode === 'campRepair') {
    const targets = allRepairTargets(players);
    targets.forEach((target) => add(
      `${target.unit.name}: ${target.weapon.name} ${target.weapon.durability}/${target.weapon.maxDurability}`,
      () => repairCampWeapon(target),
      target.weapon.durability >= target.weapon.maxDurability,
    ));
    add('戻る', () => { eventMode = 'choice'; });
    return;
  }

  if (currentEvent.id === 'smallShade') {
    add('見張り役を選ぶ', () => { eventMode = 'shadeLookout'; });
  } else if (currentEvent.id === 'spiritSpring') {
    add('雫を受け取る', takeSpiritDrop);
  } else if (currentEvent.id === 'ruggedPath') {
    add('険しい道を進む（全員HP-5 / EXP+20）', takeRuggedShortcut);
    add('安全な道を進む（全員EXP+10）', takeRuggedDetour);
  } else {
    add('武器を1本修繕する', () => { eventMode = 'campRepair'; }, allRepairTargets(players).every(({ weapon }) => weapon.durability >= weapon.maxDurability));
    add('傷薬を1個入手する', takeCampMedicine);
  }
}

function buildActionButtons(): void {
  let y = 318;
  const add = (label: string, action: () => void, disabled = false): void => {
    buttons.push({ label, x: PANEL_X + 16, y, w: 210, h: 34, action, disabled });
    y += 39;
  };

  if (mode === 'move' && selected) {
    add('やめる', cancelSelection);
    return;
  }

  if (mode === 'menu' && selected) {
    const equippedWeapon = getEquippedWeapon(selected);
    const hasConsumable = inventorySlots(selected).some(isConsumable);
    const attackable = !!equippedWeapon && livingEnemies().some((enemy) => inRange(selected!, enemy));

    add('攻撃', () => selectTargets(false), !attackable || !equippedWeapon || equippedWeapon.durability < 1);
    add(`強撃 ${selected.strongLeft}/${MAX_STRONG_PER_MAP}`, () => selectTargets(true), !attackable || !equippedWeapon || selected.strongLeft <= 0 || equippedWeapon.durability < 3);
    add('装備変更', () => { mode = 'equip'; });
    add('道具', () => { mode = 'item'; }, !hasConsumable);
    add('待機', finishAction);
    add('やめる', cancelSelection);
    return;
  }

  if (mode === 'equip' && selected) {
    for (const item of inventorySlots(selected)) {
      if (!isWeapon(item)) continue;
      const prefix = item.id === selected.equippedItemId ? '★' : '　';
      add(`${prefix}${item.name} ${item.durability}/${item.maxDurability}`, () => {
        equipWeapon(selected!, item);
        log(`${selected!.name}は${item.name}を装備した`);
        mode = 'menu';
      });
    }
    add('戻る', () => { mode = 'menu'; });
    return;
  }

  if (mode === 'item' && selected) {
    inventorySlots(selected).forEach((item, slotIndex) => {
      if (!isConsumable(item)) return;
      const disabled = item.effect === 'heal' && selected!.hp >= selected!.maxHp;
      const detail = item.effect === 'heal' ? `HP+${item.amount}` : item.stat ? `${statLabels[item.stat]}+${item.amount}` : '';
      add(`${item.name} ${detail}`, () => useConsumable(selected!, slotIndex), disabled);
    });
    add('戻る', () => { mode = 'menu'; });
    return;
  }

  if ((mode === 'targetAttack' || mode === 'targetStrong') && selected) {
    add('やめる', returnToMenu);
    return;
  }

  if (mode === 'confirmCombat' && pendingCombat) {
    const preview = buildCombatPreview(pendingCombat);
    add('戦う', () => {
      doCombat(pendingCombat!);
      finishAction();
    }, !preview.lines[0]?.available);
    add('やめる', returnToMenu);
  }
}

function buildRewardButtons(): void {
  let y = 318;
  const add = (label: string, action: () => void, disabled = false): void => {
    buttons.push({ label, x: PANEL_X + 16, y, w: 300, h: 34, action, disabled });
    y += 39;
  };

  if (!selectedReward) {
    for (const option of rewardOptions) {
      add(`[${rarityLabel(option.rarity)}] ${option.name}`, () => selectReward(option));
    }
    add('受け取らずに進む', skipReward);
    return;
  }

  for (const unit of players) {
    const emptyCount = inventorySlots(unit).filter((slot) => slot === null).length;
    add(`${unit.name}に持たせる（空き${emptyCount}）`, () => assignRewardToUnit(unit), emptyCount <= 0);
  }
  add('輸送隊へ送る', assignRewardToConvoy);
  add('報酬を選び直す', () => { selectedReward = null; });
  add('受け取らずに進む', skipReward);
}

function itemButtonLabel(item: Item): string {
  if (item.category === 'weapon') return `${item.name} ${item.durability}/${item.maxDurability}`;
  return `${item.name} x${item.uses}`;
}

function buildPreparationButtons(): void {
  let y = 190;
  const add = (label: string, action: () => void, disabled = false): void => {
    buttons.push({ label, x: PANEL_X + 16, y, w: 330, h: 34, action, disabled });
    y += 39;
  };

  if (preparationMode === 'selectUnit') {
    for (const unit of players) {
      const emptyCount = inventorySlots(unit).filter((slot) => slot === null).length;
      add(`${unit.name}（空き${emptyCount}）`, () => {
        preparationUnit = unit;
        preparationMode = 'unitMenu';
      });
    }
    add('身支度を終える', finishPreparation);
    return;
  }

  if (!preparationUnit) {
    preparationMode = 'selectUnit';
    return;
  }

  const unit = preparationUnit;

  if (preparationMode === 'unitMenu') {
    add('預ける', () => { preparationMode = 'deposit'; });
    add(`取り出す（輸送隊 ${convoy.length}個）`, () => {
      convoyPage = 0;
      preparationMode = 'withdraw';
    }, convoy.length === 0 || inventorySlots(unit).every((slot) => slot !== null));
    add('装備変更', () => { preparationMode = 'equip'; }, !inventorySlots(unit).some(isWeapon));
    add('道具を使う', () => { preparationMode = 'item'; }, !inventorySlots(unit).some(isConsumable));
    add('別のユニットを選ぶ', () => {
      preparationUnit = null;
      preparationMode = 'selectUnit';
    });
    add('身支度を終える', finishPreparation);
    return;
  }

  if (preparationMode === 'deposit') {
    inventorySlots(unit).forEach((item, slotIndex) => {
      if (!item) return;
      const mark = item.id === unit.equippedItemId ? '★' : '';
      add(`${mark}${itemButtonLabel(item)}`, () => depositPreparationItem(unit, slotIndex));
    });
    add('戻る', () => { preparationMode = 'unitMenu'; });
    return;
  }

  if (preparationMode === 'withdraw') {
    const pageSize = 8;
    const start = convoyPage * pageSize;
    convoy.slice(start, start + pageSize).forEach((item, index) => {
      add(itemButtonLabel(item), () => withdrawPreparationItem(unit, start + index));
    });
    if (convoyPage > 0) add('前のページ', () => { convoyPage -= 1; });
    if (start + pageSize < convoy.length) add('次のページ', () => { convoyPage += 1; });
    add('戻る', () => { preparationMode = 'unitMenu'; });
    return;
  }

  if (preparationMode === 'equip') {
    for (const item of inventorySlots(unit)) {
      if (!isWeapon(item)) continue;
      const mark = item.id === unit.equippedItemId ? '★' : '';
      add(`${mark}${itemButtonLabel(item)}`, () => {
        equipWeapon(unit, item);
        log(`${unit.name}は${item.name}を装備した`);
        preparationMode = 'unitMenu';
      });
    }
    add('戻る', () => { preparationMode = 'unitMenu'; });
    return;
  }

  inventorySlots(unit).forEach((item, slotIndex) => {
    if (!isConsumable(item)) return;
    const disabled = item.effect === 'heal' && (unit.unavailable || unit.hp >= unit.maxHp);
    const detail = item.effect === 'heal' ? `HP+${item.amount}` : item.stat ? `${statLabels[item.stat]}+${item.amount}` : '';
    add(`${item.name} ${detail}`, () => usePreparationConsumable(unit, slotIndex), disabled);
  });
  add('戻る', () => { preparationMode = 'unitMenu'; });
}

function buildRestButtons(): void {
  let y = 318;
  const add = (label: string, action: () => void, disabled = false): void => {
    buttons.push({ label, x: PANEL_X + 16, y, w: 300, h: 34, action, disabled });
    y += 39;
  };

  if (restActionsLeft <= 0) {
    add('休憩を終える', returnToWorld);
    return;
  }

  if (restMode === 'repairTarget') {
    for (const target of allRepairTargets(players)) {
      add(
        `${target.unit.name}: ${target.weapon.name} ${target.weapon.durability}/${target.weapon.maxDurability}`,
        () => repairWeapon(target),
        target.weapon.durability >= target.weapon.maxDurability,
      );
    }
    add('戻る', () => {
      restMode = 'main';
    });
    return;
  }

  add('休息：全員HP50%回復', restHeal, livingPlayers().length === 0);
  add('復帰：戦闘不能者を1人復帰', restRevive, !players.some((unit) => unit.unavailable));
  add('鍛錬：味方全体EXP+30', restTrain, livingPlayers().length === 0);
  add('修繕：武器を1つ50%回復', startRepairSelection);
}

// -----------------------------------------------------------------------------
// 入力
// -----------------------------------------------------------------------------

function screenToCell(mx: number, my: number): Point | null {
  const x = Math.floor((mx - MAP_X) / TILE);
  const y = Math.floor((my - MAP_Y) / TILE);
  return inBounds(x, y) ? { x, y } : null;
}

function isPopupOpen(): boolean {
  return levelUpPopups.length > 0;
}

canvas.addEventListener('wheel', (event) => {
  if (phase !== 'world') return;

  const rect = canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;
  const withinWorldMap = mx >= WORLD_VIEWPORT_X
    && mx <= WORLD_VIEWPORT_X + WORLD_VIEWPORT_WIDTH
    && my >= MAP_Y + 104
    && my <= MAP_Y + H * TILE;
  if (!withinWorldMap) return;

  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  setWorldScroll(worldScrollX + delta);
  event.preventDefault();
}, { passive: false });

canvas.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  hover = screenToCell(pointer.x, pointer.y);
  const overEnabledButton = buttons.some((button) =>
    !button.disabled
    && pointer!.x >= button.x
    && pointer!.x <= button.x + button.w
    && pointer!.y >= button.y
    && pointer!.y <= button.y + button.h,
  );
  canvas.style.cursor = overEnabledButton ? 'pointer' : 'default';
});

canvas.addEventListener('mouseleave', () => {
  hover = null;
  pointer = null;
  canvas.style.cursor = 'default';
});

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;

  if (battleEndPopupOpen) {
    closeBattleEndPopup();
    return;
  }

  if (isPopupOpen()) {
    levelUpPopups.shift();
    if (levelUpPopups.length === 0 && phase === 'battleEnd') startRewardSelection();
    return;
  }

  for (const button of buttons) {
    if (mx >= button.x && mx <= button.x + button.w && my >= button.y && my <= button.y + button.h) {
      if (!button.disabled) button.action();
      return;
    }
  }

  if (phase !== 'player') return;

  const cell = screenToCell(mx, my);
  if (!cell) return;

  const clickedUnit = unitAt(cell.x, cell.y);

  if (mode === 'idle') {
    if (isPlayer(clickedUnit) && !clickedUnit.acted && !clickedUnit.unavailable) {
      selected = clickedUnit;
      selectedOrigin = { x: clickedUnit.x, y: clickedUnit.y };
      reachable = computeReachable(clickedUnit);
      mode = 'move';
      log(`${clickedUnit.name}を選択`);
    }
    return;
  }

  if (mode === 'move') {
    if (canStand(cell.x, cell.y) && selected) {
      selected.x = cell.x;
      selected.y = cell.y;
      mode = 'menu';
      return;
    }

    cancelSelection();
    return;
  }

  if ((mode === 'targetAttack' || mode === 'targetStrong') && selected) {
    const target = targets.find((unit) => unit.x === cell.x && unit.y === cell.y);

    if (target) {
      pendingCombat = {
        attacker: selected,
        defender: target,
        firstAttackKind: mode === 'targetStrong' ? 'strong' : 'normal',
      };
      mode = 'confirmCombat';
    } else {
      returnToMenu();
    }
  }
});

// -----------------------------------------------------------------------------
// 描画: 共通
// -----------------------------------------------------------------------------

function draw(): void {
  drawBackdrop(ctx, canvas.width, canvas.height);

  drawWindow(ctx, MAP_X - 12, MAP_Y - 12, W * TILE + 24, H * TILE + 24, { inset: true });

  if (phase === 'world') drawWorldMap();
  else if (phase === 'preparation') drawPreparationScreen();
  else if (phase === 'event') drawWorldEventScreen();
  else if (phase === 'battleChoice') drawBattleChoiceScreen();
  else if (phase === 'reward') drawRewardScreen();
  else if (phase === 'rest') drawRestScreen();
  else {
    drawBattleMap();
    drawUnits();
  }

  drawLogWindow();
  drawPanel();
  drawLevelUpPopup();
  drawBattleEndPopup();
  requestAnimationFrame(draw);
}

function drawButton(button: Button): void {
  const hovered = !!pointer
    && pointer.x >= button.x
    && pointer.x <= button.x + button.w
    && pointer.y >= button.y
    && pointer.y <= button.y + button.h;
  renderButton(ctx, button, hovered);
}

function rarityLabel(rarity: RewardOption['rarity']): string {
  if (rarity === 'common') return 'コモン';
  if (rarity === 'uncommon') return 'アンコモン';
  return 'レア';
}

function rarityColor(rarity: RewardOption['rarity']): string {
  if (rarity === 'common') return palette.text;
  if (rarity === 'uncommon') return palette.blueBright;
  return palette.goldBright;
}

// -----------------------------------------------------------------------------
// 描画: ワールドマップ
// -----------------------------------------------------------------------------

function drawWorldMap(): void {
  drawText('禁足樹海 探索路', MAP_X + 166, MAP_Y + 52, palette.goldBright, typography.title);
  drawText('古道と獣道を辿り、樹海の深部を目指す。', MAP_X + 104, MAP_Y + 88, palette.textMuted, typography.body);

  const startX = WORLD_VIEWPORT_X + WORLD_ROUTE_PADDING - worldScrollX;
  const y = MAP_Y + 220;
  const gap = WORLD_NODE_GAP;
  const branchIndex = worldNodes.findIndex((node) => node.type === 'battleChoice');
  const branchOffset = 48;
  const radius = 18;

  ctx.save();
  ctx.beginPath();
  ctx.rect(WORLD_VIEWPORT_X, MAP_Y + 108, WORLD_VIEWPORT_WIDTH, H * TILE - 132);
  ctx.clip();

  const drawRoute = (fromX: number, fromY: number, toX: number, toY: number, active: boolean): void => {
    ctx.strokeStyle = palette.woodDark;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.strokeStyle = active ? palette.gold : palette.metal;
    ctx.lineWidth = active ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
  };

  for (let i = 0; i < worldNodes.length - 1; i++) {
    if (i === branchIndex - 1 || i === branchIndex) continue;
    drawRoute(startX + i * gap + radius, y, startX + (i + 1) * gap - radius, y, i < currentWorldIndex);
  }

  const branchX = startX + branchIndex * gap;
  const previousX = branchX - gap;
  const nextX = branchX + gap;
  const normalY = y - branchOffset;
  const strongY = y + branchOffset;
  const branchPassed = currentWorldIndex >= branchIndex && selectedBattleChoiceIndex !== null;
  const normalBattleIndex = worldNodes[branchIndex].battleChoices?.find((choice) => !choice.strong)?.battleIndex;
  const strongBattleIndex = worldNodes[branchIndex].battleChoices?.find((choice) => choice.strong)?.battleIndex;
  const normalSelected = branchPassed && selectedBattleChoiceIndex === normalBattleIndex;
  const strongSelected = branchPassed && selectedBattleChoiceIndex === strongBattleIndex;

  drawRoute(previousX + radius, y, branchX - radius, normalY, normalSelected);
  drawRoute(previousX + radius, y, branchX - radius, strongY, strongSelected);
  drawRoute(branchX + radius, normalY, nextX - radius, y, normalSelected && currentWorldIndex > branchIndex);
  drawRoute(branchX + radius, strongY, nextX - radius, y, strongSelected && currentWorldIndex > branchIndex);

  const drawNode = (
    x: number,
    nodeY: number,
    fill: string,
    label: string,
    isCurrent: boolean,
    isPast: boolean,
  ): void => {
    if (isCurrent) {
      ctx.beginPath();
      ctx.arc(x, nodeY, radius + 9, 0, Math.PI * 2);
      ctx.strokeStyle = palette.blueBright;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, nodeY - radius - 18);
      ctx.lineTo(x - 7, nodeY - radius - 7);
      ctx.lineTo(x + 7, nodeY - radius - 7);
      ctx.closePath();
      ctx.fillStyle = palette.blueBright;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, nodeY, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = isCurrent ? palette.goldBright : isPast ? palette.gold : palette.woodDark;
    ctx.lineWidth = isCurrent ? 4 : 2;
    ctx.stroke();
    drawText(label, x - 8, nodeY + 6, palette.text, 16);
  };

  worldNodes.forEach((node, index) => {
    if (index === branchIndex) return;
    const x = startX + index * gap;
    const isCurrent = index === currentWorldIndex;
    const fill = node.type === 'battle'
      ? palette.red
      : node.type === 'rest'
        ? palette.green
        : node.type === 'event'
          ? palette.gold
          : node.type === 'end'
            ? palette.metal
            : palette.blue;
    const label = node.type === 'battle'
      ? '戦'
      : node.type === 'event'
          ? '？'
          : node.type === 'rest'
            ? '休'
            : node.type === 'end'
              ? '終'
              : '始';
    drawNode(x, y, fill, label, isCurrent, index < currentWorldIndex);
  });

  drawNode(branchX, normalY, palette.red, '戦', currentWorldIndex === branchIndex && normalSelected, currentWorldIndex > branchIndex && normalSelected);
  drawNode(branchX, strongY, palette.purple, '強', currentWorldIndex === branchIndex && strongSelected, currentWorldIndex > branchIndex && strongSelected);

  const currentX = startX + currentWorldIndex * gap;
  const currentY = currentWorldIndex === branchIndex
    ? strongSelected ? strongY : normalY
    : y;
  drawText('現在地', currentX - 23, currentY + 52, palette.blueBright, typography.small);
  ctx.restore();

  const scrollBarY = MAP_Y + H * TILE - 18;
  const thumbWidth = Math.max(48, WORLD_VIEWPORT_WIDTH * (WORLD_VIEWPORT_WIDTH / WORLD_CONTENT_WIDTH));
  const thumbTravel = WORLD_VIEWPORT_WIDTH - thumbWidth;
  const thumbX = WORLD_VIEWPORT_X + (maxWorldScroll() > 0 ? (worldScrollX / maxWorldScroll()) * thumbTravel : 0);
  ctx.fillStyle = palette.panelInset;
  ctx.fillRect(WORLD_VIEWPORT_X, scrollBarY, WORLD_VIEWPORT_WIDTH, 8);
  ctx.strokeStyle = palette.wood;
  ctx.lineWidth = 1;
  ctx.strokeRect(WORLD_VIEWPORT_X + 0.5, scrollBarY + 0.5, WORLD_VIEWPORT_WIDTH - 1, 7);
  ctx.fillStyle = palette.gold;
  ctx.fillRect(thumbX + 1, scrollBarY + 2, thumbWidth - 2, 4);
}

function drawWorldEventScreen(): void {
  if (!currentEvent) return;

  drawText(currentEvent.title, MAP_X + 198, MAP_Y + 52, palette.goldBright, typography.title);
  drawWindow(ctx, MAP_X + 48, MAP_Y + 92, 416, 224, { inset: true });
  drawWrappedText(ctx, currentEvent.text, MAP_X + 76, MAP_Y + 130, 360, 27, palette.text, 16);

  if (eventMode === 'resolved') {
    ctx.fillStyle = 'rgba(79, 138, 89, 0.13)';
    ctx.fillRect(MAP_X + 66, MAP_Y + 235, 380, 60);
    drawWrappedText(ctx, eventResult, MAP_X + 80, MAP_Y + 258, 352, 22, palette.greenBright, 14);
  } else {
    const prompt = eventMode === 'shadeLookout'
      ? '見張り役にする隊員を選んでください。'
      : eventMode === 'campRepair'
        ? '修繕する武器を選んでください。'
        : '行動を選んでください。';
    drawText(prompt, MAP_X + 80, MAP_Y + 277, palette.blueBright, 15);
  }
}

function drawBattleChoiceScreen(): void {
  drawText('分かれ道', MAP_X + 202, MAP_Y + 52, palette.goldBright, typography.title);
  drawText('樹海の奥へ至る二つの道。進む戦場を選ぶ。', MAP_X + 92, MAP_Y + 90, palette.textMuted, typography.body);

  const choices = worldNodes[currentWorldIndex].battleChoices ?? [];
  choices.forEach((choice, index) => {
    const x = MAP_X + 54;
    const y = MAP_Y + 132 + index * 108;
    drawWindow(ctx, x, y, 404, 82, { inset: true, active: choice.strong });
    drawText(choice.label, x + 24, y + 32, choice.strong ? palette.redBright : palette.blueBright, 19);
    drawText(choice.description, x + 24, y + 59, palette.textMuted, 14);
  });
}

// -----------------------------------------------------------------------------
// 描画: 戦闘マップ
// -----------------------------------------------------------------------------

function drawBattleMap(): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = MAP_X + x * TILE;
      const sy = MAP_Y + y * TILE;
      const tile = tileAt(x, y);

      const alternating = (x + y) % 2 === 0;
      ctx.fillStyle = tile === 'forest'
        ? alternating ? palette.forest : palette.forestAlt
        : tile === 'wall'
          ? palette.wall
          : alternating ? palette.plain : palette.plainAlt;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, TILE, TILE);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.strokeRect(sx + 3, sy + 3, TILE - 6, TILE - 6);

      if (tile === 'forest') drawText('森', sx + 22, sy + 39, palette.greenBright, 15);
      if (tile === 'wall') drawText('岩', sx + 22, sy + 39, palette.textMuted, 15);
    }
  }

  drawRangePreview();

  if (mode === 'targetAttack' || mode === 'targetStrong' || mode === 'confirmCombat') {
    for (const target of targets) overlayCell(target.x, target.y, palette.target);
  }

  if (selected) drawCellOutline(selected.x, selected.y, palette.blueBright, 3);
  if (hover) overlayCell(hover.x, hover.y, palette.hover);
}

function drawRangePreview(): void {
  const hoverUnit = hover ? unitAt(hover.x, hover.y) : null;
  const previewUnit = selected ?? hoverUnit;

  if (!previewUnit || previewUnit.unavailable || previewUnit.hp <= 0) return;

  const allowMove = selected?.id === previewUnit.id ? mode === 'move' : true;
  const ranges = selected?.id === previewUnit.id && mode === 'move'
    ? (() => {
        const moveSet = new Set(reachable.map(pointKey));
        return {
          moveCells: reachable,
          attackCells: computeAttackCellsFromPositions(previewUnit, reachable).filter((point) => !moveSet.has(pointKey(point))),
        };
      })()
    : getPreviewRanges(previewUnit, allowMove);

  for (const point of ranges.attackCells) overlayCell(point.x, point.y, palette.attackRange);
  for (const point of ranges.moveCells) overlayCell(point.x, point.y, palette.moveRange);
}

function overlayCell(x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(MAP_X + x * TILE, MAP_Y + y * TILE, TILE, TILE);
}

function drawCellOutline(x: number, y: number, color: string, width: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(MAP_X + x * TILE + 3, MAP_Y + y * TILE + 3, TILE - 6, TILE - 6);
  ctx.restore();
}

function drawUnits(): void {
  for (const unit of [...livingEnemies(), ...livingPlayers()]) {
    const sx = MAP_X + unit.x * TILE + TILE / 2;
    const sy = MAP_Y + unit.y * TILE + TILE / 2;

    ctx.beginPath();
    ctx.arc(sx + 2, sy + 3, 24, 0, Math.PI * 2);
    ctx.fillStyle = palette.shadow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx, sy, 22, 0, Math.PI * 2);
    ctx.fillStyle = unit.team === 'player' ? palette.blue : palette.red;
    ctx.fill();
    ctx.strokeStyle = selected?.id === unit.id ? palette.blueBright : palette.gold;
    ctx.lineWidth = selected?.id === unit.id ? 4 : 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(sx, sy, 17, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    drawText(unit.name.slice(0, 2), sx - 16, sy + 5, palette.text, 13);

    drawSegmentedGauge(ctx, sx - 23, sy + 28, 46, 5, unit.hp, unit.maxHp, palette.greenBright, 5);
    drawText(`${unit.hp}`, sx - 8, sy + 49, palette.text, 11);

    if (unit.acted && unit.team === 'player') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(sx, sy, 23, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// -----------------------------------------------------------------------------
// 描画: 休憩所・パネル・ログ
// -----------------------------------------------------------------------------

function drawRewardScreen(): void {
  drawText('戦利品の選定', MAP_X + 178, MAP_Y + 52, palette.goldBright, typography.title);
  drawText('持ち帰る品をひとつ選び、探索隊か輸送隊へ。', MAP_X + 82, MAP_Y + 91, palette.textMuted, typography.body);

  if (!selectedReward) {
    rewardOptions.forEach((option, index) => {
      const x = MAP_X + 72;
      const y = MAP_Y + 154 + index * 58;
      ctx.fillStyle = palette.panelRaised;
      ctx.fillRect(x, y, 370, 42);
      ctx.strokeStyle = rarityColor(option.rarity);
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, y + 0.5, 369, 41);
      ctx.fillStyle = rarityColor(option.rarity);
      ctx.fillRect(x, y, 5, 42);
      drawText(`[${rarityLabel(option.rarity)}] ${option.name}`, x + 16, y + 27, rarityColor(option.rarity), 17);
    });
    return;
  }

  drawText(`選択中: [${rarityLabel(selectedReward.rarity)}] ${selectedReward.name}`, MAP_X + 98, MAP_Y + 162, rarityColor(selectedReward.rarity), 18);
  drawText('右のボタンから受取先を選んでください。', MAP_X + 98, MAP_Y + 202, palette.text, 16);
}

function drawPreparationItem(item: InventorySlot, equippedItemId: string | null): string {
  if (!item) return '-';
  if (item.category === 'weapon') {
    const mark = item.id === equippedItemId ? '★' : '';
    return `${mark}${item.name} ${item.durability}/${item.maxDurability}`;
  }
  return `${item.name} x${item.uses}`;
}

function drawPreparationScreen(): void {
  drawText('探索前の身支度', MAP_X + 164, MAP_Y + 40, palette.goldBright, typography.title);

  drawSectionHeader(ctx, `輸送隊 (${convoy.length})`, MAP_X + 14, MAP_Y + 78, 476);
  if (convoy.length === 0) {
    drawText('保管中のアイテムはありません', MAP_X + 24, MAP_Y + 108, palette.textDim, 14);
  } else {
    convoy.slice(0, 10).forEach((item, index) => {
      const x = MAP_X + 18 + (index % 2) * 250;
      const y = MAP_Y + 104 + Math.floor(index / 2) * 20;
      drawText(`${index + 1}. ${drawPreparationItem(item, null)}`, x, y, item.category === 'weapon' ? palette.blueBright : palette.greenBright, 13);
    });
    if (convoy.length > 10) drawText(`ほか ${convoy.length - 10}個`, MAP_X + 408, MAP_Y + 208, palette.textMuted, 12);
  }

  players.forEach((unit, index) => {
    const x = MAP_X + 14 + (index % 2) * 250;
    const y = MAP_Y + 226 + Math.floor(index / 2) * 94;
    const selectedMark = preparationUnit?.id === unit.id ? '▶ ' : '';
    const status = unit.unavailable ? ' [戦闘不能]' : '';
    ctx.fillStyle = preparationUnit?.id === unit.id ? 'rgba(79, 143, 201, 0.12)' : 'rgba(255,255,255,0.025)';
    ctx.fillRect(x - 6, y - 18, 230, 84);
    ctx.strokeStyle = preparationUnit?.id === unit.id ? palette.blueBright : palette.woodDark;
    ctx.strokeRect(x - 6, y - 18, 230, 84);
    drawText(`${selectedMark}${unit.name}${status}`, x, y, unit.unavailable ? palette.redBright : palette.goldBright, 15);
    inventorySlots(unit).forEach((item, slotIndex) => {
      const color = !item ? palette.textDim : item.category === 'weapon' ? palette.blueBright : palette.greenBright;
      drawText(`${slotIndex + 1}. ${drawPreparationItem(item, unit.equippedItemId)}`, x + 8, y + 18 + slotIndex * 16, color, 12);
    });
  });
}

function drawRestScreen(): void {
  drawText('樹海の野営地', MAP_X + 174, MAP_Y + 52, palette.goldBright, typography.title);
  drawText('火を囲み、次の行軍に備える。行動は二度まで。', MAP_X + 80, MAP_Y + 92, palette.textMuted, typography.body);

  const living = livingPlayers().length;
  const down = players.filter((unit) => unit.unavailable).length;
  drawText(`出撃可能 ${living}人　戦闘不能 ${down}人`, MAP_X + 154, MAP_Y + 136, down > 0 ? palette.redBright : palette.greenBright, 16);

  players.forEach((unit, index) => {
    const x = MAP_X + 18 + (index % 2) * 264;
    const y = MAP_Y + 158 + Math.floor(index / 2) * 96;
    const width = 248;
    const height = 80;

    ctx.fillStyle = unit.unavailable ? 'rgba(168, 72, 63, 0.12)' : palette.panelRaised;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = unit.unavailable ? palette.red : palette.wood;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

    drawText(unit.name, x + 14, y + 25, unit.unavailable ? palette.redBright : palette.goldBright, 16);
    drawText(unit.unavailable ? '戦闘不能' : '出撃可能', x + 164, y + 25, unit.unavailable ? palette.redBright : palette.greenBright, 13);
    drawHpStatus(ctx, unit.hp, unit.maxHp, x + 14, y + 57, width - 28);
  });
}

function drawPanel(): void {
  drawWindow(ctx, PANEL_X + 4, 8, PANEL_W - 8, canvas.height - 16);
  ctx.fillStyle = palette.brown;
  ctx.fillRect(PANEL_X + 12, 16, PANEL_W - 24, 54);
  ctx.fillStyle = palette.gold;
  ctx.fillRect(PANEL_X + 12, 68, PANEL_W - 24, 2);
  drawText('ETHEREAL WILDS', PANEL_X + 24, 43, palette.goldBright, 20);
  drawText('禁足樹海探索録', PANEL_X + 25, 62, palette.textMuted, 12);
  drawText(phaseLabel(), PANEL_X + 410, 49, palette.text, 14);

  if (phase === 'player' || phase === 'enemy') drawBattleInfoPanel();

  if (phase === 'reward') {
    drawText(selectedReward ? `${selectedReward.name}の受取先を選択` : '報酬を1つ選択', PANEL_X + 20, 112, palette.goldBright, 18);
  }

  if (phase === 'event' && currentEvent) {
    drawText(currentEvent.title, PANEL_X + 20, 112, palette.goldBright, 20);
    const status = eventMode === 'resolved'
      ? 'イベントを終えました。'
      : eventMode === 'shadeLookout'
        ? '見張り役を選択'
        : eventMode === 'campRepair'
          ? '修繕する武器を選択'
          : '選択肢を選んでください。';
    drawText(status, PANEL_X + 20, 144, palette.textMuted, 15);
  }

  if (phase === 'battleChoice') {
    drawText('第四戦の行き先', PANEL_X + 20, 112, palette.goldBright, 20);
    drawText('通常戦闘か強敵戦を選択してください。', PANEL_X + 20, 144, palette.textMuted, 15);
  }

  if (phase === 'rest') {
    drawText(`行動残り: ${restActionsLeft}/${REST_ACTION_MAX}`, PANEL_X + 20, 112, palette.goldBright, 18);
    if (restMode === 'repairTarget') drawText('修繕する武器を選択', PANEL_X + 20, 140, palette.blueBright, 16);
  }

  if (phase === 'preparation') {
    if (preparationUnit) {
      drawText(`${preparationUnit.name} / ${preparationUnit.cls}`, PANEL_X + 20, 106, palette.goldBright, 20);
      drawHpStatus(ctx, preparationUnit.hp, preparationUnit.maxHp, PANEL_X + 20, 136, 280);
      drawText(`輸送隊 ${convoy.length}個　操作: ${preparationModeLabel()}`, PANEL_X + 20, 166, palette.textMuted, 14);
    } else {
      drawText('管理するユニットを選んでください。', PANEL_X + 20, 112, palette.textMuted, 16);
      drawText(`輸送隊: ${convoy.length}個`, PANEL_X + 20, 142, palette.text, 16);
    }
  }

  if (phase === 'world') drawText('次のマスへ進んでください。', PANEL_X + 20, 112, palette.textMuted, 16);

  drawCombatPreviewPanel();
  buildButtons();
  for (const button of buttons) drawButton(button);

  if (phase === 'result') {
    const message = runCleared ? '浅層探索 完了' : '探索隊は撤退した';
    drawText(message, PANEL_X + 20, 260, runCleared ? palette.greenBright : palette.redBright, 24);
  }
}

function drawBattleInfoPanel(): void {
  const info = selected ?? (hover ? unitAt(hover.x, hover.y) ?? null : null);
  let y = 102;

  if (!info) {
    drawText('ユニットにカーソルを合わせて情報を確認', PANEL_X + 20, y + 32, palette.textMuted, 16);
    return;
  }

  drawText(`${info.name} / ${info.cls}`, PANEL_X + 20, y, palette.goldBright, 20);
  y += 28;
  drawText(`Lv ${info.level}　EXP ${info.exp}`, PANEL_X + 20, y, palette.text, 15);
  y += 26;
  drawHpStatus(ctx, info.hp, info.maxHp, PANEL_X + 20, y, 230);
  y += 30;
  drawText(
    `力${effectiveStat(info, 'str')} 魔${effectiveStat(info, 'mag')} 技${effectiveStat(info, 'skl')} 速${effectiveStat(info, 'spd')}`,
    PANEL_X + 20,
    y,
    palette.text,
    16,
  );
  y += 24;
  drawText(`守${effectiveStat(info, 'def')} 魔防${effectiveStat(info, 'res')} 移${info.move}`, PANEL_X + 20, y, palette.text, 16);
  y += 24;

  const playerClass = getPlayerClass(info);
  if (playerClass) {
    const modifier = Object.entries(playerClass.statModifiers)
      .map(([stat, amount]) => `${statLabels[stat as keyof typeof statLabels]}+${amount}`)
      .join(' ');
    drawText(`職業補正　${modifier}`, PANEL_X + 280, 102, palette.blueBright, 14);
    drawText(`技能「${playerClass.skillName}」`, PANEL_X + 280, 128, palette.goldBright, 15);
    drawText(playerClass.skillDescription, PANEL_X + 280, 150, palette.textMuted, 13);
  }

  const weapon = getEquippedWeapon(info);
  if (weapon) {
    drawText(`${weapon.name}　威力${weapon.might} 命中${weapon.hit}`, PANEL_X + 20, y, palette.blueBright, 15);
    y += 24;
    drawText(`射程${weapon.rangeMin}-${weapon.rangeMax}　耐久${weapon.durability}/${weapon.maxDurability}　強撃${info.strongLeft}/${MAX_STRONG_PER_MAP}`, PANEL_X + 20, y, palette.textMuted, 14);
  } else {
    drawText(`武器未装備　強撃 ${info.strongLeft}/${MAX_STRONG_PER_MAP}`, PANEL_X + 20, y, palette.redBright, 16);
  }

  const inventoryX = PANEL_X + 280;
  let inventoryY = 184;
  drawSectionHeader(ctx, '所持品', inventoryX, inventoryY, 226);
  inventoryY += 28;

  inventorySlots(info).forEach((item: InventorySlot, index: number) => {
    if (!item) {
      drawText(`${index + 1}. －`, inventoryX + 8, inventoryY, palette.textDim, 13);
    } else if (item.category === 'weapon') {
      const mark = item.id === info.equippedItemId ? '★' : '　';
      drawText(`${index + 1}. ${mark}${item.name} ${item.durability}/${item.maxDurability}`, inventoryX + 8, inventoryY, palette.blueBright, 13);
    } else {
      drawText(`${index + 1}. ${item.name} x${item.uses}`, inventoryX + 8, inventoryY, palette.greenBright, 13);
    }
    inventoryY += 20;
  });
}

function drawCombatPreviewPanel(): void {
  if (mode !== 'confirmCombat' || !pendingCombat) return;

  const preview = buildCombatPreview(pendingCombat);
  let y = 252;

  drawWindow(ctx, PANEL_X + 260, y - 24, 266, 188, { active: true, inset: true });

  drawText('戦闘予測', PANEL_X + 278, y + 2, palette.goldBright, 18);
  y += 26;

  for (const line of preview.lines) {
    const cost = line.actor.team === 'player' ? ` 耐久-${line.durabilityCost}` : '';
    const text = line.available
      ? `${line.label}: ${line.damage} dmg / 命中${line.hit}%${cost}`
      : `${line.label}: ${line.note}`;

    drawText(text, PANEL_X + 278, y, line.available ? palette.text : palette.textDim, 13);
    y += 23;
  }

  drawText(`最大耐久消費: ${preview.totalDurabilityCost}`, PANEL_X + 278, y + 4, palette.blueBright, 13);
}

function drawLogWindow(): void {
  renderLogWindow(ctx, logs, LOG_X, LOG_Y, LOG_W, LOG_H);
}

function drawLevelUpPopup(): void {
  const popup = levelUpPopups[0];
  if (!popup) return;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const w = 380;
  const h = 190;
  const x = MAP_X + (W * TILE - w) / 2;
  const y = MAP_Y + 82;

  drawWindow(ctx, x, y, w, h, { active: true });

  drawText('LEVEL UP', x + 126, y + 42, palette.goldBright, 24);
  drawText(`${popup.unitName}　Lv ${popup.level}`, x + 34, y + 76, palette.text, 18);

  popup.gains.forEach((gain, index) => {
    const gx = x + 46 + (index % 3) * 108;
    const gy = y + 110 + Math.floor(index / 3) * 30;
    drawText(`${gain.label} +${gain.amount}`, gx, gy, palette.greenBright, 17);
  });

  const remaining = levelUpPopups.length - 1;
  drawText(remaining > 0 ? `クリックで次へ（残り ${remaining}）` : 'クリックで閉じる', x + 112, y + h - 18, palette.textMuted, 14);
}

function drawBattleEndPopup(): void {
  if (!battleEndPopupOpen) return;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const width = 430;
  const height = 180;
  const x = MAP_X + (W * TILE - width) / 2;
  const y = MAP_Y + 112;
  drawWindow(ctx, x, y, width, height, { active: true });
  drawText('戦闘終了', x + 153, y + 48, palette.goldBright, 26);
  drawText('勝利ボーナス：全員がEXP+30を獲得', x + 58, y + 96, palette.greenBright, 17);
  drawText('クリックで次に進む', x + 137, y + 142, palette.textMuted, 15);
}

function phaseLabel(): string {
  if (phase === 'world') return 'ワールドマップ';
  if (phase === 'preparation') return '身支度';
  if (phase === 'event') return '探索イベント';
  if (phase === 'battleChoice') return '戦場選択';
  if (phase === 'player') return '自軍';
  if (phase === 'enemy') return '敵軍';
  if (phase === 'battleEnd') return '戦闘終了';
  if (phase === 'reward') return '戦闘報酬';
  if (phase === 'rest') return '休憩所';
  return '結果';
}

function preparationModeLabel(): string {
  if (preparationMode === 'unitMenu') return 'メニュー';
  if (preparationMode === 'deposit') return '預ける';
  if (preparationMode === 'withdraw') return `取り出す ${convoyPage + 1}ページ`;
  if (preparationMode === 'equip') return '装備変更';
  if (preparationMode === 'item') return '道具を使う';
  return 'ユニット選択';
}

// -----------------------------------------------------------------------------
// 起動
// -----------------------------------------------------------------------------

resetRun();
draw();
