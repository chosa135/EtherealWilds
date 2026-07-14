import { MAX_STRONG_PER_MAP, PANEL_X, statLabels } from '../constants';
import { worldNodes } from '../data/maps';
import { buildCombatPreview, inRange } from '../logic/combat';
import { allRepairTargets, getEquippedWeapon, inventorySlots, isConsumable, isWeapon } from '../logic/inventory';
import type {
  Button,
  CombatIntent,
  Item,
  Mode,
  Phase,
  PreparationMode,
  RestMode,
  RewardOption,
  Unit,
  Weapon,
  WorldEventDefinition,
  WorldEventMode,
} from '../types';
import { rarityLabel } from './labels';

export type ButtonViewState = {
  phase: Phase;
  currentWorldIndex: number;
  mode: Mode;
  selected: Unit | null;
  pendingCombat: CombatIntent | null;
  livingEnemies: Unit[];
  players: Unit[];
  currentEvent: WorldEventDefinition | null;
  eventMode: WorldEventMode;
  rewardOptions: RewardOption[];
  selectedReward: RewardOption | null;
  convoy: Item[];
  preparationMode: PreparationMode;
  preparationUnit: Unit | null;
  convoyPage: number;
  restActionsLeft: number;
  restMode: RestMode;
  activePlayerCount: number;
};

export type ButtonActions = {
  advanceWorld: () => void;
  startPreparation: () => void;
  chooseBattle: (battleIndex: number) => void;
  endPlayerTurn: () => void;
  resetRun: () => void;
  finishWorldEvent: () => void;
  chooseShadeLookout: (unit: Unit) => void;
  takeSpiritDrop: () => void;
  takeRuggedShortcut: () => void;
  takeRuggedDetour: () => void;
  repairCampWeapon: (target: { unit: Unit; weapon: Weapon }) => void;
  takeCampMedicine: () => void;
  setEventMode: (mode: WorldEventMode) => void;
  cancelSelection: () => void;
  selectTargets: (strong: boolean) => void;
  setMode: (mode: Mode) => void;
  finishAction: () => void;
  equipBattleWeapon: (weapon: Weapon) => void;
  useConsumable: (unit: Unit, slotIndex: number) => void;
  returnToMenu: () => void;
  executePendingCombat: () => void;
  selectReward: (option: RewardOption) => void;
  assignRewardToUnit: (unit: Unit) => void;
  assignRewardToConvoy: () => void;
  clearSelectedReward: () => void;
  skipReward: () => void;
  setPreparationUnit: (unit: Unit | null) => void;
  setPreparationMode: (mode: PreparationMode) => void;
  setConvoyPage: (page: number) => void;
  finishPreparation: () => void;
  depositPreparationItem: (unit: Unit, slotIndex: number) => void;
  withdrawPreparationItem: (unit: Unit, convoyIndex: number) => void;
  equipPreparationWeapon: (unit: Unit, weapon: Weapon) => void;
  usePreparationConsumable: (unit: Unit, slotIndex: number) => void;
  returnToWorld: () => void;
  restHeal: () => void;
  restRevive: () => void;
  restTrain: () => void;
  startRepairSelection: () => void;
  repairWeapon: (target: { unit: Unit; weapon: Weapon }) => void;
  setRestMode: (mode: RestMode) => void;
};

export function buildButtons(view: ButtonViewState, actions: ButtonActions): Button[] {
  if (view.phase === 'world') return buildWorldButtons(view, actions);
  if (view.phase === 'preparation') return buildPreparationButtons(view, actions);
  if (view.phase === 'event') return buildEventButtons(view, actions);
  if (view.phase === 'battleChoice') return buildBattleChoiceButtons(view, actions);
  if (view.phase === 'reward') return buildRewardButtons(view, actions);
  if (view.phase === 'rest') return buildRestButtons(view, actions);
  if (view.phase === 'result') return [{ label: '最初から遊ぶ', x: PANEL_X + 16, y: 318, w: 190, h: 34, action: actions.resetRun }];

  const buttons = view.phase === 'player'
    ? [{ label: 'ターン終了', x: PANEL_X + 246, y: 474, w: 210, h: 34, action: actions.endPlayerTurn, disabled: view.activePlayerCount === 0 }]
    : [];
  return [...buttons, ...buildActionButtons(view, actions)];
}

