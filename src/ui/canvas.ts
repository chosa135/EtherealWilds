import type { Button } from '../types';
import { fontFamily, palette } from './theme';

export type WindowOptions = {
  active?: boolean;
  inset?: boolean;
};

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string = palette.text,
  size: number = 15,
  weight: 'normal' | 'bold' = 'normal',
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${fontFamily}`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  color: string = palette.text,
  size: number = 15,
): number {
  ctx.save();
  ctx.font = `normal ${size}px ${fontFamily}`;
  let line = '';
  let lineY = y;

  for (const character of text) {
    const next = line + character;
    if (line && ctx.measureText(next).width > maxWidth) {
      drawText(ctx, line, x, lineY, color, size);
      line = character;
      lineY += lineHeight;
    } else {
      line = next;
    }
  }

  if (line) drawText(ctx, line, x, lineY, color, size);
  ctx.restore();
  return lineY;
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = palette.backdrop;
  ctx.fillRect(8, 8, width - 16, height - 16);

  ctx.strokeStyle = 'rgba(199, 166, 91, 0.045)';
  ctx.lineWidth = 1;
  for (let x = 20; x < width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 8);
    ctx.lineTo(x - 180, height - 8);
    ctx.stroke();
  }
}

export function drawWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  options: WindowOptions = {},
): void {
  ctx.save();
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x + 5, y + 6, width, height);
  ctx.fillStyle = options.inset ? palette.panelInset : palette.panel;
  ctx.fillRect(x, y, width, height);

  ctx.strokeStyle = palette.woodDark;
  ctx.lineWidth = 6;
  ctx.strokeRect(x + 3, y + 3, width - 6, height - 6);
  ctx.strokeStyle = options.active ? palette.goldBright : palette.wood;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 7, y + 7, width - 14, height - 14);
  ctx.strokeStyle = palette.metal;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 10, y + 10, width - 20, height - 20);

  const stud = options.active ? palette.goldBright : palette.gold;
  ctx.fillStyle = stud;
  for (const [sx, sy] of [
    [x + 7, y + 7],
    [x + width - 11, y + 7],
    [x + 7, y + height - 11],
    [x + width - 11, y + height - 11],
  ]) ctx.fillRect(sx, sy, 4, 4);
  ctx.restore();
}

export function drawSectionHeader(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  width: number,
): void {
  drawText(ctx, label, x, y, palette.goldBright, 16, 'bold');
  ctx.save();
  ctx.strokeStyle = palette.gold;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 8);
  ctx.lineTo(x + width, y + 8);
  ctx.stroke();
  ctx.restore();
}

export function drawButton(
  ctx: CanvasRenderingContext2D,
  button: Button,
  hovered: boolean,
): void {
  const disabled = !!button.disabled;
  ctx.save();
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(button.x + 3, button.y + 4, button.w, button.h);
  ctx.fillStyle = disabled ? palette.disabled : hovered ? '#354c42' : palette.panelRaised;
  ctx.fillRect(button.x, button.y, button.w, button.h);

  ctx.fillStyle = disabled ? palette.disabledBorder : hovered ? palette.blueBright : palette.gold;
  ctx.fillRect(button.x, button.y, 4, button.h);
  ctx.strokeStyle = disabled ? palette.disabledBorder : hovered ? palette.blueBright : palette.wood;
  ctx.lineWidth = hovered && !disabled ? 2 : 1;
  ctx.strokeRect(button.x + 0.5, button.y + 0.5, button.w - 1, button.h - 1);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.beginPath();
  ctx.moveTo(button.x + 6, button.y + 5);
  ctx.lineTo(button.x + button.w - 6, button.y + 5);
  ctx.stroke();

  if (hovered && !disabled) {
    ctx.fillStyle = palette.blueBright;
    ctx.beginPath();
    ctx.moveTo(button.x + 11, button.y + button.h / 2);
    ctx.lineTo(button.x + 17, button.y + button.h / 2 - 5);
    ctx.lineTo(button.x + 17, button.y + button.h / 2 + 5);
    ctx.closePath();
    ctx.fill();
  }

  drawText(
    ctx,
    button.label,
    button.x + (hovered && !disabled ? 24 : 13),
    button.y + 23,
    disabled ? palette.textDim : palette.text,
    14,
  );
  ctx.restore();
}

export function drawSegmentedGauge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  value: number,
  max: number,
  color: string = palette.greenBright,
  segments: number = 10,
): void {
  const safeMax = Math.max(1, max);
  const filled = Math.ceil((Math.max(0, value) / safeMax) * segments);
  const gap = 2;
  const segmentWidth = (width - gap * (segments - 1)) / segments;

  ctx.save();
  ctx.fillStyle = palette.panelInset;
  ctx.fillRect(x - 3, y - 3, width + 6, height + 6);
  ctx.strokeStyle = palette.wood;
  ctx.strokeRect(x - 3, y - 3, width + 6, height + 6);
  for (let i = 0; i < segments; i++) {
    ctx.fillStyle = i < filled ? color : '#343934';
    ctx.fillRect(x + i * (segmentWidth + gap), y, segmentWidth, height);
  }
  ctx.restore();
}

export function drawScrollRail(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  visibleRows: number,
  totalRows: number,
): void {
  ctx.save();
  ctx.fillStyle = palette.panelInset;
  ctx.fillRect(x, y, 8, height);
  ctx.strokeStyle = palette.wood;
  ctx.strokeRect(x, y, 8, height);
  const ratio = Math.min(1, visibleRows / Math.max(1, totalRows));
  const thumbHeight = Math.max(28, height * ratio);
  ctx.fillStyle = palette.gold;
  ctx.fillRect(x + 2, y + 2, 4, thumbHeight - 4);
  ctx.restore();
}
