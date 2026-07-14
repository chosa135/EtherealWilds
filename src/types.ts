export type Team = 'player' | 'enemy';
export type Tile = 'plain' | 'forest' | 'wall';
export type Phase = 'world' | 'preparation' | 'event' | 'battleChoice' | 'player' | 'enemy' | 'reward' | 'rest' | 'result';
export type Mode = 'idle' | 'move' | 'menu' | 'equip' | 'item' | 'targetAttack' | 'targetStrong' | 'confirmCombat';
export type StatKey = 'str' | 'mag' | 'skl' | 'spd' | 'def' | 'res';
export type PlayerClassId = 'swordfighter' | 'lancer' | 'archer' | 'mage';
export type ClassSkill = 'nimble' | 'defensiveStance' | 'fullDraw' | 'focus';
export type AttackKind = 'normal' | 'strong';
export type WorldNodeType = 'start' | 'battle' | 'event' | 'battleChoice' | 'rest' | 'end';
export type WorldEventId = 'smallShade' | 'spiritSpring' | 'ruggedPath' | 'abandonedCamp';
export type WorldEventMode = 'choice' | 'shadeLookout' | 'campRepair' | 'resolved';
export type RestMode = 'main' | 'repairTarget';
export type PreparationMode = 'selectUnit' | 'unitMenu' | 'deposit' | 'withdraw' | 'equip' | 'item';
export type ConsumableEffect = 'heal' | 'statBoost';
export type RewardRarity = 'common' | 'uncommon' | 'rare';
export type RewardCategory = 'weapon' | 'consumable';
export type DamageKind = 'physical' | 'magic';

export type Point = { x: number; y: number };

export type Weapon = {
  id: string;
  masterId: string;
  category: 'weapon';
  name: string;
  might: number;
  hit: number;
  rangeMin: number;
  rangeMax: number;
  maxDurability: number;
  durability: number;
  kind: DamageKind;
};

export type Consumable = {
  id: string;
  masterId: string;
  category: 'consumable';
  name: string;
  effect: ConsumableEffect;
  amount: number;
  uses: number;
  stat?: StatKey;
};

export type Item = Weapon | Consumable;
export type InventorySlot = Item | null;

export type Unit = {
  id: string;
  name: string;
  cls: string;
  classId: PlayerClassId | null;
  team: Team;
  x: number;
  y: number;
  move: number;
  level: number;
  exp: number;
  hp: number;
  maxHp: number;
  str: number;
  mag: number;
  skl: number;
  spd: number;
  def: number;
  res: number;
  growth: Record<StatKey, number>;
  inventory: InventorySlot[];
  equippedItemId: string | null;
  acted: boolean;
  unavailable: boolean;
  strongLeft: number;
};

export type MapDef = {
  name: string;
  tiles: string[];
  enemies: EnemyPlacement[];
};

export type EnemyPlacement = {
  id: string;
  enemyId: string;
  x: number;
  y: number;
};

export type WorldNode = {
  type: WorldNodeType;
  battleIndex?: number;
  battleChoices?: BattleChoice[];
};

export type BattleChoice = {
  label: string;
  description: string;
  battleIndex: number;
  strong?: boolean;
};

export type WorldEventDefinition = {
  id: WorldEventId;
  title: string;
  text: string;
};

export type Button = {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
  disabled?: boolean;
};

export type LevelUpPopup = {
  unitName: string;
  level: number;
  gains: Array<{ label: string; amount: number }>;
};

export type AttackSpec = {
  label: string;
  flatDamageBonus: number;
  skillDamageBonus: number;
  durabilityCost: number;
};

export type CombatIntent = {
  attacker: Unit;
  defender: Unit;
  firstAttackKind: AttackKind;
};

export type CombatLine = {
  label: string;
  actor: Unit;
  target: Unit;
  attackKind: AttackKind;
  damage: number;
  hit: number;
  durabilityCost: number;
  available: boolean;
  note?: string;
};

export type CombatPreview = {
  intent: CombatIntent;
  lines: CombatLine[];
  totalDurabilityCost: number;
};

export type WeaponMaster = Omit<Weapon, 'id' | 'durability'> & {
  maxDurability: number;
};

export type ConsumableMaster = Omit<Consumable, 'id' | 'uses'> & {
  maxUses: number;
};

export type RewardOption = {
  id: string;
  rarity: RewardRarity;
  category: RewardCategory;
  itemMasterId: string;
  name: string;
};

export type InventoryTemplate =
  | { category: 'weapon'; masterId: string }
  | { category: 'consumable'; masterId: string }
  | null;

export type PlayerUnitMaster = {
  id: string;
  name: string;
  classId: PlayerClassId;
  move: number;
  level: number;
  exp: number;
  maxHp: number;
  str: number;
  mag: number;
  skl: number;
  spd: number;
  def: number;
  res: number;
  growth: Record<StatKey, number>;
  inventory: InventoryTemplate[];
  equippedSlot: number;
};

export type PlayerClassMaster = {
  id: PlayerClassId;
  name: string;
  statModifiers: Partial<Record<StatKey, number>>;
  skill: ClassSkill;
  skillName: string;
  skillDescription: string;
  growth: Record<StatKey, number>;
};

export type EnemyUnitMaster = {
  enemyId: string;
  name: string;
  cls: string;
  move: number;
  level: number;
  maxHp: number;
  str: number;
  mag: number;
  skl: number;
  spd: number;
  def: number;
  res: number;
  weaponId: string;
};