function buildWorldButtons(view: ButtonViewState, actions: ButtonActions): Button[] {
  return [
    {
      label: worldNodes[view.currentWorldIndex].type === 'start' ? '探索開始' : '次へ',
      x: PANEL_X + 16, y: 180, w: 180, h: 36,
      action: actions.advanceWorld,
      disabled: view.currentWorldIndex >= worldNodes.length - 1,
    },
    { label: '身支度', x: PANEL_X + 16, y: 224, w: 180, h: 36, action: actions.startPreparation },
  ];
}

function buildBattleChoiceButtons(view: ButtonViewState, actions: ButtonActions): Button[] {
  return (worldNodes[view.currentWorldIndex].battleChoices ?? []).map((choice, index) => ({
    label: choice.label, x: PANEL_X + 16, y: 190 + index * 48, w: 300, h: 38,
    action: () => actions.chooseBattle(choice.battleIndex),
  }));
}

function buildEventButtons(view: ButtonViewState, actions: ButtonActions): Button[] {
  const buttons: Button[] = [];
  let y = 260;
  const add = (label: string, action: () => void, disabled = false): void => {
    buttons.push({ label, x: PANEL_X + 16, y, w: 360, h: 34, action, disabled });
    y += 39;
  };
  if (!view.currentEvent) return buttons;
  if (view.eventMode === 'resolved') add('探索を続ける', actions.finishWorldEvent);
  else if (view.eventMode === 'shadeLookout') {
    view.players.forEach((unit) => add(`${unit.name}を見張り役にする`, () => actions.chooseShadeLookout(unit), unit.unavailable));
    add('戻る', () => actions.setEventMode('choice'));
  } else if (view.eventMode === 'campRepair') {
    allRepairTargets(view.players).forEach((target) => add(
      `${target.unit.name}: ${target.weapon.name} ${target.weapon.durability}/${target.weapon.maxDurability}`,
      () => actions.repairCampWeapon(target),
      target.weapon.durability >= target.weapon.maxDurability,
    ));
    add('戻る', () => actions.setEventMode('choice'));
  } else if (view.currentEvent.id === 'smallShade') add('見張り役を選ぶ', () => actions.setEventMode('shadeLookout'));
  else if (view.currentEvent.id === 'spiritSpring') add('雫を受け取る', actions.takeSpiritDrop);
  else if (view.currentEvent.id === 'ruggedPath') {
    add('険しい道を進む（全員HP-5 / EXP+20）', actions.takeRuggedShortcut);
    add('安全な道を進む（全員EXP+10）', actions.takeRuggedDetour);
  } else {
    add('武器を1本修繕する', () => actions.setEventMode('campRepair'), allRepairTargets(view.players).every(({ weapon }) => weapon.durability >= weapon.maxDurability));
    add('傷薬を1個入手する', actions.takeCampMedicine);
  }
  return buttons;
}

