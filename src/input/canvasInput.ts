import { H, MAP_Y, TILE } from '../constants';
import type { Button, Phase, Point } from '../types';
import { WORLD_VIEWPORT_WIDTH, WORLD_VIEWPORT_X } from '../ui/screens/worldMap';

export type CanvasInputHandlers = {
  getPhase: () => Phase;
  getButtons: () => Button[];
  screenToCell: (x: number, y: number) => Point | null;
  onPointerMove: (pointer: Point, hover: Point | null) => void;
  onPointerLeave: () => void;
  onWorldScroll: (delta: number) => void;
  onClick: (x: number, y: number) => void;
};

export function registerCanvasInput(canvas: HTMLCanvasElement, handlers: CanvasInputHandlers): void {
  const localPoint = (event: MouseEvent | WheelEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  canvas.addEventListener('wheel', (event) => {
    if (handlers.getPhase() !== 'world') return;
    const point = localPoint(event);
    const withinWorldMap = point.x >= WORLD_VIEWPORT_X
      && point.x <= WORLD_VIEWPORT_X + WORLD_VIEWPORT_WIDTH
      && point.y >= MAP_Y + 104
      && point.y <= MAP_Y + H * TILE;
    if (!withinWorldMap) return;

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    handlers.onWorldScroll(delta);
    event.preventDefault();
  }, { passive: false });

  canvas.addEventListener('mousemove', (event) => {
    const point = localPoint(event);
    const overEnabledButton = handlers.getButtons().some((button) =>
      !button.disabled
      && point.x >= button.x
      && point.x <= button.x + button.w
      && point.y >= button.y
      && point.y <= button.y + button.h,
    );
    canvas.style.cursor = overEnabledButton ? 'pointer' : 'default';
    handlers.onPointerMove(point, handlers.screenToCell(point.x, point.y));
  });

  canvas.addEventListener('mouseleave', () => {
    canvas.style.cursor = 'default';
    handlers.onPointerLeave();
  });

  canvas.addEventListener('click', (event) => {
    const point = localPoint(event);
    handlers.onClick(point.x, point.y);
  });
}
