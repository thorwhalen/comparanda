/**
 * The byte assertion on the emitted payload (#183): no text or value the disclosure projection
 * removed is in the finished file. The check is exercised on pages the build would never
 * write, because a build that works proves only that it does not leak today.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildStandalone, WithheldLeaked } from '../../src/build/index.js';
import { withheldLeaks } from '../../src/build/withheld.js';
import { Analysis } from '../../src/core/schema/analysis.js';
import { projectForReader } from '../../src/core/schema/disclosure.js';
import { ANALYSIS_ELEMENT_ID, scriptSafeJson } from '../../src/standalone/contract.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const relocationJson = JSON.parse(await readFile(join(repo, 'examples', 'relocation.json'), 'utf8'));
const source = Analysis.parse(relocationJson);
const secret = source.cells.flatMap((c) => c.assertions).find((s) => typeof s.value === 'number' && (s.justification?.length ?? 0) >= 8)!;
const projected = projectForReader(source, (s) => s.id !== secret.id).analysis;
const page = (data: unknown, extra = '') =>
  `<html><head><title>t${extra}</title></head><body><script type="application/json" id="${ANALYSIS_ELEMENT_ID}">${scriptSafeJson(data)}</script></body></html>`;

describe('withheldLeaks', () => {
  it('finds nothing in a page that carries the projection', () => {
    expect(withheldLeaks(page(projected), source, projected)).toEqual([]);
  });

  it('finds a removed justification anywhere in the file, outside the analysis element too', () => {
    const leaks = withheldLeaks(page(projected, ` ${secret.justification}`), source, projected);
    expect(leaks).toEqual([{ assertionId: secret.id, field: 'justification' }]);
  });

  it('finds it escaped as the page escapes it', () => {
    const tricky = structuredClone(source);
    const target = tricky.cells.flatMap((c) => c.assertions).find((s) => s.id === secret.id)!;
    target.justification = 'costs <b>more</b> than the "budget" allows';
    const p = projectForReader(tricky, (s) => s.id !== secret.id).analysis;
    const html = page(p, ` ${scriptSafeJson(target.justification).slice(1, -1)}`);
    expect(withheldLeaks(html, tricky, p).map((l) => l.field)).toEqual(['justification']);
  });

  it('finds an analysis element that is the unprojected source, number values included', () => {
    const leaks = withheldLeaks(page(source), source, projected);
    expect(leaks).toContainEqual({ assertionId: '(analysis element)', field: 'differs from the projection' });
  });

  it('finds a page with no analysis element', () => {
    expect(withheldLeaks('<html></html>', source, projected)[0]!.field).toBe('missing from the file');
  });

  it('does not call a string the reader is still shown a leak', () => {
    const twin = structuredClone(source);
    const [kept] = twin.cells.flatMap((c) => c.assertions).filter((s) => s.id !== secret.id && s.justification);
    twin.cells.flatMap((c) => c.assertions).find((s) => s.id === secret.id)!.justification = kept!.justification!;
    const p = projectForReader(twin, (s) => s.id !== secret.id).analysis;
    expect(withheldLeaks(page(p), twin, p)).toEqual([]);
  });

  it('names the field, never the text', () => {
    const error = new WithheldLeaked(withheldLeaks(page(projected, ` ${secret.justification}`), source, projected));
    expect(error.message).toContain(secret.id);
    expect(error.message).not.toContain(secret.justification!);
  });
});

describe('the build', () => {
  it('passes the assertion on a projected page, and does not run it when nothing is withheld', async () => {
    const built = await buildStandalone(relocationJson, { check: 'static', discloses: (s) => s.id !== secret.id });
    expect(built.html).not.toContain(secret.justification!);
    await expect(buildStandalone(relocationJson, { check: 'static' })).resolves.toBeDefined();
  });
});
