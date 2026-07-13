import { MAX_STRONG_PER_MAP } from '../constants';
import { consumableMasters } from '../data/items';
import { enemyUnitMasters } from '../data/enemies';
import { playerUnitMasters } from '../data/playerUnits';
import { playerClassMasters } from '../data/classes';
import { weaponMasters } from '../data/weapons';
import type { Consumable, EnemyPlacement, InventorySlot, InventoryTemplate, Item, Unit, Weapon } from '../types';

let nextItemId = 1;

function newItemId(): string {
  return `item-${nextItemId++}`;
}

export function createWeapon(masterId: string): Weapon {
  const master = weaponMasters[masterId];
  if (!master) throw new Error(`Unknown weapon master: ${masterId}`);

  return {
    ...master,
    id: newItemId(),
    durability: master.maxDurability,
  };
}

export function createConsumable(masterId: string): Consumable {
  const master = consumableMasters[masterId];
  if (!master) throw new Error(`Unknown consumable master: ${masterId}`);

  return {
    ...master,
    id: newItemId(),
    uses: master.maxUses,
  };
}

export function createItem(template: InventoryTemplate): InventorySlot {
  if (!template) return null;
  if (template.category === 'weapon') return createWeapon(template.masterId);
  return createConsumable(template.masterId);
}

export function createPlayerUnits(): Unit[] {
  return playerUnitMasters.map((master) => {
    const playerClass = playerClassMasters[master.classId];
    const inventory = master.inventory.map(createItem);
    const equipped = inventory[master.equippedSlot];

    return {
      id: master.id,
      name: master.name,
      cls: playerClass.name,
      classId: master.classId,
      team: 'player',
      x: 0,
      y: 0,
      move: master.move,
      level: master.level,
      exp: master.exp,
      hp: master.maxHp,
      maxHp: master.maxHp,
      str: master.str,
      mag: master.mag,
      skl: master.skl,
      spd: master.spd,
      def: master.def,
      res: master.res,
      growth: { ...master.growth },
      inventory,
      equippedItemId: equipped?.category === 'weapon' ? equipped.id : null,
      acted: false,
      unavailable: false,
      strongLeft: MAX_STRONG_PER_MAP,
    };
  });
}

export function createEnemyUnit(placement: EnemyPlacement): Unit {
  const master = enemyUnitMasters[placement.enemyId];
  if (!master) throw new Error(`Unknown enemy master: ${placement.enemyId}`);

  const weapon = createWeapon(master.weaponId);

  return {
    id: placement.id,
    name: master.name,
    cls: master.cls,
    classId: null,
    team: 'enemy',
    x: placement.x,
    y: placement.y,
    move: master.move,
    level: master.level,
    exp: 0,
    hp: master.maxHp,
    maxHp: master.maxHp,
    str: master.str,
    mag: master.mag,
    skl: master.skl,
    spd: master.spd,
    def: master.def,
    res: master.res,
    growth: { str: 0, mag: 0, skl: 0, spd: 0, def: 0, res: 0 },
    inventory: [weapon, null, null, null],
    equippedItemId: weapon.id,
    acted: false,
    unavailable: false,
    strongLeft: 0,
  };
}

export function cloneItem(item: Item): Item {
  return { ...item };
}

export function cloneUnit(unit: Unit): Unit {
  return {
    ...unit,
    growth: { ...unit.growth },
    inventory: unit.inventory.map((item) => (item ? cloneItem(item) : null)),
  };
}
