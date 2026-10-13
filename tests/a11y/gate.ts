/**
 * The gate's shape (ADR-0029, #105): a check is a function from an
 * environment to the violations it found, and it comes with a deliberately
 * broken fixture, a `sabotage` of that environment which it must catch.
 *
 * Three things are asserted per check, because a check that has never failed
 * is a check nobody knows works:
 *
 * 1. on the shipped view it finds nothing;
 * 2. on its broken fixture it finds something;
 * 3. its broken fixture trips no other check beyond those it declares in
 *    `alsoTrips` (and trips every one it declares, so an allowance cannot
 *    outlive its reason) -- so a check is shown to fail on its own, and a fixture that
 *    quietly breaks three things cannot pass for proof of one.
 *
 * The environment is the runtime's (a DOM to mount into, the source tree, a
 * built page), made fresh for each run by `withEnv`, with the sabotage applied
 * before the check looks.
 */
import { describe, expect, it } from 'vitest';

import { AUTOMATED, idsFor, type CheckId, type Runtime } from './spec.js';

export interface BrokenFixture<E> {
  /** What is broken, in a sentence: it shows up in the test's name. */
  readonly what: string;
  /** Break the environment. Runs before the check, in the environment the check will read. */
  readonly sabotage: (env: E) => void | Promise<void>;
  /** What the check must say about it: the fixture has to be caught by the mechanism it stands for, not by a neighbouring one in the same check. */
  readonly mustSay?: RegExp;
}

export interface Check<E> {
  readonly id: CheckId;
  /** What it found wrong, one line each; empty when the environment is sound. */
  readonly run: (env: E) => string[] | Promise<string[]>;
  readonly broken: BrokenFixture<E>;
  /** Other checks the broken fixture is allowed to trip, and why. Default: none. It must trip each of them. */
  readonly alsoTrips?: Partial<Record<CheckId, string>>;
}

/** A fresh environment, sabotaged or not, and how to tear it down. */
export type WithEnv<E> = <T>(sabotage: BrokenFixture<E>['sabotage'] | undefined, use: (env: E) => Promise<T>) => Promise<T>;

const SECOND = 1000;

/**
 * Register the gate's tests for one runtime's checks. `partial` is for a second
 * engine that runs only the checks whose answer depends on the engine: it need
 * not implement every number (the first engine's file asserts that), and it
 * skips the cross-fixture matrix, which is about the checks, not the engine.
 */
export function gateTests<E>(
  runtime: Runtime, checks: readonly Check<E>[], withEnv: WithEnv<E>,
  { timeout = 60 * SECOND, partial = false }: { timeout?: number; partial?: boolean } = {},
): void {
  const violations = (check: Check<E>, sabotage?: BrokenFixture<E>['sabotage']) =>
    withEnv(sabotage, async (env) => check.run(env));

  if (!partial) {
    describe(`the ${runtime} half of the accessibility gate implements exactly its checks`, () => {
      it('no number is listed and not run, or run and not listed', () => {
        expect(checks.map((c) => c.id)).toEqual(idsFor(runtime));
      });
    });
  }

  for (const check of checks) {
    const title = AUTOMATED.find((c) => c.id === check.id)!.title;
    describe(`${check.id}: ${title}`, () => {
      it('holds on the shipped view', { timeout }, async () => {
        expect(await violations(check), `${check.id} found something wrong`).toEqual([]);
      });

      it(`fails on its broken fixture (${check.broken.what})`, { timeout }, async () => {
        const found = await violations(check, check.broken.sabotage);
        expect(found.length, `${check.id} did not notice: ${check.broken.what}`).toBeGreaterThan(0);
        if (check.broken.mustSay) {
          expect(found.some((f) => check.broken.mustSay!.test(f)), `${check.id} noticed, but not by ${check.broken.mustSay}: ${found.slice(0, 3).join(' | ')}`).toBe(true);
        }
      });

      if (!partial) it('and its broken fixture trips no other check', { timeout: timeout * 4 }, async () => {
        const tripped: string[] = [];
        for (const other of checks) {
          if (other.id === check.id) continue;
          const found = await violations(other, check.broken.sabotage);
          if (found.length > 0) tripped.push(other.id);
        }
        const required = Object.keys(check.alsoTrips ?? {});
        const allowed = required;
        const stale = required.filter((id) => !tripped.includes(id));
        expect(stale, `the fixture for ${check.id} no longer trips ${stale.join(', ')}: remove the allowance from alsoTrips`).toEqual([]);
        const surprising = tripped.filter((id) => !allowed.includes(id));
        expect(surprising, `the fixture for ${check.id} (${check.broken.what}) also fails ${surprising.join(', ')}, so ${check.id} is not shown to fail on its own`).toEqual([]);
      });
    });
  }
}
