import { STRONG_BASE_POWER } from '../constants';
import type { AttackKind, AttackSpec, CombatIntent, CombatLine, CombatPreview, Unit } from '../types';
import { getEquippedWeapon } from './inventory';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function inRange(attacker: Unit, target: Unit): boolean {
  const weapon = getEquippedWeapon(attacker);
  if (!weapon) return false;

  const d = distance(attacker, target);
  return d >= weapon.rangeMin && d <= weapon.rangeMax;
}

export function attackSpec(kind: AttackKind, attacker: Unit, defender: Unit): AttackSpec {
  if (kind === 'strong') {
    return {
      label: '強撃',
      flatDamageBonus: STRONG_BASE_POWER,
      skillDamageBonus: Math.max(attacker.skl - defender.skl, 0),
      durabilityCost: 3,
    };
  }

  return {
    label: '攻撃',
    flatDamageBonus: 0,
    skillDamageBonus: 0,
    durabilityCost: 1,
  };
}

export function baseAttackPower(attacker: Unit): number {
  const weapon = getEquippedWeapon(attacker);
  if (!weapon) return 0;

  return (weapon.kind === 'magic' ? attacker.mag : attacker.str) + weapon.might;
}

export function defenseAgainst(attacker: Unit, defender: Unit): number {
  const weapon = getEquippedWeapon(attacker);
  return weapon?.kind === 'magic' ? defender.res : defender.def;
}

export function damageFor(attacker: Unit, defender: Unit, kind: AttackKind): number {
  const spec = attackSpec(kind, attacker, defender);
  const normalDamage = Math.max(1, baseAttackPower(attacker) - defenseAgainst(attacker, defender));
  return normalDamage + spec.flatDamageBonus + spec.skillDamageBonus;
}

export function hitRate(attacker: Unit, defender: Unit): number {
  const weapon = getEquippedWeapon(attacker);
  if (!weapon) return 0;

  return clamp(weapon.hit + attacker.skl * 2 - defender.spd * 2, 0, 100);
}

export function roll2RN(hit: number): boolean {
  return (Math.random() * 100 + Math.random() * 100) / 2 < hit;
}

export function canDouble(attacker: Unit, defender: Unit): boolean {
  return attacker.spd >= defender.spd + 4;
}

export function canAffordStrike(unit: Unit, kind: AttackKind): boolean {
  if (unit.team === 'enemy') return true;

  const weapon = getEquippedWeapon(unit);
  if (!weapon) return false;

  return weapon.durability >= (kind === 'strong' ? 3 : 1);
}

function buildCombatLine(
  label: string,
  actor: Unit,
  target: Unit,
  kind: AttackKind,
  available: boolean,
  note?: string,
): CombatLine {
  return {
    label,
    actor,
    target,
    attackKind: kind,
    damage: damageFor(actor, target, kind),
    hit: hitRate(actor, target),
    durabilityCost: attackSpec(kind, actor, target).durabilityCost,
    available,
    note,
  };
}

export function buildCombatPreview(intent: CombatIntent): CombatPreview {
  const { attacker, defender, firstAttackKind } = intent;
  const lines: CombatLine[] = [];
  const attackerWeapon = getEquippedWeapon(attacker);
  let attackerDurability = attacker.team === 'enemy' ? 999 : attackerWeapon?.durability ?? 0;

  const firstCost = attackSpec(firstAttackKind, attacker, defender).durabilityCost;
  const firstAvailable = attackerDurability >= firstCost;
  lines.push(
    buildCombatLine(
      '自分の攻撃',
      attacker,
      defender,
      firstAttackKind,
      firstAvailable,
      firstAvailable
        ? firstAttackKind === 'strong'
          ? `技差+${attackSpec('strong', attacker, defender).skillDamageBonus}`
          : undefined
        : '耐久不足',
    ),
  );
  if (firstAvailable) attackerDurability -= firstCost;

  if (inRange(defender, attacker)) {
    lines.push(buildCombatLine('敵の反撃', defender, attacker, 'normal', true, '敵が生存時'));
    if (canDouble(defender, attacker)) {
      lines.push(buildCombatLine('敵の追撃反撃', defender, attacker, 'normal', true, '敵が生存時'));
    }
  } else {
    lines.push(buildCombatLine('敵の反撃', defender, attacker, 'normal', false, '射程外'));
  }

  if (canDouble(attacker, defender)) {
    const followCost = attackSpec('normal', attacker, defender).durabilityCost;
    const followAvailable = attackerDurability >= followCost;
    lines.push(
      buildCombatLine(
        '自分の追撃',
        attacker,
        defender,
        'normal',
        followAvailable,
        followAvailable ? '敵が生存時' : '耐久不足',
      ),
    );
  }

  const totalDurabilityCost = lines
    .filter((line) => line.actor.id === attacker.id && line.available)
    .reduce((sum, line) => sum + line.durabilityCost, 0);

  return { intent, lines, totalDurabilityCost };
}
