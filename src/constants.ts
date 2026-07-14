import type { StatKey } from './types';

export const TILE = 68;
export const MAP_X = 28;
export const MAP_Y = 28;
export const PANEL_X = 600;
export const PANEL_W = 550;
export const W = 8;
export const H = 6;

export const LOG_X = MAP_X - 12;
export const LOG_Y = MAP_Y + H * TILE + 20;
export const LOG_W = W * TILE + 24;
export const LOG_H = 288;

export const STRONG_BASE_POWER = 3;
export const MAX_STRONG_PER_MAP = 1;
export const REST_ACTION_MAX = 2;
export const INVENTORY_SIZE = 4;

export const statLabels: Record<StatKey, string> = {
  str: '力',
  mag: '魔力',
  skl: '技',
  spd: '速さ',
  def: '守備',
  res: '魔防',
};
