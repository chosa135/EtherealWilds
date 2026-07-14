import { COMBAT_EXP, KILL_EXP } from './growth';
import { getEquippedWeapon } from './inventory';
import { attackSpec, canAffordStrike, canDouble, damageFor, hitRate, inRange, roll2RN } from './combat';
import type { AttackKind, CombatIntent, Unit } from '../types';

export type CombatResolutionHooks = {
  grantExp: (unit: Unit, amount: number) => void;
  log: (message: string) => void;
};

function consumeDurability(unit: Unit, amount: number): void {
  if (unit.team !== 'player') return;
  const weapon = getEquippedWeapon(unit);
  if (weapon) weapon.durability = Math.max(0, weapon.durability - amount);
}

function defeatUnit(unit: Unit, log: (message: string) => void): void {
  if (unit.team === 'player') {
    unit.unavailable = true;
    unit.acted = true;
    log(`${unit.name}は戦闘不能になり、後方へ撤退した`);
  } else {
    log(`${unit.name}を撃破した`);
  }
}

function executeStrike(
  actor: Unit,
  target: Unit,
  kind: AttackKind,
  combatExpGranted: Set<string>,
  combatInitiatorId: string,
  hooks: CombatResolutionHooks,
): void {
  const spec = attackSpec(kind, actor, target);
  if (!canAffordStrike(actor, kind)) {
    hooks.log(`${actor.name}の武器耐久が足りない`);
    return;
  }

  consumeDurability(actor, spec.durabilityCost);
  if (actor.team === 'player' && !combatExpGranted.has(actor.id)) {
    combatExpGranted.add(actor.id);
    hooks.grantExp(actor, COMBAT_EXP);
  }

  const hit = hitRate(actor, target, combatInitiatorId);
  if (!roll2RN(hit)) {
    hooks.log(`${actor.name}の${spec.label}: ${target.name}に外れた（命中${hit}%）`);
    return;
  }

  const damage = damageFor(actor, target, kind, combatInitiatorId);
  target.hp = Math.max(0, target.hp - damage);
  const details = kind === 'strong' ? `（技差+${spec.skillDamageBonus}）` : '';
  hooks.log(`${actor.name}の${spec.label}: ${target.name}に${damage}ダメージ${details}`);

  if (target.hp <= 0) {
    defeatUnit(target, hooks.log);
    if (actor.team === 'player') hooks.grantExp(actor, KILL_EXP);
  }
}

export function resolveCombat(intent: CombatIntent, hooks: CombatResolutionHooks): void {
  const { attacker, defender, firstAttackKind } = intent;
  const combatExpGranted = new Set<string>();
  const combatInitiatorId = attacker.id;

  if (attacker.team === 'player' && firstAttackKind === 'strong') attacker.strongLeft -= 1;
  executeStrike(attacker, defender, firstAttackKind, combatExpGranted, combatInitiatorId, hooks);

  if (defender.hp > 0 && attacker.hp > 0 && inRange(defender, attacker)) {
    executeStrike(defender, attacker, 'normal', combatExpGranted, combatInitiatorId, hooks);
  }
  if (defender.hp > 0 && attacker.hp > 0 && inRange(defender, attacker) && canDouble(defender, attacker)) {
    executeStrike(defender, attacker, 'normal', combatExpGranted, combatInitiatorId, hooks);
  }
  if (attacker.hp > 0 && defender.hp > 0 && canDouble(attacker, defender)) {
    executeStrike(attacker, defender, 'normal', combatExpGranted, combatInitiatorId, hooks);
  }
}