function buildActionButtons(view: ButtonViewState, actions: ButtonActions): Button[] {
  const buttons: Button[] = [];
  let y = 318;
  const add = (label: string, action: () => void, disabled = false): void => {
    buttons.push({ label, x: PANEL_X + 16, y, w: 210, h: 34, action, disabled });
    y += 39;
  };
  if (view.mode === 'move' && view.selected) add('やめる', actions.cancelSelection);
  else if (view.mode === 'menu' && view.selected) {
    const weapon = getEquippedWeapon(view.selected);
    const attackable = !!weapon && view.livingEnemies.some((enemy) => inRange(view.selected!, enemy));
    add('攻撃', () => actions.selectTargets(false), !attackable || !weapon || weapon.durability < 1);
    add(`強撃 ${view.selected.strongLeft}/${MAX_STRONG_PER_MAP}`, () => actions.selectTargets(true), !attackable || !weapon || view.selected.strongLeft <= 0 || weapon.durability < 3);
    add('装備変更', () => actions.setMode('equip'));
    add('道具', () => actions.setMode('item'), !inventorySlots(view.selected).some(isConsumable));
    add('待機', actions.finishAction);
    add('やめる', actions.cancelSelection);
  } else if (view.mode === 'equip' && view.selected) {
    inventorySlots(view.selected).filter(isWeapon).forEach((weapon) => {
      const prefix = weapon.id === view.selected!.equippedItemId ? '★' : '　';
      add(`${prefix}${weapon.name} ${weapon.durability}/${weapon.maxDurability}`, () => actions.equipBattleWeapon(weapon));
    });
    add('戻る', () => actions.setMode('menu'));
  } else if (view.mode === 'item' && view.selected) {
    inventorySlots(view.selected).forEach((item, slotIndex) => {
      if (!isConsumable(item)) return;
      const detail = item.effect === 'heal' ? `HP+${item.amount}` : item.stat ? `${statLabels[item.stat]}+${item.amount}` : '';
      add(`${item.name} ${detail}`, () => actions.useConsumable(view.selected!, slotIndex), item.effect === 'heal' && view.selected!.hp >= view.selected!.maxHp);
    });
    add('戻る', () => actions.setMode('menu'));
  } else if ((view.mode === 'targetAttack' || view.mode === 'targetStrong') && view.selected) add('やめる', actions.returnToMenu);
  else if (view.mode === 'confirmCombat' && view.pendingCombat) {
    add('戦う', actions.executePendingCombat, !buildCombatPreview(view.pendingCombat).lines[0]?.available);
    add('やめる', actions.returnToMenu);
  }
  return buttons;
}

function buildRewardButtons(view: ButtonViewState, actions: ButtonActions): Button[] {
  const buttons: Button[] = [];
  let y = 318;
  const add = (label: string, action: () => void, disabled = false): void => {
    buttons.push({ label, x: PANEL_X + 16, y, w: 300, h: 34, action, disabled });
    y += 39;
  };
  if (!view.selectedReward) {
    view.rewardOptions.forEach((option) => add(`[${rarityLabel(option.rarity)}] ${option.name}`, () => actions.selectReward(option)));
    add('受け取らずに進む', actions.skipReward);
  } else {
    view.players.forEach((unit) => {
      const emptyCount = inventorySlots(unit).filter((slot) => slot === null).length;
      add(`${unit.name}に持たせる（空き${emptyCount}）`, () => actions.assignRewardToUnit(unit), emptyCount <= 0);
    });
    add('輸送隊へ送る', actions.assignRewardToConvoy);
    add('報酬を選び直す', actions.clearSelectedReward);
    add('受け取らずに進む', actions.skipReward);
  }
  return buttons;
}

function itemLabel(item: Item): string {
  return item.category === 'weapon' ? `${item.name} ${item.durability}/${item.maxDurability}` : `${item.name} x${item.uses}`;
}

