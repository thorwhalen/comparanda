# comparanda

**A schema and a view for structured comparison.**

*Comparanda* (Latin, plural of *comparandum*): the things to be compared.

You have a set of options and a set of criteria. Every (option, criterion) pair gets a value —
a score, a rating, a flag, a note — or an explicit, qualified nothing. `comparanda` gives that
structure a schema, a persistence story, and a view a team can actually argue over.

It is deliberately two separable things:

- **a headless core** — a schema (built on zodal) that declares what a comparison *is* and what
  affordances it offers, with no DOM and no opinions about rendering;
- **a view** — a reorderable, groupable, annotatable matrix that consumes that schema.

Either is usable without the other. The schema is also the contract that **rubricator** — the
agent side — writes against.

## In a few lines

```ts
import { Analysis, validateAnalysis } from 'comparanda';
import { mountMatrix } from 'comparanda/view';

const { problems } = validateAnalysis(json);        // every problem names its rule and its ADR
const analysis = Analysis.parse(json);
mountMatrix(document.getElementById('matrix')!, { analysis, measure: 'score' });
```

```sh
npx comparanda build analysis.json --out analysis.html   # one offline HTML file you can mail
```

`examples/` holds three invented analyses to try it on.

## Why it exists

Comparison tables are where consequential decisions actually get made, and they are usually made
badly: in a spreadsheet nobody can re-sort, with a total column that averages away the shape,
with no record of how confident anyone was, and no way to tell whether a blank cell means "not
applicable" or "nobody has looked yet".

`comparanda` takes a position on each of those:

- **No forced aggregation.** A weighted total is one optional analysis among several, never the
  default. The shape of a row is the finding. As the UK government's MCA manual puts it, "in a basic form of MCA this performance matrix may be the final product of the analysis" ([DCLG, *Multi-criteria analysis: a manual*, 2009, §4.3.2](https://researchonline.lse.ac.uk/id/eprint/12761/1/Multi-criteria_Analysis.pdf)).
- **Uncertainty is data.** Values carry confidence, and the view can encode value and confidence
  together so a high score on thin evidence visibly recedes instead of shouting.
- **Absence is data.** A missing value is qualified — not applicable, not yet assessed, unknown,
  withheld — never a silent blank.
- **Rearranging is analysis.** Reordering rows and columns to reveal structure is a documented
  method with a literature, not a UI nicety.
- **Disagreement is a feature.** Several people can score the same cell, and the spread between
  them is often more informative than any single number.

## Two deployment shapes, both first-class

1. **Standalone.** A single self-contained HTML file with the data bundled in. No network, no
   API, no build step at the reader's end. Mail it to someone.
2. **Connected.** The same view wired to a data provider, a persistence target, an identity
   source, and resolvers for tooltips and evidence links.

The second must not be a rewrite of the first.

## Mounting the matrix

One framework-agnostic call (ADR-0017), on Preact:

```ts
import { Analysis } from 'comparanda';
import { inMemoryAnalysisSource } from 'comparanda/store';
import { mountMatrix } from 'comparanda/view';

const analysis = Analysis.parse(json);
const matrix = mountMatrix(document.getElementById('matrix')!, { analysis, measure: 'score' });
matrix.update({ encoding: 'text-only' });  // any subset of the props
matrix.destroy();                         // unsubscribes and empties the element

// Connected: the view follows the source's writes, and offers an edit only where it accepts one.
mountMatrix(el, { analysis, measure: 'score', source: inMemoryAnalysisSource(analysis) });
```

The reader's arrangement is a `ViewState` (order, hidden alternatives and criteria, group bands, orientation), passed as `view`; without one the matrix shows the document's own order:

```ts
import { initialViewState, setGrouping, transpose } from 'comparanda';

let view = setGrouping(initialViewState(analysis), 'alternatives', ['g-europe', 'g-asia']);
matrix.update({ view: transpose(view) });  // criteria as rows, alternatives as columns
```

The matrix is a `<table role="grid">` and one tab stop: arrow keys move between cells, Home and End along a row, Ctrl+Home to the top-left corner and Ctrl+End to the last cell. Where the reader is lives in the view state (`session.focus`, by id), and the matrix reports every change through `onViewChange`; keep it and pass it back, and a reload lands in the cell the reader left:

