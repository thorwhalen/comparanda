#!/usr/bin/env node
/**
 * The `comparanda` command. One subcommand in v1:
 *
 *     comparanda build <analysis.json> [--out <file.html>] [--measure <name>] [--title <text>]
 *
 * Writes one self-contained HTML file (ADR-0017 clause 6) and prints its size,
 * raw and gzipped. The work is `buildStandalone`'s; this only reads arguments
 * and files, and turns every failure into one line on stderr and exit code 1.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { buildStandalone } from './build/index.js';

const USAGE = `usage: comparanda build <analysis.json> [--out <file.html>] [--measure <name>] [--title <text>]

  --out      where to write the page (default: <analysis>.html in the current directory)
  --measure  the measure the cells show (default: score)
  --title    the page title (default: the analysis's title, else its question)`;

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
    options: { out: { type: 'string', short: 'o' }, measure: { type: 'string' }, title: { type: 'string' } },
  });
  if (positionals.length !== 1) {
    console.error(`comparanda build: give exactly one analysis file; got ${positionals.length}.\n${USAGE}`);
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
  const result = await buildStandalone(json, {
    ...(values.measure !== undefined ? { measure: values.measure } : {}),
    ...(values.title !== undefined ? { title: values.title } : {}),
  });
  await writeFile(out, result.html);
  for (const w of result.warnings) console.error(`warning: ${w}`);
  console.log(`${out}: ${kb(result.bytes)} raw, ${kb(result.gzipBytes)} gzipped`);
  const { shellBytes, charged, limit, reserved } = result.budget;
  const held = reserved.map((r) => ` + ${kb(r.bytes)} reserved for ${r.package}`).join('');
  console.log(`  the page without the analysis: ${kb(shellBytes)}${held}${held ? ` = ${kb(charged)}` : ''}, of a ${kb(limit)} budget`);
  return 0;
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
