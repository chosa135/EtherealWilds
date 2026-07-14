import { MAX_STRONG_PER_MAP, PANEL_W, PANEL_X, REST_ACTION_MAX, statLabels } from '../constants';
import { effectiveStat, getPlayerClass } from '../logic/classes';
import { buildCombatPreview } from '../logic/combat';
import { getEquippedWeapon, inventorySlots } from '../logic/inventory';
import type { MapQueries } from '../logic/map';
import type { Button, CombatIntent, Mode, Phase, Point, PreparationMode, RestMode, RewardOption, Unit, WorldEventDefinition, WorldEventMode } from '../types';
import { drawButton, drawSectionHeader, drawText, drawWindow } from './canvas';
import { palette } from './theme';
import { drawHpStatus } from './widgets';

export type SidePanelView = {
  canvasHeight: number;
  phase: Phase;
  mode: Mode;
  selected: Unit | null;
  hover: Point | null;
  pendingCombat: CombatIntent | null;
  map: MapQueries;
  selectedReward: RewardOption | null;
  currentEvent: WorldEventDefinition | null;
  eventMode: WorldEventMode;
  restActionsLeft: number;
  restMode: RestMode;
  preparationUnit: Unit | null;
  preparationMode: PreparationMode;
  convoyPage: number;
  convoyLength: number;
  runCleared: boolean;
  buttons: Button[];
  pointer: Point | null;
};

export function drawSidePanel(ctx: CanvasRenderingContext2D, view: SidePanelView): void {
  drawWindow(ctx, PANEL_X + 4, 8, PANEL_W - 8, view.canvasHeight - 16);
  ctx.fillStyle = palette.brown;
  ctx.fillRect(PANEL_X + 12, 16, PANEL_W - 24, 54);
  ctx.fillStyle = palette.gold;
  ctx.fillRect(PANEL_X + 12, 68, PANEL_W - 24, 2);
  drawText(ctx, 'ETHEREAL WILDS', PANEL_X + 24, 43, palette.goldBright, 20);
  drawText(ctx, '禁足樹海探索録', PANEL_X + 25, 62, palette.textMuted, 12);
  drawText(ctx, phaseLabel(view.phase), PANEL_X + 410, 49, palette.text, 14);

  if (view.phase === 'player' || view.phase === 'enemy') drawBattleInfo(ctx, view);
  if (view.phase === 'reward') {
    drawText(ctx, view.selectedReward ? `${view.selectedReward.name}の受取先を選択` : '報酬を1つ選択', PANEL_X + 20, 112, palette.goldBright, 18);
  }
  if (view.phase === 'event' && view.currentEvent) {
    drawText(ctx, view.currentEvent.title, PANEL_X + 20, 112, palette.goldBright, 20);
    const status = view.eventMode === 'resolved' ? 'イベントを終えました。'
      : view.eventMode === 'shadeLookout' ? '見張り役を選択'
        : view.eventMode === 'campRepair' ? '修繕する武器を選択' : '選択肢を選んでください。';
    drawText(ctx, status, PANEL_X + 20, 144, palette.textMuted, 15);
  }
  if (view.phase === 'battleChoice') {
    drawText(ctx, '第四戦の行き先', PANEL_X + 20, 112, palette.goldBright, 20);
    drawText(ctx, '通常戦闘か強敵戦を選択してください。', PANEL_X + 20, 144, palette.textMuted, 15);
  }
  if (view.phase === 'rest') {
    drawText(ctx, `行動残り: ${view.restActionsLeft}/${REST_ACTION_MAX}`, PANEL_X + 20, 112, palette.goldBright, 18);
    if (view.restMode === 'repairTarget') drawText(ctx, '修繕する武器を選択', PANEL_X + 20, 140, palette.blueBright, 16);
  }
  if (view.phase === 'preparation') drawPreparationInfo(ctx, view);
  if (view.phase === 'world') drawText(ctx, '次のマスへ進んでください。', PANEL_X + 20, 112, palette.textMuted, 16);

  drawCombatPreview(ctx, view);
  view.buttons.forEach((button) => {
    const hovered = !!view.pointer
      && view.pointer.x >= button.x && view.pointer.x <= button.x + button.w
      && view.pointer.y >= button.y && view.pointer.y <= button.y + button.h;
    drawButton(ctx, button, hovered);
  });

  if (view.phase === 'result') {
    const message = view.runCleared ? '浅層探索 完了' : '探索隊は撤退した';
    drawText(ctx, message, PANEL_X + 20, 260, view.runCleared ? palette.greenBright : palette.redBright, 24);
  }
}

function drawPreparationInfo(ctx: CanvasRenderingContext2D, view: SidePanelView): void {
  if (view.preparationUnit) {
    const unit = view.preparationUnit;
    drawText(ctx, `${unit.name} / ${unit.cls}`, PANEL_X + 20, 106, palette.goldBright, 20);
    drawHpStatus(ctx, unit.hp, unit.maxHp, PANEL_X + 20, 136, 280);
    drawText(ctx, `輸送隊 ${view.convoyLength}個　操作: ${preparationModeLabel(view.preparationMode, view.convoyPage)}`, PANEL_X + 20, 166, palette.textMuted, 14);
  } else {
    drawText(ctx, '管理するユニットを選んでください。', PANEL_X + 20, 112, palette.textMuted, 16);
    drawText(ctx, `輸送隊: ${view.convoyLength}個`, PANEL_X + 20, 142, palette.text, 16);
  }
}

