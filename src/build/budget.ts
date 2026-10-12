/**
 * The standalone page's byte budget (ADR-0017 clause 8, #116).
 *
 * The file is mailed and opened from `file://`, where no transport compression
 * applies and mail encoding adds roughly a third, so **raw** bytes govern, not
 * gzip. The budget covers everything the page carries except the analysis it
 * exists to carry: the bundled code, its stylesheet and the page around them.
 *
 * The number lives here, in the repo, where it can be argued with. A build that
 * exceeds it fails, and says which packages the bytes went to, largest first --
 * so a dependency that breaks it is named by the failure, not found by bisecting.
 *
 * A dependency the design has committed to but not yet added is charged now,
 * as a *reservation*: ADR-0008 adopts `@atlaskit/pragmatic-drag-and-drop` for
 * the pointer path and says to charge it against the budget explicitly. Until
 * the package is in the bundle, its reservation counts against the limit; once
 * it is, its measured bytes count instead and the reservation lapses.
 */

/** Bytes, written as kB the way `comparanda build` prints them (1 kB = 1024 bytes). */
const kB = 1024;

/** Bytes set aside for a dependency that is committed to but not yet bundled. */
export interface Reservation {
  /** The npm package name, as it appears under `node_modules/`. */
  package: string;
  bytes: number;
  /** Why it is reserved, and where the figure came from. */
  why: string;
}

export interface ByteBudget {
  /** Raw bytes the page may spend on everything but the analysis payload. */
  limit: number;
  reserved: readonly Reservation[];
}

/** The default, and the one CI enforces. Change it here, with a reason in the commit. */
export const STANDALONE_BUDGET: ByteBudget = Object.freeze({
  limit: 200 * kB,
  reserved: Object.freeze([
    Object.freeze({
      package: '@atlaskit/pragmatic-drag-and-drop',
      bytes: 24 * kB,
      why:
        'ADR-0008: the pointer reorder path, for its auto-scroll. An estimate (core and auto-scroll, minified), ' +
        'replaced by the measured bytes the moment the package is in the bundle.',
    }),
  ]),
});

/** Bytes the page spends on one package (or on comparanda's own code, or the page around it). */
export interface Contribution {
  package: string;
  bytes: number;
}

export interface BudgetReport {
  limit: number;
  /** Raw bytes of the page without the analysis, its title or its settings. */
  shellBytes: number;
  /** Reservations still charged: their package is not in the bundle yet. */
  reserved: readonly Reservation[];
  /** `shellBytes` plus the reservations still charged: what is held against `limit`. */
  charged: number;
  /** Where the shell's bytes went, largest first. Code is attributed by package. */
  contributions: readonly Contribution[];
  within: boolean;
}

/** What the page's own markup is called in a report: the HTML around the bundle. */
export const PAGE = '(the page around the bundle)';
/** What comparanda's own source is called in a report. */
export const OWN_CODE = 'comparanda';

/**
 * The package a bundled module belongs to: the segment after its last
 * `node_modules/` (`@scope/name` or `name`), else comparanda's own code.
 * Vite's virtual modules (`\0...`) are bundler glue and count as our own.
 */
export function packageOf(moduleId: string): string {
  const path = moduleId.replace(/\\/g, '/');
  const at = path.lastIndexOf('/node_modules/');
  if (at < 0) return OWN_CODE;
  const [first = '', second = ''] = path.slice(at + '/node_modules/'.length).split('/');
  // pnpm's store: node_modules/.pnpm/<name@version>/node_modules/<name>/... -- the last segment wins above.
  return first.startsWith('@') ? `${first}/${second}` : first;
}

/**
 * Share the bundle's minified bytes among packages in proportion to each
 * one's rendered (pre-minification) length -- what the bundler reports per
 * module -- and give the rest of the shell to the page. Approximate per
 * package, exact in total.
 */
export function attribute(
  shellBytes: number,
  codeBytes: number,
  rendered: ReadonlyMap<string, number>,
): Contribution[] {
  const total = [...rendered.values()].reduce((a, b) => a + b, 0);
  const byPackage = new Map<string, number>();
  for (const [id, length] of rendered) {
    const pkg = packageOf(id);
    byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + length);
  }
  const shares: Contribution[] = total > 0
    ? [...byPackage].map(([pkg, length]) => ({ package: pkg, bytes: Math.round((length / total) * codeBytes) }))
    : [];
  const attributed = shares.reduce((a, c) => a + c.bytes, 0);
  shares.push({ package: PAGE, bytes: Math.max(0, shellBytes - attributed) });
  return shares.filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes || a.package.localeCompare(b.package));
}

/** Hold a built shell against a budget. */
export function chargeBudget(shellBytes: number, contributions: readonly Contribution[], budget: ByteBudget): BudgetReport {
  const bundled = new Set(contributions.map((c) => c.package));
  const reserved = budget.reserved.filter((r) => !bundled.has(r.package));
  const charged = shellBytes + reserved.reduce((a, r) => a + r.bytes, 0);
  return { limit: budget.limit, shellBytes, reserved, charged, contributions, within: charged <= budget.limit };
}

/** A build over its budget. Carries the report, so a caller can print it its own way. */
export class BudgetExceeded extends Error {
  constructor(readonly report: BudgetReport) {
    super(describeOverrun(report));
    this.name = 'BudgetExceeded';
  }
}

/** How many contributions an overrun message names. */
const NAMED = 8;

/** Why a build is over budget, naming where the bytes went. */
export function describeOverrun(report: BudgetReport): string {
  const line = (name: string, bytes: number) => `  ${name}: ${bytes.toLocaleString('en')} bytes`;
  return [
    `the standalone page is over its byte budget, so no page was built: ${report.charged.toLocaleString('en')} bytes charged ` +
      `against ${report.limit.toLocaleString('en')} (ADR-0017 clause 8; raw bytes, the analysis excluded).`,
    'Where the bytes went, largest first (per package, approximate):',
    ...report.contributions.slice(0, NAMED).map((c) => line(c.package, c.bytes)),
    ...report.reserved.map((r) => line(`${r.package} (reserved, not yet bundled)`, r.bytes)),
    'A dependency added since the last build that passed is the likeliest cause. The budget is STANDALONE_BUDGET in src/build/budget.ts.',
  ].join('\n');
}