```ts
import { parseViewState, serializeViewState } from 'comparanda';

const saved = localStorage.getItem('matrix-view');
mountMatrix(el, {
  analysis, measure: 'score',
  view: saved ? parseViewState(saved).state : undefined,
  onViewChange: (v) => localStorage.setItem('matrix-view', serializeViewState(v)),
});
```

Who is acting comes from an `identity` (ADR-0012); `comparanda` never authenticates anybody. The host's own adapter comes first; otherwise `localIdentity()` keeps a name the contributor types once under a generated stable id, and is anonymous until then; an agent run is `agentIdentity({ name, model, promptVersion, runId })`. Wherever an author is named, the label says whether it is a person or an agent and how well it is known: a local identity is a typed name nobody vouched for, and reads "(human, unverified)". Who may edit is the host's `authorize`, intersected with what the document declares editable; anything but an explicit yes from the host is a refusal, and a write is asked again against the document it is about to change:

```ts
import { localIdentity } from 'comparanda/store';

const me = localIdentity();
await me.name('Ada');  // once; later visits find it
mountMatrix(el, { analysis, measure: 'score', source, identity: me, authorize: (request) => request.action === 'comment' });
```

Enter (or a click) opens the detail panel beside the matrix: a non-modal `<aside role="complementary">` for wherever the reader is. On a cell it lists every assertion with its author, justification, evidence links and provenance, the absence's reason and note, and how several values fall across the levels; on an alternative's header, its strongest and weakest criteria relative to the other alternatives; on a criterion's header, its definition and scale. It follows the grid position while open; Escape returns to the grid, and Escape again closes it. Whether it is open is view state too (`session.detailPanelOpen`), so a reload restores it. The same content is available headless as `cellDetail` and `alternativeStanding`.

The panel also carries the discussion (ADR-0011): every thread bearing on the position — the cell's, the header's, its groups' and group-pair blocks', and at the corner the analysis's — with forms to start, answer and resolve one. Resolved threads are hidden behind a button and never deleted. Writes go through the `source`, as the `identity` prop's author (`anonymousIdentity()` by default); without a source the panel says why it cannot write. Cells and headers with open threads carry a speech-bubble mark and say so to a screen reader. Headless: `threadsAt`, `startThread`, `replyToThread`, `resolveThread`.

Reordering is the analytical act, so it has three routes over one core move (ADR-0008, ADR-0027). Every alternative and criterion header has a move handle: click it, or press Shift+F10 on the header, for a move menu (to start, earlier, later, to end, before any other entry). On a header, Space or Enter picks it up: the arrow keys along its axis or Tab move it, Home and End jump to the ends, Space or Enter puts it down, and Escape puts it back. Dragging the handle moves it too, and the matrix scrolls when you drag near an edge. All three routes give the same order, recorded with who moved it, and say the same sentence in a polite live region. Focus stays on the moved header. Above the legend, each axis says how its order came about and offers "Arrange … to reveal structure" (seriation, ADR-0025), which records its method so the order can be explained. Headless: `moveTo`, `moveByMenu`, `describeMove`, `arrangeToRevealStructure`, `describeOrder`.

Encodings are registered by you, not by the package (ADR-0010): without `encodings`, the matrix shows values as text. Name the ones you ship, and switch with the `encoding` prop or the view state's; the legend follows:

```ts
import { createEncodingRegistry, missingness, textOnly, value } from 'comparanda/view';

const matrix = mountMatrix(el, { analysis, measure: 'score', encoding: 'value' }, {
  encodings: createEncodingRegistry([textOnly, value, missingness]),  // or SHIPPED_ENCODINGS for all nine
});
matrix.update({ encoding: 'missingness' });  // what is left to do, by reason
```

Light and dark follow `prefers-color-scheme`; `data-theme="light"` or `"dark"` on the mount element forces one; failing that, the same attribute on `<html>`.

Without a `source` the matrix is read-only and says so. Changing the source takes its document in the same call: `update({ source, analysis: await source.getOne(id) })`. No React or Vue binding ships; each is a few lines:

