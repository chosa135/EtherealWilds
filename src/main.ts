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
import {
  addItemToFirstEmptySlot,
  allRepairTargets,
  equipWeapon,
  getEquippedWeapon,
  getFirstUsablePotion,
  inventorySlots,
  isConsumable,
  isWeapon,
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
  RestMode,
  RewardOption,
  StatKey,
  Tile,
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
// 成長・EXP
// -----------------------------------------------------------------------------

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

function addExp(unit: Unit, amount: number): void {
  if (unit.team !== 'player' || unit.unavailable) return;

  unit.exp += amount;
  while (unit.exp >= 100) {
    unit.exp -= 100;
    levelUp(unit);
  }
}

function levelUp(unit: Unit): void {
  unit.level += 1;
  unit.maxHp += 1;
  unit.hp += 1;

  const gains: Partial<Record<StatKey, number>> = {};
  for (let i = 0; i < 3; i++) {
    const stat = weightedStat(unit.growth);
    unit[stat] += 1;
    gains[stat] = (gains[stat] ?? 0) + 1;
  }

  const gainedStats = Object.entries(gains).map(([key, amount]) => ({
    label: statLabels[key as StatKey],
    amount: amount as number,
  }));

  log(`${unit.name} Lv${unit.level}: HP+1 / ${gainedStats.map((gain) => `${gain.label}+${gain.amount}`).join(' / ')}`);
  levelUpPopups.push({
    unitName: unit.name,
    level: unit.level,
    gains: [{ label: 'HP', amount: 1 }, ...gainedStats],
  });
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

/** 攻撃・反撃・追撃のどれでも、プレイヤー側が武器を振ればEXPが入る。 */
function executeStrike(actor: Unit, target: Unit, kind: AttackKind): void {
  const spec = attackSpec(kind, actor, target);

  if (!canAffordStrike(actor, kind)) {
    log(`${actor.name}の武器耐久が足りない`);
    return;
  }

  consumeDurability(actor, spec.durabilityCost);

  if (actor.team === 'player') {
    addExp(actor, 5);
  }

  const hit = hitRate(actor, target);
  if (!roll2RN(hit)) {
    log(`${actor.name}の${spec.label}: ${target.name}に外れた（命中${hit}%）`);
    return;
  }

  const damage = damageFor(actor, target, kind);
  target.hp = Math.max(0, target.hp - damage);

  const details: string[] = [];
  if (kind === 'strong') details.push(`技差+${spec.skillDamageBonus}`);

  log(`${actor.name}の${spec.label}: ${target.name}に${damage}ダメージ${details.length ? `（${details.join(' / ')}）` : ''}`);

  if (target.hp <= 0) {
    defeatUnit(target);
    if (actor.team === 'player') addExp(actor, 30);
  }
}

function doCombat(intent: CombatIntent): void {
  const { attacker, defender, firstAttackKind } = intent;

  if (attacker.team === 'player' && firstAttackKind === 'strong') {
    attacker.strongLeft -= 1;
  }

  executeStrike(attacker, defender, firstAttackKind);

  if (defender.hp > 0 && attacker.hp > 0 && inRange(defender, attacker)) {
    executeStrike(defender, attacker, 'normal');
  }

  if (defender.hp > 0 && attacker.hp > 0 && inRange(defender, attacker) && canDouble(defender, attacker)) {
    executeStrike(defender, attacker, 'normal');
  }

  if (attacker.hp > 0 && defender.hp > 0 && canDouble(attacker, defender)) {
    executeStrike(attacker, defender, 'normal');
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

    if (phase === 'result' || phase === 'world') return;
  }

  if (phase !== 'result' && phase !== 'world') {
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

  for (const unit of livingPlayers()) addExp(unit, 30);

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

function usePotion(unit: Unit): void {
  const potion = getFirstUsablePotion(unit);
  if (!potion) {
    log('傷薬がない');
    return;
  }

  if (unit.hp >= unit.maxHp) {
    log('HPは満タン');
    return;
  }

  potion.item.uses -= 1;
  unit.hp = Math.min(unit.maxHp, unit.hp + potion.item.amount);
  if (potion.item.uses <= 0) unit.inventory[potion.slotIndex] = null;

  log(`${unit.name}は傷薬で回復した`);
  finishAction();
}

function useConsumable(unit: Unit, slotIndex: number): void {
  const item = inventorySlots(unit)[slotIndex];
  if (!isConsumable(item)) return;

  if (item.effect === 'heal') {
    if (unit.hp >= unit.maxHp) {
      log('HPは満タン');
      return;
    }

    unit.hp = Math.min(unit.maxHp, unit.hp + item.amount);
    log(`${unit.name}は${item.name}でHPを${item.amount}回復した`);
  } else if (item.effect === 'statBoost' && item.stat) {
    unit[item.stat] += item.amount;
    log(`${unit.name}は${item.name}で${statLabels[item.stat]}+${item.amount}`);
  }

  item.uses -= 1;
  if (item.uses <= 0) unit.inventory[slotIndex] = null;
  finishAction();
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
  add('報酬を選び直す', () => { selectedReward = null; });
  add('受け取らずに進む', skipReward);
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
  drawText('3つの候補から1つ選び、空き所持品欄のある味方に渡します。', MAP_X + 48, MAP_Y + 104, '#cde6c7', 16);

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
  drawText('右のボタンから受け取るユニットを選んでください。', MAP_X + 78, MAP_Y + 202, '#ffffff', 16);
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
  drawText(`力${info.str} 魔${info.mag} 技${info.skl} 速${info.spd}`, PANEL_X + 16, y, '#fff', 16);
  y += 24;
  drawText(`守${info.def} 魔防${info.res} 移${info.move}`, PANEL_X + 16, y, '#fff', 16);
  y += 24;

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
  if (phase === 'player') return '自軍';
  if (phase === 'enemy') return '敵軍';
  if (phase === 'reward') return '戦闘報酬';
  if (phase === 'rest') return '休憩所';
  return '結果';
}

// -----------------------------------------------------------------------------
// 起動
// -----------------------------------------------------------------------------

resetRun();
draw();
