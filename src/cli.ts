#!/usr/bin/env node
/**
 * The `comparanda` command. One subcommand in v1:
 *
 *     comparanda build <analysis.json> [--out <file.html>] [--measure <name>] [--title <text>] [--check browser|static] [--withhold-label <label>]...
 *
 * Writes one self-contained HTML file (ADR-0017 clause 6) and prints its size,
 * raw and gzipped, and how it was checked to ask the network for nothing
 * (ADR-0013): a page that fails that check is not written. The work is `buildStandalone`'s; this only reads arguments
 * and files, and turns every failure into one line on stderr and exit code 1.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { buildStandalone, MAILING_NOTE } from './build/index.js';
import type { Assertion } from './core/schema/values.js';

const USAGE = `usage: comparanda build <analysis.json> [--out <file.html>] [--measure <name>] [--title <text>] [--check browser|static] [--withhold-label <label>]...

  --out      where to write the page (default: <analysis>.html in the current directory)
  --measure  the measure the cells show (default: score)
  --title    the page title (default: the analysis's title, else its question)
  --check    how the page is checked to ask the network for nothing (default: browser, which
             opens it in Chromium under every encoding; static, a scan of its code alone)
  --withhold-label  withhold every assertion carrying this disclosure label (repeatable); without it,
             labelled assertions are inlined verbatim and the build warns that it did so`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (command !== 'build') {
    console.error(`comparanda: unknown command "${command}".\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = parseArgs({
    args: [...rest],
    allowPositionals: true,
    options: { out: { type: 'string', short: 'o' }, measure: { type: 'string' }, title: { type: 'string' }, check: { type: 'string' }, 'withhold-label': { type: 'string', multiple: true } },
  });
  if (positionals.length !== 1) {
    console.error(`comparanda build: give exactly one analysis file; got ${positionals.length}.\n${USAGE}`);
    return 1;
  }
  if (values.check !== undefined && values.check !== 'browser' && values.check !== 'static') {
    console.error(`comparanda build: --check is browser or static, not "${values.check}".\n${USAGE}`);
    return 1;
  }
  const input = resolve(positionals[0]!);
  const out = resolve(values.out ?? `${basename(input, extname(input))}.html`);

  let json: unknown;
  try {
    json = JSON.parse(await readFile(input, 'utf8'));
  } catch (error) {
    console.error(`comparanda build: could not read ${input} as JSON: ${message(error)}`);
    return 1;
  }
  const withheld = new Set(values['withhold-label'] ?? []);
  const labelled = countLabels(json);
  const result = await buildStandalone(json, {
    ...(withheld.size > 0 ? { discloses: (a: Assertion) => a.disclosure?.label === undefined || !withheld.has(a.disclosure.label) } : {}),
    ...(values.measure !== undefined ? { measure: values.measure } : {}),
    ...(values.title !== undefined ? { title: values.title } : {}),
    ...(values.check !== undefined ? { check: values.check as 'browser' | 'static' } : {}),
  });
  await writeFile(out, result.html);
  const shipped = [...labelled].filter(([label]) => !withheld.has(label));
  if (shipped.length > 0) {
    const list = shipped.map(([label, n]) => `${label} (${n})`).join(', ');
    console.error(`warning: the page carries every value, justification and excerpt of the assertions labelled ${list}; View Source recovers them. --withhold-label <label> withholds a label.`);
  }
  for (const w of result.warnings) console.error(`warning: ${w}`);
  console.log(`${out}: ${kb(result.bytes)} raw, ${kb(result.gzipBytes)} gzipped`);
  const { shellBytes, charged, limit, reserved } = result.budget;
  const held = reserved.map((r) => ` + ${kb(r.bytes)} reserved for ${r.package}`).join('');
  console.log(`  the page without the analysis: ${kb(shellBytes)}${held}${held ? ` = ${kb(charged)}` : ''}, of a ${kb(limit)} budget`);
  const { by, encodings, couldNotDraw } = result.checked;
  const unable = couldNotDraw.length > 0 ? `; ${couldNotDraw.join(', ')} could not draw this analysis` : '';
  console.log(by === 'browser'
    ? `  zero network: refused by the page's CSP, and none asked for when opened in Chromium and driven ${encodings.length > 0 ? `under ${encodings.join(', ')}` : 'as built, under no further encoding'}${unable}`
    : '  zero network: refused by the page\'s CSP, and nothing found in its code; not opened in a browser (--check static)');
  console.log(`  ${MAILING_NOTE}`);
  return 0;
}

/** Disclosure labels in the raw document, with how many assertions carry each (read defensively: validation is the build's). */
function countLabels(json: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  const cells = (json as { cells?: unknown } | null)?.cells;
  if (!Array.isArray(cells)) return counts;
  for (const cell of cells) {
    const assertions = (cell as { assertions?: unknown } | null)?.assertions;
    if (!Array.isArray(assertions)) continue;
    for (const a of assertions) {
      const label = (a as { disclosure?: { label?: unknown } } | null)?.disclosure?.label;
      if (typeof label === 'string') counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    console.error(`comparanda: ${message(error)}`);
    process.exitCode = 1;
  },
);