```tsx
// React
function Matrix(props: MountMatrixProps) {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<MatrixHandle>();
  useEffect(() => {
    handle.current = mountMatrix(ref.current!, props);
    return () => handle.current?.destroy();
  }, []);
  // replace: a prop the parent stops passing is cleared, not kept.
  useEffect(() => handle.current?.update(props, { replace: true }), [props]);
  return <div ref={ref} />;
}
```

```ts
// Vue 3
const Matrix = defineComponent({
  props: ['analysis', 'measure', 'vocabulary', 'encoding', 'view', 'standing', 'source', 'authorize', 'onViewChange'],
  setup(props) {
    const el = ref<HTMLElement>();
    let handle: MatrixHandle | undefined;
    const given = () => Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as MountMatrixProps;
    onMounted(() => { handle = mountMatrix(el.value!, given()); });
    watch(given, (next) => handle?.update(next, { replace: true }));
    onBeforeUnmount(() => handle?.destroy());
    return () => h('div', { ref: el });
  },
});
```

## A standalone file

One analysis in, one self-contained HTML file out: Preact, the matrix and its styles inlined, the analysis carried as readable JSON in a `<script type="application/json">`. It opens from `file://`, offline, with nothing fetched.

```sh
npm install --save-dev comparanda vite vite-plugin-singlefile playwright   # the build's peers are optional
npx playwright install chromium                                             # the browser the zero-network check opens
npx comparanda build analysis.json --out analysis.html                      # prints sizes, how it was checked, and a note on mailing it
```

Or from code, with an optional disclosure decision that is applied before anything is inlined (ADR-0021):

```ts
import { buildStandalone } from 'comparanda/build';

const { html, bytes, gzipBytes } = await buildStandalone(json, {
  measure: 'score',
  discloses: (assertion) => assertion.disclosure?.label !== 'household-finances',
});
```

An analysis with validation errors is refused, with every error named. `vite`, `vite-plugin-singlefile` and `playwright` are optional peer dependencies: a project that only mounts the matrix never installs them, and `comparanda build` names them when they are missing.

**Zero network is enforced where a browser can enforce it, and checked before the file is written** (ADR-0013). The page carries a Content-Security-Policy meta tag with `connect-src 'none'`, so `fetch`, XHR, `EventSource`, WebSocket and `sendBeacon` fail in the reader's browser rather than merely being absent from the code. Before writing, `comparanda build` scans the page's code for network APIs, then opens the file from `file://` in Chromium as built and under every encoding the page registers, focuses, presses and clicks every cell, runs a simulated minute on, and refuses the page on any console error, uncaught error, policy violation, request, navigation, new window or WebRTC connection. The last two are refused by the check, not by the policy: no CSP governs them. A `fetch()` inside a cell renderer only fires when that renderer runs, which is why the check drives the view instead of only loading it. On a machine with no Chromium, `--check static` (or `check: 'static'`) runs the scan alone; the policy is in the page either way.

## The schema, for the agent side

An analysis is JSON. Its contract is [`schema/comparanda.v1.json`](./schema/comparanda.v1.json) (JSON Schema, emitted from the Zod schema by `pnpm emit-schema`), with the extensible vocabularies in [`schema/vocabularies.v1.json`](./schema/vocabularies.v1.json); [docs/schema-v1.md](./docs/schema-v1.md) says what v1 freezes and why. A producer such as rubricator validates against the JSON Schema, then runs `validateAnalysis` for the rules a JSON Schema cannot state: no bare nulls, attributed assertions, an admitted value on every scale. Each problem it reports carries a stable `ruleId`, the ADR that decided the rule, and a fix. Breaking the schema is a coordinated change across both repositories.

## Status

Implemented and tested: the schema and its validator, the write-path guards, the analyses (dominance, screening, Pugh, agreement, seriation, and the opt-in weighted sum), the matrix view under its accessibility gate, and the standalone build. **Not yet on npm**: until the first publish, build from a clone (`pnpm install && pnpm build`).

The decisions are in [docs/adr/](./docs/adr/README.md) (indexed by theme), the vocabulary in [docs/domain-model.md](./docs/domain-model.md), and the original brief in [BRIEF.md](./BRIEF.md).

## License

Apache-2.0. See [LICENSE](./LICENSE).
