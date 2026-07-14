import { MAP_X, MAP_Y } from '../../constants';
import { inventorySlots } from '../../logic/inventory';
import type { BattleChoice, InventorySlot, Item, RewardOption, Unit, WorldEventDefinition, WorldEventMode } from '../../types';
import { drawSectionHeader, drawText, drawWindow, drawWrappedText } from '../canvas';
import { rarityColor, rarityLabel } from '../labels';
import { palette, typography } from '../theme';
import { drawHpStatus } from '../widgets';

export function drawWorldEventScreen(
  ctx: CanvasRenderingContext2D,
  event: WorldEventDefinition | null,
  mode: WorldEventMode,
  result: string,
): void {
  if (!event) return;
  drawText(ctx, event.title, MAP_X + 198, MAP_Y + 52, palette.goldBright, typography.title);
  drawWindow(ctx, MAP_X + 48, MAP_Y + 92, 416, 224, { inset: true });
  drawWrappedText(ctx, event.text, MAP_X + 76, MAP_Y + 130, 360, 27, palette.text, 16);

  if (mode === 'resolved') {
    ctx.fillStyle = 'rgba(79, 138, 89, 0.13)';
    ctx.fillRect(MAP_X + 66, MAP_Y + 235, 380, 60);
    drawWrappedText(ctx, result, MAP_X + 80, MAP_Y + 258, 352, 22, palette.greenBright, 14);
    return;
  }

  const prompt = mode === 'shadeLookout'
    ? '見張り役にする隊員を選んでください。'
    : mode === 'campRepair'
      ? '修繕する武器を選んでください。'
      : '行動を選んでください。';
  drawText(ctx, prompt, MAP_X + 80, MAP_Y + 277, palette.blueBright, 15);
}

export function drawBattleChoiceScreen(ctx: CanvasRenderingContext2D, choices: BattleChoice[]): void {
  drawText(ctx, '分かれ道', MAP_X + 202, MAP_Y + 52, palette.goldBright, typography.title);
  drawText(ctx, '樹海の奥へ至る二つの道。進む戦場を選ぶ。', MAP_X + 92, MAP_Y + 90, palette.textMuted, typography.body);
  choices.forEach((choice, index) => {
    const x = MAP_X + 54;
    const y = MAP_Y + 132 + index * 108;
    drawWindow(ctx, x, y, 404, 82, { inset: true, active: choice.strong });
    drawText(ctx, choice.label, x + 24, y + 32, choice.strong ? palette.redBright : palette.blueBright, 19);
    drawText(ctx, choice.description, x + 24, y + 59, palette.textMuted, 14);
  });
}

export function drawRewardScreen(
  ctx: CanvasRenderingContext2D,
  options: RewardOption[],
  selected: RewardOption | null,
): void {
  drawText(ctx, '戦利品の選定', MAP_X + 178, MAP_Y + 52, palette.goldBright, typography.title);
  drawText(ctx, '持ち帰る品をひとつ選び、探索隊か輸送隊へ。', MAP_X + 82, MAP_Y + 91, palette.textMuted, typography.body);
  if (!selected) {
    options.forEach((option, index) => {
      const x = MAP_X + 72;
      const y = MAP_Y + 154 + index * 58;
      ctx.fillStyle = palette.panelRaised;
      ctx.fillRect(x, y, 370, 42);
      ctx.strokeStyle = rarityColor(option.rarity);
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, y + 0.5, 369, 41);
      ctx.fillStyle = rarityColor(option.rarity);
      ctx.fillRect(x, y, 5, 42);
      drawText(ctx, `[${rarityLabel(option.rarity)}] ${option.name}`, x + 16, y + 27, rarityColor(option.rarity), 17);
    });
    return;
  }
  drawText(ctx, `選択中: [${rarityLabel(selected.rarity)}] ${selected.name}`, MAP_X + 98, MAP_Y + 162, rarityColor(selected.rarity), 18);
  drawText(ctx, '右のボタンから受取先を選んでください。', MAP_X + 98, MAP_Y + 202, palette.text, 16);
}

function preparationItemLabel(item: InventorySlot, equippedItemId: string | null): string {
  if (!item) return '-';
  if (item.category === 'weapon') {
    const mark = item.id === equippedItemId ? '★' : '';
    return `${mark}${item.name} ${item.durability}/${item.maxDurability}`;
  }
  return `${item.name} x${item.uses}`;
}

