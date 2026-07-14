import { H, MAP_X, MAP_Y, TILE, W } from '../../constants';
import type { MapQueries } from '../../logic/map';
import type { Mode, Point, Unit } from '../../types';
import { drawSegmentedGauge, drawText } from '../canvas';
import { palette } from '../theme';

export type BattleMapView = {
  mode: Mode;
  selected: Unit | null;
  hover: Point | null;
  reachable: Point[];
  targets: Unit[];
  players: Unit[];
  enemies: Unit[];
  map: MapQueries;
};

export function drawBattleScene(ctx: CanvasRenderingContext2D, view: BattleMapView): void {
  drawGrid(ctx, view);
  drawUnits(ctx, view);
}

function drawGrid(ctx: CanvasRenderingContext2D, view: BattleMapView): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = MAP_X + x * TILE;
      const sy = MAP_Y + y * TILE;
      const tile = view.map.tileAt(x, y);
      const alternating = (x + y) % 2 === 0;
      ctx.fillStyle = tile === 'forest'
        ? alternating ? palette.forest : palette.forestAlt
        : tile === 'wall' ? palette.wall
          : alternating ? palette.plain : palette.plainAlt;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, TILE, TILE);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.strokeRect(sx + 3, sy + 3, TILE - 6, TILE - 6);
      if (tile === 'forest') drawText(ctx, '森', sx + 22, sy + 39, palette.greenBright, 15);
      if (tile === 'wall') drawText(ctx, '岩', sx + 22, sy + 39, palette.textMuted, 15);
    }
  }

  drawRanges(ctx, view);
  if (view.mode === 'targetAttack' || view.mode === 'targetStrong' || view.mode === 'confirmCombat') {
    view.targets.forEach((target) => overlayCell(ctx, target.x, target.y, palette.target));
  }
  if (view.selected) drawCellOutline(ctx, view.selected.x, view.selected.y, palette.blueBright, 3);
  if (view.hover) overlayCell(ctx, view.hover.x, view.hover.y, palette.hover);
}

function drawRanges(ctx: CanvasRenderingContext2D, view: BattleMapView): void {
  const hoverUnit = view.hover ? view.map.unitAt(view.hover.x, view.hover.y) : null;
  const previewUnit = view.selected ?? hoverUnit;
  if (!previewUnit || previewUnit.unavailable || previewUnit.hp <= 0) return;

  const allowMove = view.selected?.id === previewUnit.id ? view.mode === 'move' : true;
  const ranges = view.selected?.id === previewUnit.id && view.mode === 'move'
    ? (() => {
        const moveSet = new Set(view.reachable.map(view.map.pointKey));
        return {
          moveCells: view.reachable,
          attackCells: view.map.computeAttackCellsFromPositions(previewUnit, view.reachable).filter(
            (point) => !moveSet.has(view.map.pointKey(point)),
          ),
        };
      })()
    : view.map.getPreviewRanges(previewUnit, allowMove);

  ranges.attackCells.forEach((point) => overlayCell(ctx, point.x, point.y, palette.attackRange));
  ranges.moveCells.forEach((point) => overlayCell(ctx, point.x, point.y, palette.moveRange));
}

function overlayCell(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(MAP_X + x * TILE, MAP_Y + y * TILE, TILE, TILE);
}

function drawCellOutline(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, width: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(MAP_X + x * TILE + 3, MAP_Y + y * TILE + 3, TILE - 6, TILE - 6);
  ctx.restore();
}

function drawUnits(ctx: CanvasRenderingContext2D, view: BattleMapView): void {
  const livingEnemies = view.enemies.filter((unit) => unit.hp > 0);
  const livingPlayers = view.players.filter((unit) => !unit.unavailable && unit.hp > 0);
  for (const unit of [...livingEnemies, ...livingPlayers]) {
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
    ctx.strokeStyle = view.selected?.id === unit.id ? palette.blueBright : palette.gold;
    ctx.lineWidth = view.selected?.id === unit.id ? 4 : 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, 17, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawText(ctx, unit.name.slice(0, 2), sx - 16, sy + 5, palette.text, 13);
    drawSegmentedGauge(ctx, sx - 23, sy + 28, 46, 5, unit.hp, unit.maxHp, palette.greenBright, 5);
    drawText(ctx, `${unit.hp}`, sx - 8, sy + 49, palette.text, 11);
    if (unit.acted && unit.team === 'player') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(sx, sy, 23, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