function drawBattleInfo(ctx: CanvasRenderingContext2D, view: SidePanelView): void {
  const info = view.selected ?? (view.hover ? view.map.unitAt(view.hover.x, view.hover.y) : null);
  let y = 102;
  if (!info) {
    drawText(ctx, 'ユニットにカーソルを合わせて情報を確認', PANEL_X + 20, y + 32, palette.textMuted, 16);
    return;
  }
  drawText(ctx, `${info.name} / ${info.cls}`, PANEL_X + 20, y, palette.goldBright, 20);
  y += 28;
  drawText(ctx, `Lv ${info.level}　EXP ${info.exp}`, PANEL_X + 20, y, palette.text, 15);
  y += 26;
  drawHpStatus(ctx, info.hp, info.maxHp, PANEL_X + 20, y, 230);
  y += 30;
  drawText(ctx, `力${effectiveStat(info, 'str')} 魔${effectiveStat(info, 'mag')} 技${effectiveStat(info, 'skl')} 速${effectiveStat(info, 'spd')}`, PANEL_X + 20, y, palette.text, 16);
  y += 24;
  drawText(ctx, `守${effectiveStat(info, 'def')} 魔防${effectiveStat(info, 'res')} 移${info.move}`, PANEL_X + 20, y, palette.text, 16);
  y += 24;

  const playerClass = getPlayerClass(info);
  if (playerClass) {
    const modifier = Object.entries(playerClass.statModifiers)
      .map(([stat, amount]) => `${statLabels[stat as keyof typeof statLabels]}+${amount}`)
      .join(' ');
    drawText(ctx, `職業補正　${modifier}`, PANEL_X + 280, 102, palette.blueBright, 14);
    drawText(ctx, `技能「${playerClass.skillName}」`, PANEL_X + 280, 128, palette.goldBright, 15);
    drawText(ctx, playerClass.skillDescription, PANEL_X + 280, 150, palette.textMuted, 13);
  }

  const weapon = getEquippedWeapon(info);
  if (weapon) {
    drawText(ctx, `${weapon.name}　威力${weapon.might} 命中${weapon.hit}`, PANEL_X + 20, y, palette.blueBright, 15);
    y += 24;
    drawText(ctx, `射程${weapon.rangeMin}-${weapon.rangeMax}　耐久${weapon.durability}/${weapon.maxDurability}　強撃${info.strongLeft}/${MAX_STRONG_PER_MAP}`, PANEL_X + 20, y, palette.textMuted, 14);
  } else {
    drawText(ctx, `武器未装備　強撃 ${info.strongLeft}/${MAX_STRONG_PER_MAP}`, PANEL_X + 20, y, palette.redBright, 16);
  }

  const inventoryX = PANEL_X + 280;
  let inventoryY = 184;
  drawSectionHeader(ctx, '所持品', inventoryX, inventoryY, 226);
  inventoryY += 28;
  inventorySlots(info).forEach((item, index) => {
    if (!item) drawText(ctx, `${index + 1}. －`, inventoryX + 8, inventoryY, palette.textDim, 13);
    else if (item.category === 'weapon') {
      const mark = item.id === info.equippedItemId ? '★' : '　';
      drawText(ctx, `${index + 1}. ${mark}${item.name} ${item.durability}/${item.maxDurability}`, inventoryX + 8, inventoryY, palette.blueBright, 13);
    } else drawText(ctx, `${index + 1}. ${item.name} x${item.uses}`, inventoryX + 8, inventoryY, palette.greenBright, 13);
    inventoryY += 20;
  });
}

function drawCombatPreview(ctx: CanvasRenderingContext2D, view: SidePanelView): void {
  if (view.mode !== 'confirmCombat' || !view.pendingCombat) return;
  const preview = buildCombatPreview(view.pendingCombat);
  let y = 252;
  drawWindow(ctx, PANEL_X + 260, y - 24, 266, 188, { active: true, inset: true });
  drawText(ctx, '戦闘予測', PANEL_X + 278, y + 2, palette.goldBright, 18);
  y += 26;
  preview.lines.forEach((line) => {
    const cost = line.actor.team === 'player' ? ` 耐久-${line.durabilityCost}` : '';
    const text = line.available ? `${line.label}: ${line.damage} dmg / 命中${line.hit}%${cost}` : `${line.label}: ${line.note}`;
    drawText(ctx, text, PANEL_X + 278, y, line.available ? palette.text : palette.textDim, 13);
    y += 23;
  });
  drawText(ctx, `最大耐久消費: ${preview.totalDurabilityCost}`, PANEL_X + 278, y + 4, palette.blueBright, 13);
}

function phaseLabel(phase: Phase): string {
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

function preparationModeLabel(mode: PreparationMode, page: number): string {
  if (mode === 'unitMenu') return 'メニュー';
  if (mode === 'deposit') return '預ける';
  if (mode === 'withdraw') return `取り出す ${page + 1}ページ`;
  if (mode === 'equip') return '装備変更';
  if (mode === 'item') return '道具を使う';
  return 'ユニット選択';
}