export function drawPreparationScreen(
  ctx: CanvasRenderingContext2D,
  convoy: Item[],
  players: Unit[],
  selectedUnit: Unit | null,
): void {
  drawText(ctx, '探索前の身支度', MAP_X + 164, MAP_Y + 40, palette.goldBright, typography.title);
  drawSectionHeader(ctx, `輸送隊 (${convoy.length})`, MAP_X + 14, MAP_Y + 78, 476);
  if (convoy.length === 0) {
    drawText(ctx, '保管中のアイテムはありません', MAP_X + 24, MAP_Y + 108, palette.textDim, 14);
  } else {
    convoy.slice(0, 10).forEach((item, index) => {
      const x = MAP_X + 18 + (index % 2) * 250;
      const y = MAP_Y + 104 + Math.floor(index / 2) * 20;
      drawText(ctx, `${index + 1}. ${preparationItemLabel(item, null)}`, x, y, item.category === 'weapon' ? palette.blueBright : palette.greenBright, 13);
    });
    if (convoy.length > 10) drawText(ctx, `ほか ${convoy.length - 10}個`, MAP_X + 408, MAP_Y + 208, palette.textMuted, 12);
  }

  players.forEach((unit, index) => {
    const x = MAP_X + 14 + (index % 2) * 250;
    const y = MAP_Y + 226 + Math.floor(index / 2) * 94;
    const selectedMark = selectedUnit?.id === unit.id ? '▶ ' : '';
    const status = unit.unavailable ? ' [戦闘不能]' : '';
    ctx.fillStyle = selectedUnit?.id === unit.id ? 'rgba(79, 143, 201, 0.12)' : 'rgba(255,255,255,0.025)';
    ctx.fillRect(x - 6, y - 18, 230, 84);
    ctx.strokeStyle = selectedUnit?.id === unit.id ? palette.blueBright : palette.woodDark;
    ctx.strokeRect(x - 6, y - 18, 230, 84);
    drawText(ctx, `${selectedMark}${unit.name}${status}`, x, y, unit.unavailable ? palette.redBright : palette.goldBright, 15);
    inventorySlots(unit).forEach((item, slotIndex) => {
      const color = !item ? palette.textDim : item.category === 'weapon' ? palette.blueBright : palette.greenBright;
      drawText(ctx, `${slotIndex + 1}. ${preparationItemLabel(item, unit.equippedItemId)}`, x + 8, y + 18 + slotIndex * 16, color, 12);
    });
  });
}

export function drawRestScreen(ctx: CanvasRenderingContext2D, players: Unit[]): void {
  drawText(ctx, '樹海の野営地', MAP_X + 174, MAP_Y + 52, palette.goldBright, typography.title);
  drawText(ctx, '火を囲み、次の行軍に備える。行動は二度まで。', MAP_X + 80, MAP_Y + 92, palette.textMuted, typography.body);
  const living = players.filter((unit) => !unit.unavailable && unit.hp > 0).length;
  const down = players.filter((unit) => unit.unavailable).length;
  drawText(ctx, `出撃可能 ${living}人　戦闘不能 ${down}人`, MAP_X + 154, MAP_Y + 136, down > 0 ? palette.redBright : palette.greenBright, 16);

  players.forEach((unit, index) => {
    const x = MAP_X + 18 + (index % 2) * 264;
    const y = MAP_Y + 158 + Math.floor(index / 2) * 96;
    const width = 248;
    ctx.fillStyle = unit.unavailable ? 'rgba(168, 72, 63, 0.12)' : palette.panelRaised;
    ctx.fillRect(x, y, width, 80);
    ctx.strokeStyle = unit.unavailable ? palette.red : palette.wood;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 79);
    drawText(ctx, unit.name, x + 14, y + 25, unit.unavailable ? palette.redBright : palette.goldBright, 16);
    drawText(ctx, unit.unavailable ? '戦闘不能' : '出撃可能', x + 164, y + 25, unit.unavailable ? palette.redBright : palette.greenBright, 13);
    drawHpStatus(ctx, unit.hp, unit.maxHp, x + 14, y + 57, width - 28);
  });
}
