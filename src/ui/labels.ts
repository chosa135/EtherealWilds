import type { RewardOption } from '../types';
import { palette } from './theme';

export function rarityLabel(rarity: RewardOption['rarity']): string {
  if (rarity === 'common') return 'コモン';
  if (rarity === 'uncommon') return 'アンコモン';
  return 'レア';
}

export function rarityColor(rarity: RewardOption['rarity']): string {
  if (rarity === 'common') return palette.text;
  if (rarity === 'uncommon') return palette.blueBright;
  return palette.goldBright;
}