function buildPreparationButtons(view: ButtonViewState, actions: ButtonActions): Button[] {
  const buttons: Button[] = [];
  let y = 190;
  const add = (label: string, action: () => void, disabled = false): void => {
    buttons.push({ label, x: PANEL_X + 16, y, w: 330, h: 34, action, disabled });
    y += 39;
  };
  if (view.preparationMode === 'selectUnit') {
    view.players.forEach((unit) => {
      const emptyCount = inventorySlots(unit).filter((slot) => slot === null).length;
      add(`${unit.name}（空き${emptyCount}）`, () => {
        actions.setPreparationUnit(unit);
        actions.setPreparationMode('unitMenu');
      });
    });
    add('身支度を終える', actions.finishPreparation);
    return buttons;
  }
  if (!view.preparationUnit) return buttons;
  const unit = view.preparationUnit;
  if (view.preparationMode === 'unitMenu') {
    add('預ける', () => actions.setPreparationMode('deposit'));
    add(`取り出す（輸送隊 ${view.convoy.length}個）`, () => {
      actions.setConvoyPage(0);
      actions.setPreparationMode('withdraw');
    }, view.convoy.length === 0 || inventorySlots(unit).every((slot) => slot !== null));
    add('装備変更', () => actions.setPreparationMode('equip'), !inventorySlots(unit).some(isWeapon));
    add('道具を使う', () => actions.setPreparationMode('item'), !inventorySlots(unit).some(isConsumable));
    add('別のユニットを選ぶ', () => {
      actions.setPreparationUnit(null);
      actions.setPreparationMode('selectUnit');
    });
    add('身支度を終える', actions.finishPreparation);
  } else if (view.preparationMode === 'deposit') {
    inventorySlots(unit).forEach((item, slotIndex) => {
      if (item) add(`${item.id === unit.equippedItemId ? '★' : ''}${itemLabel(item)}`, () => actions.depositPreparationItem(unit, slotIndex));
    });
    add('戻る', () => actions.setPreparationMode('unitMenu'));
  } else if (view.preparationMode === 'withdraw') {
    const start = view.convoyPage * 8;
    view.convoy.slice(start, start + 8).forEach((item, index) => add(itemLabel(item), () => actions.withdrawPreparationItem(unit, start + index)));
    if (view.convoyPage > 0) add('前のページ', () => actions.setConvoyPage(view.convoyPage - 1));
    if (start + 8 < view.convoy.length) add('次のページ', () => actions.setConvoyPage(view.convoyPage + 1));
    add('戻る', () => actions.setPreparationMode('unitMenu'));
  } else if (view.preparationMode === 'equip') {
    inventorySlots(unit).filter(isWeapon).forEach((weapon) => add(
      `${weapon.id === unit.equippedItemId ? '★' : ''}${itemLabel(weapon)}`,
      () => actions.equipPreparationWeapon(unit, weapon),
    ));
    add('戻る', () => actions.setPreparationMode('unitMenu'));
  } else {
    inventorySlots(unit).forEach((item, slotIndex) => {
      if (!isConsumable(item)) return;
      const detail = item.effect === 'heal' ? `HP+${item.amount}` : item.stat ? `${statLabels[item.stat]}+${item.amount}` : '';
      add(`${item.name} ${detail}`, () => actions.usePreparationConsumable(unit, slotIndex), item.effect === 'heal' && (unit.unavailable || unit.hp >= unit.maxHp));
    });
    add('戻る', () => actions.setPreparationMode('unitMenu'));
  }
  return buttons;
}

function buildRestButtons(view: ButtonViewState, actions: ButtonActions): Button[] {
  const buttons: Button[] = [];
  let y = 318;
  const add = (label: string, action: () => void, disabled = false): void => {
    buttons.push({ label, x: PANEL_X + 16, y, w: 300, h: 34, action, disabled });
    y += 39;
  };
  if (view.restActionsLeft <= 0) add('休憩を終える', actions.returnToWorld);
  else if (view.restMode === 'repairTarget') {
    allRepairTargets(view.players).forEach((target) => add(
      `${target.unit.name}: ${target.weapon.name} ${target.weapon.durability}/${target.weapon.maxDurability}`,
      () => actions.repairWeapon(target),
      target.weapon.durability >= target.weapon.maxDurability,
    ));
    add('戻る', () => actions.setRestMode('main'));
  } else {
    add('休息：全員HP50%回復', actions.restHeal, view.players.every((unit) => unit.unavailable || unit.hp <= 0));
    add('復帰：戦闘不能者を1人復帰', actions.restRevive, !view.players.some((unit) => unit.unavailable));
    add('鍛錬：味方全体EXP+30', actions.restTrain, view.players.every((unit) => unit.unavailable || unit.hp <= 0));
    add('修繕：武器を1つ50%回復', actions.startRepairSelection);
  }
  return buttons;
}
