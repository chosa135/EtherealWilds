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
  REST_ACTION_MAX,
  TILE,
  W,
  statLabels,
} from './constants';
import { battleMaps, worldNodes } from './data/maps';
import { createRewardOptions } from './logic/rewards';
import { chooseEnemyAttackTarget, chooseEnemyMoveDestination } from './logic/enemyAI';
import { createEnemyUnit, createItem, createPlayerUnits } from './logic/factories';
import { addExp, COMBAT_EXP, KILL_EXP, MAP_CLEAR_EXP, levelUpLog } from './logic/growth';
import { effectiveStat, getPlayerClass } from './logic/classes';
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
} from './types';

// -----------------------------------------------------------------------------
// Canvas
// -----------------------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;

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

// -----------------------------------------------------------------------------
// 汎用処理
// -----------------------------------------------------------------------------

function log(message: string): void {
  logs.unshift(message);
  logs = logs.slice(0, 10);
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

function advanceWorld(): void {
  if (currentWorldIndex < worldNodes.length - 1) currentWorldIndex += 1;

  const node = worldNodes[currentWorldIndex];
  if (node.type === 'battle' && node.battleIndex !== undefined) return startBattle(node.battleIndex);
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
    log('敵全滅');
    players.forEach((unit) => grantExp(unit, MAP_CLEAR_EXP));
    log(`マップクリア：味方全員がEXP+${MAP_CLEAR_EXP}`);
    startRewardSelection();
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

    let target = chooseEnemyAttackTarget(enemy, candidates);
    if (!target) {
      const destination = chooseEnemyMoveDestination(enemy, candidates, computeReachable(enemy));
      enemy.x = destination.x;
      enemy.y = destination.y;
      target = chooseEnemyAttackTarget(enemy, candidates);
    }

    if (target) {
      doCombat({ attacker: enemy, defender: target, firstAttackKind: 'normal' });
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

  if (phase === 'player') {
    buttons.push({
      label: 'ターン終了',
      x: PANEL_X + 310,
      y: 78,
      w: 128,
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

canvas.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect();
  hover = screenToCell(event.clientX - rect.left, event.clientY - rect.top);
});

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;

  if (isPopupOpen()) {
    levelUpPopups.shift();
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
  ctx.fillStyle = '#151916';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (phase === 'world') drawWorldMap();
  else if (phase === 'preparation') drawPreparationScreen();
  else if (phase === 'reward') drawRewardScreen();
  else if (phase === 'rest') drawRestScreen();
  else {
    drawBattleMap();
    drawUnits();
  }

  drawLogWindow();
  drawPanel();
  drawLevelUpPopup();
  requestAnimationFrame(draw);
}

function drawText(text: string, x: number, y: number, color: string, size: number): void {
  ctx.fillStyle = color;
  ctx.font = `${size}px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillText(text, x, y);
}

function drawButton(button: Button): void {
  ctx.fillStyle = button.disabled ? '#454545' : '#344d36';
  ctx.fillRect(button.x, button.y, button.w, button.h);
  ctx.strokeStyle = '#91b48e';
  ctx.strokeRect(button.x, button.y, button.w, button.h);
  drawText(button.label, button.x + 10, button.y + 23, button.disabled ? '#aaa' : '#fff', 14);
}

function rarityLabel(rarity: RewardOption['rarity']): string {
  if (rarity === 'common') return 'コモン';
  if (rarity === 'uncommon') return 'アンコモン';
  return 'レア';
}

function rarityColor(rarity: RewardOption['rarity']): string {
  if (rarity === 'common') return '#e8e8e8';
  if (rarity === 'uncommon') return '#9bd4ff';
  return '#fff36a';
}

// -----------------------------------------------------------------------------
// 描画: ワールドマップ
// -----------------------------------------------------------------------------

function drawWorldMap(): void {
  drawText('WORLD MAP', MAP_X + 176, MAP_Y + 54, '#f0ead2', 24);
  drawText('一本道の探索路。次のマスへ進んでください。', MAP_X + 84, MAP_Y + 92, '#cde6c7', 16);

  const startX = MAP_X + 62;
  const y = MAP_Y + 220;
  const gap = 54;

  for (let i = 0; i < worldNodes.length - 1; i++) {
    ctx.strokeStyle = '#7b806f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(startX + i * gap + 18, y);
    ctx.lineTo(startX + (i + 1) * gap - 18, y);
    ctx.stroke();
  }

  worldNodes.forEach((node, index) => {
    const x = startX + index * gap;
    const radius = 18;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = node.type === 'battle' ? '#b94242' : node.type === 'rest' ? '#3f8d64' : node.type === 'end' ? '#777' : '#4a5d7a';
    ctx.fill();

    ctx.strokeStyle = index === currentWorldIndex ? '#ff3b3b' : '#222';
    ctx.lineWidth = index === currentWorldIndex ? 5 : 2;
    ctx.stroke();

    const label = node.type === 'battle' ? '戦' : node.type === 'rest' ? '休' : node.type === 'end' ? '終' : '始';
    drawText(label, x - 8, y + 6, '#fff', 16);
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

      ctx.fillStyle = tile === 'forest' ? '#29452d' : tile === 'wall' ? '#4a4a4a' : '#253326';
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.strokeStyle = '#556052';
      ctx.strokeRect(sx, sy, TILE, TILE);

      if (tile === 'forest') drawText('森', sx + 20, sy + 38, '#cfe8ca', 16);
      if (tile === 'wall') drawText('岩', sx + 20, sy + 38, '#ddd', 16);
    }
  }

  drawRangePreview();

  if (mode === 'targetAttack' || mode === 'targetStrong' || mode === 'confirmCombat') {
    for (const target of targets) overlayCell(target.x, target.y, 'rgba(255,90,80,0.42)');
  }

  if (hover) overlayCell(hover.x, hover.y, 'rgba(255,255,255,0.12)');
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

  for (const point of ranges.attackCells) overlayCell(point.x, point.y, 'rgba(255,90,80,0.23)');
  for (const point of ranges.moveCells) overlayCell(point.x, point.y, 'rgba(80,150,255,0.28)');
}

function overlayCell(x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(MAP_X + x * TILE, MAP_Y + y * TILE, TILE, TILE);
}

function drawUnits(): void {
  for (const unit of [...livingEnemies(), ...livingPlayers()]) {
    const sx = MAP_X + unit.x * TILE + TILE / 2;
    const sy = MAP_Y + unit.y * TILE + TILE / 2;

    ctx.beginPath();
    ctx.arc(sx, sy, 22, 0, Math.PI * 2);
    ctx.fillStyle = unit.team === 'player' ? '#7fb7ff' : '#ff7f7f';
    ctx.fill();

    ctx.strokeStyle = selected?.id === unit.id ? '#fff36a' : '#101010';
    ctx.lineWidth = selected?.id === unit.id ? 4 : 2;
    ctx.stroke();

    drawText(unit.name.slice(0, 2), sx - 16, sy + 5, '#111', 14);

    ctx.fillStyle = '#222';
    ctx.fillRect(sx - 23, sy + 27, 46, 6);
    ctx.fillStyle = '#66e083';
    ctx.fillRect(sx - 23, sy + 27, 46 * (unit.hp / unit.maxHp), 6);
    drawText(`${unit.hp}`, sx - 10, sy + 48, '#fff', 12);

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
  drawText('BATTLE REWARD', MAP_X + 155, MAP_Y + 62, '#f0ead2', 24);
  drawText('3つの候補から1つ選び、味方か輸送隊へ送ります。', MAP_X + 64, MAP_Y + 104, '#cde6c7', 16);

  if (!selectedReward) {
    rewardOptions.forEach((option, index) => {
      const x = MAP_X + 72;
      const y = MAP_Y + 154 + index * 58;
      ctx.fillStyle = 'rgba(18, 24, 18, 0.88)';
      ctx.fillRect(x, y, 370, 42);
      ctx.strokeStyle = rarityColor(option.rarity);
      ctx.strokeRect(x, y, 370, 42);
      drawText(`[${rarityLabel(option.rarity)}] ${option.name}`, x + 16, y + 27, rarityColor(option.rarity), 17);
    });
    return;
  }

  drawText(`選択中: [${rarityLabel(selectedReward.rarity)}] ${selectedReward.name}`, MAP_X + 98, MAP_Y + 162, rarityColor(selectedReward.rarity), 18);
  drawText('右のボタンから受取先を選んでください。', MAP_X + 98, MAP_Y + 202, '#ffffff', 16);
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
  drawText('PREPARATION', MAP_X + 172, MAP_Y + 40, '#f0ead2', 24);

  drawText(`輸送隊 (${convoy.length})`, MAP_X + 14, MAP_Y + 78, '#fff36a', 18);
  if (convoy.length === 0) {
    drawText('保管中のアイテムはありません', MAP_X + 24, MAP_Y + 104, '#888', 14);
  } else {
    convoy.slice(0, 10).forEach((item, index) => {
      const x = MAP_X + 18 + (index % 2) * 250;
      const y = MAP_Y + 104 + Math.floor(index / 2) * 20;
      drawText(`${index + 1}. ${drawPreparationItem(item, null)}`, x, y, item.category === 'weapon' ? '#d8e7ff' : '#cde6c7', 13);
    });
    if (convoy.length > 10) drawText(`ほか ${convoy.length - 10}個`, MAP_X + 408, MAP_Y + 208, '#aaa', 12);
  }

  players.forEach((unit, index) => {
    const x = MAP_X + 14 + (index % 2) * 250;
    const y = MAP_Y + 226 + Math.floor(index / 2) * 94;
    const selectedMark = preparationUnit?.id === unit.id ? '▶ ' : '';
    const status = unit.unavailable ? ' [戦闘不能]' : '';
    drawText(`${selectedMark}${unit.name}${status}`, x, y, unit.unavailable ? '#ffb0b0' : '#ffffff', 15);
    inventorySlots(unit).forEach((item, slotIndex) => {
      const color = !item ? '#777' : item.category === 'weapon' ? '#d8e7ff' : '#cde6c7';
      drawText(`${slotIndex + 1}. ${drawPreparationItem(item, unit.equippedItemId)}`, x + 8, y + 18 + slotIndex * 16, color, 12);
    });
  });
}

function drawRestScreen(): void {
  drawText('REST SPOT', MAP_X + 185, MAP_Y + 62, '#f0ead2', 24);
  drawText('休息・復帰・鍛錬・修繕から2回行動できます。', MAP_X + 80, MAP_Y + 104, '#cde6c7', 16);

  const living = livingPlayers().length;
  const down = players.filter((unit) => unit.unavailable).length;
  drawText(`出撃可能: ${living}人`, MAP_X + 150, MAP_Y + 168, '#fff', 18);
  drawText(`戦闘不能: ${down}人`, MAP_X + 150, MAP_Y + 202, down > 0 ? '#ffb0b0' : '#fff', 18);
}

function drawPanel(): void {
  ctx.fillStyle = '#20271f';
  ctx.fillRect(PANEL_X, 0, 550, canvas.height);

  drawText('Ethereal Wilds Prototype', PANEL_X + 16, 32, '#f0ead2', 22);
  drawText(`フェイズ: ${phaseLabel()}`, PANEL_X + 16, 62, '#ffffff', 16);

  if (phase === 'player' || phase === 'enemy') drawBattleInfoPanel();

  if (phase === 'reward') {
    drawText(selectedReward ? `${selectedReward.name}の受取先を選択` : '報酬を1つ選択', PANEL_X + 16, 106, '#fff36a', 18);
  }

  if (phase === 'rest') {
    drawText(`行動残り: ${restActionsLeft}/${REST_ACTION_MAX}`, PANEL_X + 16, 106, '#fff36a', 18);
    if (restMode === 'repairTarget') drawText('修繕する武器を選択', PANEL_X + 16, 134, '#d8e7ff', 16);
  }

  if (phase === 'preparation') {
    if (preparationUnit) {
      drawText(`${preparationUnit.name} / ${preparationUnit.cls}`, PANEL_X + 16, 102, '#fff36a', 20);
      drawText(`HP ${preparationUnit.hp}/${preparationUnit.maxHp}  輸送隊 ${convoy.length}個`, PANEL_X + 16, 130, '#ffffff', 16);
      drawText(`操作: ${preparationModeLabel()}`, PANEL_X + 16, 156, '#cde6c7', 15);
    } else {
      drawText('管理するユニットを選んでください。', PANEL_X + 16, 106, '#cde6c7', 16);
      drawText(`輸送隊: ${convoy.length}個`, PANEL_X + 16, 136, '#ffffff', 16);
    }
  }

  if (phase === 'world') drawText('次のマスへ進んでください。', PANEL_X + 16, 106, '#cde6c7', 16);

  drawCombatPreviewPanel();
  buildButtons();
  for (const button of buttons) drawButton(button);

  if (phase === 'result') {
    const message = runCleared ? '浅層探索 完了' : '探索隊は撤退した';
    drawText(message, PANEL_X + 16, 260, runCleared ? '#a9ffb0' : '#ffb0b0', 24);
  }
}

function drawBattleInfoPanel(): void {
  const info = selected ?? (hover ? unitAt(hover.x, hover.y) ?? null : null);
  let y = 92;

  if (!info) {
    drawText('自軍ユニットを選択してください', PANEL_X + 16, y + 32, '#ddd', 16);
    return;
  }

  drawText(`${info.name} / ${info.cls}`, PANEL_X + 16, y, '#fff36a', 20);
  y += 28;
  drawText(`Lv${info.level} EXP${info.exp}  HP ${info.hp}/${info.maxHp}`, PANEL_X + 16, y, '#fff', 16);
  y += 24;
  drawText(
    `力${effectiveStat(info, 'str')} 魔${effectiveStat(info, 'mag')} 技${effectiveStat(info, 'skl')} 速${effectiveStat(info, 'spd')}`,
    PANEL_X + 16,
    y,
    '#fff',
    16,
  );
  y += 24;
  drawText(`守${effectiveStat(info, 'def')} 魔防${effectiveStat(info, 'res')} 移${info.move}`, PANEL_X + 16, y, '#fff', 16);
  y += 24;

  const playerClass = getPlayerClass(info);
  if (playerClass) {
    const modifier = Object.entries(playerClass.statModifiers)
      .map(([stat, amount]) => `${statLabels[stat as keyof typeof statLabels]}+${amount}`)
      .join(' ');
    drawText(`職業補正: ${modifier}`, PANEL_X + 270, 96, '#d8e7ff', 14);
    drawText(`スキル「${playerClass.skillName}」`, PANEL_X + 270, 120, '#fff36a', 15);
    drawText(playerClass.skillDescription, PANEL_X + 270, 142, '#cde6c7', 13);
  }

  const weapon = getEquippedWeapon(info);
  if (weapon) {
    drawText(`${weapon.name} 威力${weapon.might} 命中${weapon.hit} 射程${weapon.rangeMin}-${weapon.rangeMax}`, PANEL_X + 16, y, '#d8e7ff', 16);
    y += 24;
    drawText(`耐久 ${weapon.durability}/${weapon.maxDurability}  強撃 ${info.strongLeft}/${MAX_STRONG_PER_MAP}`, PANEL_X + 16, y, '#d8e7ff', 16);
  } else {
    drawText(`武器未装備  強撃 ${info.strongLeft}/${MAX_STRONG_PER_MAP}`, PANEL_X + 16, y, '#ffb0b0', 16);
  }

  y += 30;
  drawText('所持品', PANEL_X + 16, y, '#f0ead2', 16);
  y += 22;

  inventorySlots(info).forEach((item: InventorySlot, index: number) => {
    if (!item) {
      drawText(`${index + 1}. -`, PANEL_X + 24, y, '#888', 14);
    } else if (item.category === 'weapon') {
      const mark = item.id === info.equippedItemId ? '★' : '　';
      drawText(`${index + 1}. ${mark}${item.name} ${item.durability}/${item.maxDurability}`, PANEL_X + 24, y, '#d8e7ff', 14);
    } else {
      drawText(`${index + 1}. ${item.name} x${item.uses}`, PANEL_X + 24, y, '#cde6c7', 14);
    }
    y += 20;
  });
}

function drawCombatPreviewPanel(): void {
  if (mode !== 'confirmCombat' || !pendingCombat) return;

  const preview = buildCombatPreview(pendingCombat);
  let y = 252;

  ctx.fillStyle = 'rgba(10, 14, 12, 0.55)';
  ctx.fillRect(PANEL_X + 260, y - 24, 266, 188);
  ctx.strokeStyle = '#91b48e';
  ctx.strokeRect(PANEL_X + 260, y - 24, 266, 188);

  drawText('戦闘予測', PANEL_X + 274, y, '#fff36a', 18);
  y += 26;

  for (const line of preview.lines) {
    const cost = line.actor.team === 'player' ? ` 耐久-${line.durabilityCost}` : '';
    const text = line.available
      ? `${line.label}: ${line.damage} dmg / 命中${line.hit}%${cost}`
      : `${line.label}: ${line.note}`;

    drawText(text, PANEL_X + 274, y, line.available ? '#fff' : '#aaa', 13);
    y += 23;
  }

  drawText(`最大耐久消費: ${preview.totalDurabilityCost}`, PANEL_X + 274, y + 4, '#d8e7ff', 13);
}

function drawLogWindow(): void {
  ctx.fillStyle = '#182018';
  ctx.fillRect(LOG_X, LOG_Y, LOG_W, LOG_H);
  ctx.strokeStyle = '#91b48e';
  ctx.strokeRect(LOG_X, LOG_Y, LOG_W, LOG_H);

  drawText('ログ', LOG_X + 14, LOG_Y + 26, '#f0ead2', 18);

  let y = LOG_Y + 54;
  for (const message of logs) {
    drawText(message, LOG_X + 14, y, '#e8e8e8', 14);
    y += 20;
  }
}

function drawLevelUpPopup(): void {
  const popup = levelUpPopups[0];
  if (!popup) return;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const w = 380;
  const h = 190;
  const x = MAP_X + (W * TILE - w) / 2;
  const y = MAP_Y + 82;

  ctx.fillStyle = 'rgba(18, 24, 18, 0.96)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#f0ead2';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  drawText('LEVEL UP', x + 126, y + 38, '#fff36a', 24);
  drawText(`${popup.unitName}  Lv ${popup.level}`, x + 34, y + 72, '#ffffff', 18);

  popup.gains.forEach((gain, index) => {
    const gx = x + 46 + (index % 3) * 108;
    const gy = y + 110 + Math.floor(index / 3) * 30;
    drawText(`${gain.label} +${gain.amount}`, gx, gy, '#cde6c7', 17);
  });

  const remaining = levelUpPopups.length - 1;
  drawText(remaining > 0 ? `クリックで次へ（残り ${remaining}）` : 'クリックで閉じる', x + 118, y + h - 18, '#e8e8e8', 14);
}

function phaseLabel(): string {
  if (phase === 'world') return 'ワールドマップ';
  if (phase === 'preparation') return '身支度';
  if (phase === 'player') return '自軍';
  if (phase === 'enemy') return '敵軍';
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
