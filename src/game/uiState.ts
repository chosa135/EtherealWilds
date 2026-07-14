import { REST_ACTION_MAX } from '../constants';
import type {
  CombatIntent,
  LevelUpPopup,
  Mode,
  Point,
  PreparationMode,
  RestMode,
  RewardOption,
  Unit,
  WorldEventDefinition,
  WorldEventMode,
} from '../types';

export type BattleUiState = {
  mode: Mode;
  selected: Unit | null;
  selectedOrigin: Point | null;
  reachable: Point[];
  targets: Unit[];
  pendingCombat: CombatIntent | null;
};

export type RestUiState = {
  actionsLeft: number;
  mode: RestMode;
};

export type PreparationUiState = {
  mode: PreparationMode;
  unit: Unit | null;
  convoyPage: number;
};

export type WorldEventUiState = {
  event: WorldEventDefinition | null;
  mode: WorldEventMode;
  result: string;
};

export type RewardUiState = {
  options: RewardOption[];
  selected: RewardOption | null;
};

export type PopupUiState = {
  levelUps: LevelUpPopup[];
  battleEndOpen: boolean;
};

export function createBattleUiState(): BattleUiState {
  return { mode: 'idle', selected: null, selectedOrigin: null, reachable: [], targets: [], pendingCombat: null };
}

export function createRestUiState(): RestUiState {
  return { actionsLeft: REST_ACTION_MAX, mode: 'main' };
}

export function createPreparationUiState(): PreparationUiState {
  return { mode: 'selectUnit', unit: null, convoyPage: 0 };
}

export function createWorldEventUiState(): WorldEventUiState {
  return { event: null, mode: 'choice', result: '' };
}

export function createRewardUiState(): RewardUiState {
  return { options: [], selected: null };
}

export function createPopupUiState(): PopupUiState {
  return { levelUps: [], battleEndOpen: false };
}
