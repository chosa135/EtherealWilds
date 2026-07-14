import { H, MAP_X, MAP_Y, TILE, W } from '../../constants';
import { worldNodes } from '../../data/maps';
import { drawText } from '../canvas';
import { palette, typography } from '../theme';

export const WORLD_VIEWPORT_X = MAP_X + 12;
export const WORLD_VIEWPORT_WIDTH = W * TILE - 24;
const WORLD_NODE_GAP = 112;
const WORLD_ROUTE_PADDING = 56;
const WORLD_CONTENT_WIDTH = WORLD_ROUTE_PADDING * 2 + (worldNodes.length - 1) * WORLD_NODE_GAP;

export function maxWorldScroll(): number {
  return Math.max(0, WORLD_CONTENT_WIDTH - WORLD_VIEWPORT_WIDTH);
}

export function worldScrollForNode(index: number): number {
  const nodeX = WORLD_ROUTE_PADDING + index * WORLD_NODE_GAP;
  return Math.max(0, Math.min(maxWorldScroll(), nodeX - WORLD_VIEWPORT_WIDTH / 2));
}

export function drawWorldMap(
  ctx: CanvasRenderingContext2D,
  currentWorldIndex: number,
  selectedBattleChoiceIndex: number | null,
  worldScrollX: number,
): void {
  drawText(ctx, '禁足樹海 探索路', MAP_X + 166, MAP_Y + 52, palette.goldBright, typography.title);
  drawText(ctx, '古道と獣道を辿り、樹海の深部を目指す。', MAP_X + 104, MAP_Y + 88, palette.textMuted, typography.body);

  const startX = WORLD_VIEWPORT_X + WORLD_ROUTE_PADDING - worldScrollX;
  const y = MAP_Y + 220;
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
    drawRoute(startX + i * WORLD_NODE_GAP + radius, y, startX + (i + 1) * WORLD_NODE_GAP - radius, y, i < currentWorldIndex);
  }

  const branchX = startX + branchIndex * WORLD_NODE_GAP;
  const previousX = branchX - WORLD_NODE_GAP;
  const nextX = branchX + WORLD_NODE_GAP;
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

  const drawNode = (x: number, nodeY: number, fill: string, label: string, isCurrent: boolean, isPast: boolean): void => {
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
    drawText(ctx, label, x - 8, nodeY + 6, palette.text, 16);
  };

  worldNodes.forEach((node, index) => {
    if (index === branchIndex) return;
    const x = startX + index * WORLD_NODE_GAP;
    const fill = node.type === 'battle' ? palette.red
      : node.type === 'rest' ? palette.green
        : node.type === 'event' ? palette.gold
          : node.type === 'end' ? palette.metal : palette.blue;
    const label = node.type === 'battle' ? '戦'
      : node.type === 'event' ? '？'
        : node.type === 'rest' ? '休'
          : node.type === 'end' ? '終' : '始';
    drawNode(x, y, fill, label, index === currentWorldIndex, index < currentWorldIndex);
  });

  drawNode(branchX, normalY, palette.red, '戦', currentWorldIndex === branchIndex && normalSelected, currentWorldIndex > branchIndex && normalSelected);
  drawNode(branchX, strongY, palette.purple, '強', currentWorldIndex === branchIndex && strongSelected, currentWorldIndex > branchIndex && strongSelected);

  const currentX = startX + currentWorldIndex * WORLD_NODE_GAP;
  const currentY = currentWorldIndex === branchIndex ? strongSelected ? strongY : normalY : y;
  drawText(ctx, '現在地', currentX - 23, currentY + 52, palette.blueBright, typography.small);
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
