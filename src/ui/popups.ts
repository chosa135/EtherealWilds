import { MAP_X, MAP_Y, TILE, W } from '../constants';
import type { LevelUpPopup } from '../types';
import { drawText, drawWindow } from './canvas';
import { palette } from './theme';

export function drawLevelUpPopup(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  popups: LevelUpPopup[],
): void {
  const popup = popups[0];
  if (!popup) return;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  const width = 380;
  const height = 190;
  const x = MAP_X + (W * TILE - width) / 2;
  const y = MAP_Y + 82;
  drawWindow(ctx, x, y, width, height, { active: true });
  drawText(ctx, 'LEVEL UP', x + 126, y + 42, palette.goldBright, 24);
  drawText(ctx, `${popup.unitName}　Lv ${popup.level}`, x + 34, y + 76, palette.text, 18);
  popup.gains.forEach((gain, index) => {
    const gx = x + 46 + (index % 3) * 108;
    const gy = y + 110 + Math.floor(index / 3) * 30;
    drawText(ctx, `${gain.label} +${gain.amount}`, gx, gy, palette.greenBright, 17);
  });
  const remaining = popups.length - 1;
  drawText(ctx, remaining > 0 ? `クリックで次へ（残り ${remaining}）` : 'クリックで閉じる', x + 112, y + height - 18, palette.textMuted, 14);
}

export function drawBattleEndPopup(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  open: boolean,
): void {
  if (!open) return;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  const width = 430;
  const height = 180;
  const x = MAP_X + (W * TILE - width) / 2;
  const y = MAP_Y + 112;
  drawWindow(ctx, x, y, width, height, { active: true });
  drawText(ctx, '戦闘終了', x + 153, y + 48, palette.goldBright, 26);
  drawText(ctx, '勝利ボーナス：全員がEXP+30を獲得', x + 58, y + 96, palette.greenBright, 17);
  drawText(ctx, 'クリックで次に進む', x + 137, y + 142, palette.textMuted, 15);
}
