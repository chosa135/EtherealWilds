import { drawScrollRail, drawSegmentedGauge, drawText, drawWindow } from './canvas';
import { palette } from './theme';

export function drawLogWindow(
  ctx: CanvasRenderingContext2D,
  messages: string[],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  drawWindow(ctx, x, y, width, height, { inset: true });
  drawText(ctx, '行軍記録', x + 22, y + 32, palette.goldBright, 18, 'bold');
  ctx.save();
  ctx.strokeStyle = palette.wood;
  ctx.beginPath();
  ctx.moveTo(x + 20, y + 42);
  ctx.lineTo(x + width - 32, y + 42);
  ctx.stroke();
  ctx.restore();

  const visibleRows = Math.max(1, Math.floor((height - 68) / 22));
  let rowY = y + 68;
  messages.slice(0, visibleRows).forEach((message, index) => {
    if (index % 2 === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.fillRect(x + 18, rowY - 16, width - 48, 21);
    }
    drawText(ctx, `› ${message}`, x + 24, rowY, index === 0 ? palette.text : palette.textMuted, 13);
    rowY += 22;
  });

  drawScrollRail(ctx, x + width - 24, y + 54, height - 72, visibleRows, Math.max(visibleRows, messages.length));
}

export function drawHpStatus(
  ctx: CanvasRenderingContext2D,
  hp: number,
  maxHp: number,
  x: number,
  y: number,
  width: number,
): void {
  const color = hp / Math.max(1, maxHp) <= 0.3 ? palette.redBright : palette.greenBright;
  drawText(ctx, `HP ${hp}/${maxHp}`, x, y, palette.text, 15, 'bold');
  drawSegmentedGauge(ctx, x + 92, y - 12, width - 92, 10, hp, maxHp, color, 10);
}
