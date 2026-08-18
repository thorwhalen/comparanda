# Prior art, and the view framework under the standalone-bundle constraint

**Research question(s):**
(A) For each named piece of prior art — Airtable / Notion / Coda, Loomio and Polis, Google Docs,
Miro, Figma, Observable, Jupyter/Quarto, dedicated MCDA tools, and academic reorderable-matrix
tools — what is the single best idea, the single worst mistake, and what should `comparanda` steal
or avoid? With particular attention to how Google Docs anchors a comment to a range that later
moves, because `comparanda` must anchor annotations to cells and criteria that get reordered and
renamed.
(B) Which framework should the view be built on, justified against the standalone-bundle
constraint (the single self-contained HTML file gets mailed) and against the fact that the local
ecosystem is already zodal-based? Including: what `@zodal/core` actually gives us, whether
`@zodal/store`'s `DataProvider` is the right shape for the `DataSource` port, whether `@zodal/ui`'s
generators are usable, whether `zodal-groups` already solves grouping; React vs Preact vs Svelte vs
Solid vs Lit vs vanilla; whether `comparanda/react` should exist in v1; how to produce the
standalone build; how to CI-assert zero network requests; and whether one package with subpath
exports actually tree-shakes.

**Brief section:** `docs/research/terminology.md` §6 ("Prior art to examine directly"), plus the
`BRIEF.md` working agreement "Choose the framework in an ADR before writing view code; justify it
against the standalone-bundle constraint", and the ADR-0005 condition of acceptance
("confirm that tree-shaking actually keeps `core`-only consumers free of view code").

**Evidence grade: strong** for Part B — every size and tree-shaking figure reported in a table below
is a measurement I ran on this machine with a single bundler and settings, reported with raw bytes
and command, and the zodal claims come from reading the source and executing it, not from its README.
Two size questions were **not** measured and are marked as such in place: `@zodal/ui` (§B.3) and
Svelte/Solid (§B.5). **Moderate** for Part A — the mechanisms are cited to vendor documentation and to
peer-reviewed papers, but the "worst mistake" judgements are my reasoning about those mechanisms, and
are labelled as such. Three vendor pages ([5], [14], [15]) refused automated fetching and were not
content-verified; see the verification note at the end of REFERENCES.

---

## Bottom line

Build the view on **Preact**, ship **one package with subpath exports** as ADR-0005 proposes, and
do **not** ship `comparanda/react` in v1. The measured numbers are not close: a trivial component
costs 60.1 kB gzipped / 193.3 kB raw on React 19, and 5.3 kB gzipped / 12.8 kB raw on Preact 10 —
and for a file that is mailed and opened over `file://`, **raw bytes are what travel, because no
transport applies gzip to a saved attachment**. Author the schema in `zod/mini`, not classic Zod:
same measured comparanda-shaped schema costs 15.3 kB raw on `zod/mini` versus 310.9 kB raw when
imported as the `z` namespace barrel — and `@zodal/core`'s `defineCollection` works on `zod/mini`
schemas unchanged (verified by execution). That puts the whole schema-plus-affordance layer at
22.4 kB raw / 8.0 kB gzip.

`@zodal/store`'s `DataProvider` is the right port shape for saved views, annotations and rater
assertions — all genuinely collection-shaped — and its **capability discovery is precisely the
mechanism ADR-0013 asks for and does not name**. It is the wrong shape for the analysis document
itself; model that as a degenerate one-item provider, the way `zodal-dials` models a settings
document. `@zodal/ui`'s generators are structurally inapplicable to a matrix and should be skipped;
its renderer registry pattern is worth copying. `zodal-groups` substantially solves grouping —
many-to-many membership, nested group trees, `scopeFilter`, and fractional-index ordering per
membership edge — at 16.1 kB raw / 5.7 kB gzip, and matches ADR-0008's "groups are tags, not a
partition" exactly.

Two findings change existing decisions. First: **ADR-0008's recommendation to evaluate `dnd-kit`
should be withdrawn** — `dnd-kit` is React-only, which contradicts the framework choice, and the
accessibility argument for taking any drag library is weaker than it looks: the leading
framework-agnostic alternative's own README says its packages "are unopinionated about visual
language or accessibility" [1], so the keyboard path and the announcements are ours to write either
way (REASONING, on the cited documentation). Second, and
sharper: **a self-registering encoding registry is a tree-shaking hazard that silently breaks the
build.** I demonstrated it — with `"sideEffects": false` declared, esbuild deleted a self-registering
encoding module *from the view bundle*, shipping the renderer with an empty registry and no error.
Encodings must be registered explicitly by the composition root.

On anchoring: Google Docs' own API documentation concedes that its anchors "are immutable, and
their position relative to the content of a document cannot be guaranteed between revisions" [2].
That is a defeat forced by text having no stable identity. `comparanda` is not in that situation —
alternatives and criteria are entities we mint — so anchor annotations to **stable opaque IDs and
nothing else**, keep the label only as a redundant repair hint in the sense of the robust-locations
literature, and never hard-delete an entity that carries an annotation.

---

## Findings

### Part A — prior art

#### A.1 Airtable / Notion / Coda — the view model

**Mechanism (EVIDENCE).** All three separate the data from named, saved configurations over it.
Airtable distinguishes three access modes for a view: *collaborative* views, where "all base
collaborators to see and edit the view's configuration, such as sorting, grouping, and filtering";
*personal* views, which "only you can configure and edit"; and *locked* views, which "prevent all
collaborators from changing a view's configuration — like filters, field order, or visibility —
until it's unlocked by someone with Creator or Owner permissions" [3]. In Notion, "each database
view has its own settings" and "settings applied to one database view won't be applied across all
other database views automatically"; its *linked* views are explicitly non-destructive — "the changes
you make in a linked database reflect in the original, but filters and views only apply to the linked
instance" [4]. Coda goes further on the detail
side: "you can set unique layouts for different views of the same table" [5].

**Single best idea:** the three-way access mode on a *view*, not on the data. `comparanda` already
has personal-versus-shared in ADR-0006/0007; what it lacks is **locked**. A locked arrangement is
what makes a view safe to circulate — "this is the arrangement the argument is about, and you
cannot silently re-sort it out from under the reader". This is the missing complement to ADR-0007's
no-autosave stance: no-autosave protects the view from *accidental* mutation, locking protects it
from *deliberate* mutation by someone who does not realise it is load-bearing.

**Single worst mistake (REASONING):** in all three, the view configuration is a *superset of the
data model's expressive power in one direction only* — you can group by a field's value, but a
group is never a first-class object you can annotate, describe or argue about. Grouping is a
transient lens, so the reasoning behind a grouping ("we split these criteria into hygiene factors
and differentiators because the argument is really about the second set") has nowhere to live and
ends up in a Slack thread. ADR-0008's decision that groups are *data* is the right correction and
should be held; ADR-0011's criterion-level and group-level annotation scopes are what make it pay
off.

**Steal:** locked views, as a third mode alongside personal and shared. **Avoid:** treating the
grouping as configuration rather than as an annotatable object.

#### A.2 Google Docs — comment anchoring, suggestion mode, resolve

This is the section the brief singles out, and it deserves the detail.

**How Docs anchors (EVIDENCE).** The Drive API models an anchor as a JSON string carrying a
revision id and a region, of the shape

```json
{ "region": { "kind": "drive#commentRegion", "line": ANCHOR_LINE, "rev": "head" } }
```

where the revision may be a specific revision id from `revisions.list` or the literal `"head"`, and
where "for Google Docs, the region is typically defined by 'line' and 'revision'" [2]. The
documentation then states the limitation plainly: "Anchors are immutable, and their position
relative to the content of a document cannot be guaranteed between revisions. Consequently, we
recommend you use anchors in documents where the position doesn't change, such as image files or
read-only documents" [2].

Read that carefully: the public API-level anchoring model is *positional*, *revision-pinned*, and
*disclaimed*. (The in-product editor does better than the API exposes, since comments visibly
follow edited text in the UI — but the contract Google is willing to state is the one above, and it
is the one an integrator must design against.)

**How the robust-anchoring literature says to do it (EVIDENCE).** The problem has a name and a
body of work. Phelps and Wilensky's *Robust Intra-document Locations* (WWW9, 2000) is the canonical
statement of the approach: carry **multiple redundant descriptors** of a location rather than one,
and resolve by trying them in order of strength, so that a location survives changes that
invalidate any single descriptor [6]. (I could locate the record and citation but the WWW9 mirror I
tried returned 404, so the specific descriptor set is *not* quoted here.) Brush, Bargeron, Gupta and
Cadiz's *Robust Annotation Positioning in Digital Documents* (CHI 2001) studied the human side —
"how users react to lost annotations, the relationship between types of document modifications and
user expectations, and whether users pay attention to text surrounding their annotations" [7]. (I
read the abstract and the venue record; I did **not** obtain the full text, so I make no claim
about its specific numbers.)

The W3C Web Annotation Data Model turned the redundancy idea into a standard. It defines
`TextQuoteSelector` (the exact text plus surrounding context), `TextPositionSelector` (character
offsets — for which the spec itself warns the approach "is very brittle with regards to changes to
the resource"), `RangeSelector`, `CssSelector`, `XPathSelector`, `FragmentSelector`,
`DataPositionSelector` and `SvgSelector`; a `refinedBy` chaining mechanism; and — the normative
sentence that matters here — "Multiple Selectors *SHOULD* select the same content, however some
Selectors will not have the same precision as others. Consuming user agents *MUST* pick one of the
described segments, if they are different" [8]. In other words: store several descriptors, and let
the consumer choose the best one that still resolves.

Hypothesis implements exactly that, and its failure handling is the part worth copying. Its
"context-first fuzzy matching" uses the position selector purely as a *hint* to bound the search —
"searching around the expected start position (as stored in the PositionSelector, if any), we try
to locate the prefix" — stores 32-character prefix and suffix snippets, matches with a modified
`google-diff-match-patch` (Bitap for matching, Myers for diffing), and on failure falls back to a
selector-only fuzzy search over the whole document [9]. When nothing resolves, the Hypothesis client
marks the annotation an **orphan** rather than deleting it — a behaviour of the product; the cited
post describes the matching strategy but never uses the word *(UNVERIFIED — could not locate source
for the term)*.

**What `comparanda` should do (REASONING, built on the above EVIDENCE).**

The decisive observation is that `comparanda` is *not* in the situation that forces all of this
machinery. Text has no identity, so text annotation has to reconstruct identity from content. But an
alternative, a criterion, a group and a measure are entities `comparanda` mints. Reordering is view
state (ADR-0008) and renaming changes an attribute, not a key. So:

> **An annotation anchor is a tuple of stable opaque ids. Never a position, never a label.**

```ts
type AnnotationAnchor =
  | { scope: 'analysis' }
  | { scope: 'alternative'; alternativeId: Id }
  | { scope: 'criterion';   criterionId: Id }
  | { scope: 'group';       groupId: Id }
  | { scope: 'group-pair';  alternativeGroupId: Id; criterionGroupId: Id }
  | { scope: 'cell';        alternativeId: Id; criterionId: Id; measure?: MeasureId };
```

Under that model, reorder and rename are *free* — which is the whole point, and is a genuine
advantage over every text-anchoring system above. Three operations still break it, and each needs a
designed answer rather than a hope:

1. **Split.** A criterion is divided into two. The anchor is now ambiguous. Record
   `supersededBy: Id[]` on the retired criterion; resolve the annotation to *all* successors and
   render it flagged ("this criterion was split into two").
2. **Delete / merge.** Never hard-delete an entity that carries annotations. Tombstone it
   (`retired: true, retiredAt, retiredBy`) and surface its annotations in an **orphaned
   annotations** tray — the orphan pattern described in §A.2, applied in a domain where orphaning
   should be rare enough to be worth a human's attention each time.
3. **Re-import.** `rubricator` producing a fresh run must not mint fresh ids and orphan the entire
   discussion. Ids are minted **once**, from a slug of the label at creation, then frozen; the
   entity keeps `aliases: string[]` of former slugs so a re-run that uses a renamed label still
   resolves. This is the single place a label participates in identity, and it does so exactly once.

And then, borrowing the redundancy idea rather than the redundancy machinery: store on each anchor a
**repair hint** — `{ labelAtAnchorTime, axisIndexAtAnchorTime }` — that is *never consulted for
resolution* and exists only to generate a human-readable repair suggestion when the id fails
("this comment was on *Ecosystem maturity*, which no longer exists; the nearest current criterion is
*Ecosystem*. Reattach?"). That is the Phelps-and-Wilensky principle [6] and the W3C multiple-selector
rule [8] scaled to a problem that needs a hundredth of their apparatus.

**Suggestion mode and resolve (EVIDENCE).** Docs' suggesting mode renders a proposed edit inline in
a distinct colour with deletions struck through, notifies the owner, and offers per-suggestion
Accept/Reject as well as `Tools > Review suggested edits > Accept all / Reject all` [10]. ADR-0011
§5 already specifies this shape. The detail worth copying is the *bulk* path: a reviewer who leaves
forty cell proposals is unusable without "accept all from this reviewer".

**Single best idea:** a comment thread that can be *resolved* — hidden by default, never deleted —
so the record of why a score moved survives the argument being over. **Single worst mistake:**
tying the comment's existence to the survival of the anchored content. In Docs, deleting the
anchored text is the moment you most want to keep the argument, and it is the moment the anchor
dies. `comparanda` must invert this: **deleting a criterion must never delete the argument about
whether that criterion should exist.** That is the strongest single design instruction in this
whole section.

#### A.3 Loomio and Polis — group deliberation

**Loomio (EVIDENCE).** A proposal "asks people to respond to a statement or course of action.
Participants choose a defined response and can explain their vote"; on the Consensus template "the
default responses let participants agree, abstain, disagree, or block", and "a block reason should
identify why adopting the proposal would violate a fundamental need or agreed principle" [11];
"votes and reasons update while the proposal is open, and participants can change their response";
and — the
sentence that matters — "the discussion, proposal, votes, reasons, and outcome form a record of how
the group reached its decision" [11]. Loomio ships several proposal *templates* (sense check,
advice, consent, consensus) so the group picks the decision rule before voting rather than
discovering it afterwards.

**Polis (EVIDENCE).** Polis runs machine learning "solely … on the polis opinion matrix of agrees,
disagrees and passes by participants on comments", using PCA and UMAP for dimensionality reduction
and k-means, Leiden community detection and hierarchical clustering for grouping [12]. Its headline
output is not a winner but *group-informed consensus*, which the project defines as "a measure of the
extent to which an opinion group in the conversation agrees (by vote) in response to a particular
comment" [28] — so what a report surfaces as consensus is what scores well *across* the discovered
opinion groups rather than on a single pooled average (REASONING, on that definition).

**Single best idea (Loomio):** a stance is paired with a short reason, and the pair is the record.
`comparanda`'s `justification` field is the same idea one level down, and ADR-0014's "an agent that
cannot cite a span should be recording `unknown`" is the same idea applied to machines. Steal
Loomio's *block* stance directly: it is ADR-0015's veto, expressed as a rater's position rather
than a criterion threshold, and the two should be reconciled in the UI vocabulary.

**Single best idea (Polis):** reporting *what the groups agree on despite disagreeing elsewhere*
rather than reporting an average. This is the exact form ADR-0011 §4's `disagreement` encoding
should take: not "how much spread is there", but "which cells do the disagreeing camps nonetheless
agree on" — because those are the cells you can build a decision on.

**Single worst mistake (Loomio, REASONING):** the proposal is a separate object from the thing being
argued about, so the reasoning attaches to a *decision event* and not to the *structure*. Six months
later you can find the vote and not the criterion. `comparanda`'s anchoring at every scope
(ADR-0011 §1) is the fix and should be defended when it looks expensive.

**Single worst mistake (Polis, REASONING):** the clustering is unfalsifiable to a participant. A
participant sees themselves placed in a group by an algorithm they cannot inspect, and there is no
affordance to say "that grouping is wrong". If `comparanda` ships seriation or agreement clustering
(ADR-0008, ADR-0015), every automatic arrangement must be presented as a *starting point the human
then adjusts* — which ADR-0008 already says — and the analysis must state its method at the point of
use, which ADR-0015 already says. Both are correct; this is corroboration, not correction.

#### A.4 Figma — multiplayer, saved states, and the "modified" state

**Mechanism (EVIDENCE).** When Figma reconciles an instance against its main component, layer
identity is reconstructed by **name and hierarchy**, not by a stable id: "The layer names of the
current instance and the variant or instance you're selecting must match", and for text, "Figma
keeps any changes you've made to text layers if the name of the text layer is the same between
components. Figma will also check if the text layer's hierarchy is similar" [13]. Overrides are lost
when the matched properties diverge, and reset is offered both wholesale and per-property: "You can
choose to reset the entire instance, or just a specific property" [13].

**Single best idea:** the *per-property* reset, and the fact that "modified" is a computed,
always-visible state rather than a flag someone remembered to set. This is exactly ADR-0007's
dirty-state requirement, and Figma is the proof that it is learnable. Copy the granularity too:
ADR-0007 currently offers `Save`, `Save as new`, `Revert` at the whole-view level; add
**revert-this-one-thing** (revert just the column order, keep my grouping), because in practice a
user diverges from a saved view in one dimension and wants to keep the rest.

**Single worst mistake:** name-and-hierarchy matching as the identity mechanism. It is the exact
failure mode `comparanda` must avoid — a rename silently orphans the override, and there is no
diagnostic, only a value quietly reverting. Everything in §A.2 above is a direct consequence of
taking this lesson seriously: **never let a human-editable label participate in identity resolution.**

#### A.5 Miro — spatial arrangement

**Mechanism (EVIDENCE).** Miro's presentation model makes *frames* the slides, and presentation
mode locks participants into the presenter's sequence while still letting them "collaborate and move
freely on the canvas" when the presenter goes to canvas [14]. Separately, objects can be locked, and
on paid plans a *Protected Lock* "ensures that only the board owner or co-owner who locked an item
can unlock it" [15].

**Single best idea:** a *frame* — a named, ordered, re-enterable slice of the artifact used to walk
someone through a finding, distinct from the artifact itself. `comparanda`'s domain model already
says "showing one group at a time is how you walk someone through a finding". Saved views (ADR-0007)
plus an **ordered sequence of saved views** is a narrative mode, and it is close to free once saved
views exist. This is the highest-value cheap feature identified in this whole review.

**Single worst mistake (REASONING):** unconstrained spatial arrangement means the layout carries
meaning that the data model cannot express, so nothing downstream can read it — you cannot query a
Miro board for "which options did we group together". `comparanda` should resist any arrangement
affordance that is not a permutation or a grouping, both of which *are* expressible.

#### A.6 Observable, and Jupyter/Quarto — reproducible published analysis

**Mechanism (EVIDENCE).** Quarto's `embed-resources: true` "will produce a standalone HTML file with
no external dependencies, using `data:` URIs to incorporate the contents of linked scripts, style
sheets, images, and videos" [16]. (The older `self-contained` option is commonly described as
deprecated in favour of `embed-resources`, following Pandoc 3.0's split of `--self-contained` into
`--embed-resources` and `--standalone`; that history is **not** stated on the cited Quarto page
— *(UNVERIFIED — could not locate source)*.) Observable Framework moves the data work to build time:
"**Data loaders** generate static snapshots of data during build … data can be highly optimized (and
aggregated and anonymized), minimizing what you send to the client. And since data loaders run only
during build, your users don't need direct access to your data warehouse, making your dashboards more
secure and robust" [17].

**Single best idea:** the **build-time/run-time split**. Everything expensive, everything that needs
credentials, and everything that needs a network happens at build; the artifact that ships is inert.
This is precisely the architecture ADR-0013 needs, and it settles a question ADR-0004 leaves open:
**JSON Schema emission is a build-time concern and must never be in the browser bundle** (see §B.5 —
the classic Zod barrel import that provides `toJSONSchema`, bundled with the comparanda-shaped
schema, measures 61.8 kB gzip, against 5.5 kB for the same schema on `zod/mini`).

**Single worst mistake (REASONING):** Observable's classic notebooks tied reproducibility to a
hosted runtime and a proprietary cell format, so "reproducible" meant "reproducible on Observable".
`comparanda`'s equivalent temptation is a standalone file that quietly needs a font from a CDN or an
avatar from an identity provider. That is why the zero-network CI check in ADR-0013 is not a nicety
— see §B.9, where I recommend upgrading it from a *test* to an *enforced* property.

#### A.7 Dedicated MCDA tools

**Mechanism (EVIDENCE).** 1000minds implements PAPRIKA — "Potentially All Pairwise RanKings of all
possible Alternatives" — in which "the decision-maker [is] asked a series of simple pairwise ranking
questions based on choosing between two hypothetical alternatives defined on just two criteria (or
attributes) at a time and involving a trade-off", published as Hansen & Ombler (2008) in the
*Journal of Multi-Criteria Decision Analysis* [18]. SuperDecisions "is decision support software that
implements the AHP and ANP" [19]. TransparentChoice is "built on the Analytic Hierarchy Process
(AHP)" and positions itself for project prioritisation and portfolio management, capturing
stakeholder judgement "through structured, collaborative surveys" [20]; its consistency checking is
not described on that page *(UNVERIFIED — could not locate source)*. Criterium DecisionPlus
(InfoHarvest) is a Windows decision manager applying "a structured methodology to decision making";
the vendor's own product page still advertises version 3.0 as "our current version", notes it "will
NOT install on Windows Vista", and carries a feature banner reading "Coming Q4 2008" [21] — i.e. it
is essentially a historical product, which is itself informative about the category's commercial
durability. (Its widely-reported support for AHP and SMART with uncertainty analysis is not stated
on that page *(UNVERIFIED — could not locate source)*.)

**Single best idea (1000minds/PAPRIKA):** *never ask for a weight; ask for a choice.* Humans are
unreliable at stating "criterion A is 1.7× criterion B" and comparatively reliable at "I'd take this
hypothetical option over that one". Weights are then *inferred* from revealed preference. If
ADR-0015's opt-in weighted aggregation is ever built, this is how the weights should be elicited —
and it also gives ADR-0005's "elicit the frame before scoring" a concrete mechanism.

**Single best idea (all four):** consistency checking. AHP's consistency ratio is a check on the
*elicitation*, not the data, and it is the one thing this category does that a spreadsheet cannot.
`comparanda`'s analogue already exists in the plan — inter-rater agreement (ADR-0011) — but the
framing should be borrowed: present it as *a check on whether the exercise is trustworthy*, not as
a statistic.

**Single worst mistake:** the whole category ends in a ranked list with a number, and AHP's number
is contested at the level of its axioms — the rank-reversal critique (Dyer, 1990) is that a
method whose output ranking can flip when an irrelevant alternative is added or removed is
inconsistent with multi-attribute utility theory [22]. ADR-0015's refusal to compute a default
aggregate is therefore not squeamishness; it is the correct response to an argument that has been
unresolved since 1990. **Confirm ADR-0015 unchanged.** Add one thing: if weighted aggregation is offered, the
sensitivity analysis ADR-0015 already lists should specifically include an
*add/remove-an-alternative* perturbation, because that is the perturbation the literature says
breaks these methods.

#### A.8 Academic reorderable-matrix tools — Bertifier

**Mechanism (EVIDENCE).** Perin, Dragicevic and Fekete's *Revisiting Bertin Matrices: New
Interactions for Crafting Tabular Visualizations* (IEEE TVCG, VIS 2014) presents Bertifier, "a web
app for rapidly creating tabular visualizations from spreadsheets", drawing on Bertin's method whose
goal was "to simplify without destroying". Tables are manipulated through **crossets**, "a new
interaction technique for rapidly applying operations on rows and columns", and the system supports
both manual reordering and automatic seriation via an **optimal-leaf-order** computation [23]. It
deliberately follows Bertin's black-and-white aesthetic, and was evaluated with eight users, whose
sessions "suggest that Bertifier has the potential to bring Bertin's method to a wider audience of
both technical and non-technical users" [23].

**Single best idea:** the *crosset* — a control that lives at the intersection of a row header and a
column header and applies an operation to that row or column, so that every per-axis operation
(reorder, group, encode, hide) is reachable from one consistent place rather than from a scattered
mix of context menus and toolbars. `comparanda`'s matrix has exactly the same operation set on
exactly the same two axes. Steal the pattern outright, and make its keyboard equivalent the
*primary* implementation (see §B.6).

**Second-best idea, and it settles an open question:** optimal leaf ordering over hierarchical
clustering is what a peer-reviewed, human-evaluated Bertin tool chose as its automatic-ordering
default [23]. ADR-0008 asks for "at least one principled algorithm"; this is the one to implement
first. It is `O(n³)` in the worst case, which is irrelevant at tens×tens.

**Single worst mistake (REASONING):** Bertifier is an authoring tool with no persistence story for
the *reasoning* — you craft the matrix, you export the image, and the argument evaporates. That is
the exact failure `comparanda` exists to prevent, and it is worth saying so explicitly in the README
because it is the difference between this project and a very good visualisation library.

#### A.9 Summary

| Prior art | Single best idea → steal | Single worst mistake → avoid |
|---|---|---|
| Airtable / Notion / Coda | Personal / shared / **locked** as three modes of one saved view [3][4][5] | Grouping as configuration, not as an annotatable object |
| Google Docs | Threads that **resolve** without deleting; per-suggestion and bulk accept [10] | Position-and-revision anchors, disclaimed by the vendor [2]; deleting content deletes the argument |
| Loomio | A stance is inseparable from its short reason; **block** as a first-class stance [11] | Reasoning attaches to a decision event, not to the structure |
| Polis | Report **group-informed consensus**, not an average [12][28] | Algorithmic grouping the participant cannot contest |
| Figma | "Modified" as a computed, always-visible state; **per-property** revert [13] | Name-and-hierarchy as identity — the exact bug our anchors must not have |
| Miro | **Frames**: a named, ordered walk through the artifact [14]; protected lock [15] | Layout that carries meaning the data model cannot express |
| Observable / Quarto | Build-time/run-time split; `embed-resources` as the artifact [16][17] | Reproducibility that depends on a hosted runtime |
| MCDA tools | Elicit weights from **choices**, not numbers (PAPRIKA) [18]; consistency as a trust check | A single ranked number whose axioms are contested [22] |
| Bertifier | **Crossets**; optimal leaf ordering as the seriation default [23] | No persistence for the reasoning — export the image, lose the argument |

---

### Part B — the stack

#### B.1 What `@zodal/core` actually gives us

Read from source, not from the README.

- **`defineCollection(schema, config?)`** — the entry point. Returns a `CollectionDefinition` with
  `idField`, `labelField`, `fieldAffordances`, `affordances`, `getVisibleFields()`,
  `getSearchableFields()`, `getContentFields()`, `hasBifurcation()`, and `explain(field)`.
- **A six-layer inference engine** (`inference.ts`, 586 lines) resolving each affordance through
  `type → refinement → name → meta → registry → config`, with `inferFieldAffordancesWithTrace()`
  producing an `InferenceTrace` of which layer set which value and why. `explain()` is a real
  debugging affordance and is the single most useful thing in the package.
- **A large, opinionated affordance vocabulary** (`types.ts`, 424 lines): per-field `sortable`,
  `filterable`, `searchable`, `groupable`, `aggregatable`, `editable`, `inlineEditable`,
  `immutableAfterCreate`, `visible`, `detailOnly`, `pinned`, `title`, `badge`, `truncate`,
  `editWidget`, `storageRole`; per-collection CRUD/bulk/search/pagination/grouping/**savedViews**/
  selection/columnOrder/**reorder**/undo. Note that `savedViews`, `columnOrder`, `reorder` and
  `selectable` already exist as declared affordances — the vocabulary anticipates ADR-0007 and
  ADR-0008.
- **`affordanceRegistry`** — a `WeakMap` keyed by Zod schema instance, whose stated purpose is that
  `.meta()` placed on a schema before `.optional()` is lost, because the wrappers return new
  instances. This is a real Zod footgun and the registry is the workaround. `comparanda` will hit it:
  every optional measure is `z.optional(...)`.
- **Codecs** — `Codec`, `composeCodecs`, `identityCodec`, `createCodec`, `dateIsoCodec`,
  `dateEpochCodec`, `dateEpochMsCodec`, `jsonCodec`. Small and useful for the wire format.
- **`ContentRef` / bifurcation types** — metadata-versus-content field classification. Directly
  reusable for ADR-0014: an **embedded evidence excerpt is a content field**, and the bifurcation
  machinery is exactly the seam that lets the standalone bundle carry excerpts inline while the
  connected build fetches them through a resolver, with no change in consuming code.

**Verified by execution**, not inferred: `defineCollection` works on a `zod/mini` schema. Running
`defineCollection(zm.object({id: zm.string(), label: zm.string(), score: zm.optional(zm.int())}))`
against the built `@zodal/core` returned `idField: 'id'`, `labelField: 'label'`,
`getVisibleFields(): ['label','score']`, and for `score` an affordance of
`{sortable: 'both', filterable: 'range', zodType: 'number'}`. Inference reads `_zod.def`, which
classic and mini schemas share. **This is the enabling fact for the entire recommendation below.**
(One cosmetic wrinkle: `z.int()` reports `zodType: 'number'`, not `'int'`.)

**Verdict: adopt `@zodal/core`.** It costs 10.8 kB raw / 3.8 kB gzip standalone (measured, §B.5), it
gives us the affordance layer ADR-0004 asks for, and `explain()` will pay for itself the first time
a criterion renders read-only for a reason nobody can find.

#### B.2 Is `@zodal/store`'s `DataProvider` the right shape for the `DataSource` port?

**First, a factual correction to ADR-0006.** ADR-0006 says "All persistence goes through a **zodal
store** interface — a key-value mapping the caller supplies." **No such interface exists in zodal.**
`@zodal/store` exports `DataProvider<T>`, which is collection CRUD:
`getList(params) / getOne(id) / create / update / updateMany / delete / deleteMany`, plus optional
`upsert`, `getCapabilities`, `subscribe`, `getContent`, `setContent`, `getUrl`. There is no
`Mapping`-shaped store anywhere in the packages I read. ADR-0006's wording should be amended before
it misleads an implementer into writing against an interface that isn't there.

**Second, the fit is better than the mismatch suggests, in three of four cases.**

| `comparanda` port | Shape | `DataProvider` fit |
|---|---|---|
| Saved views (ADR-0007) | A collection of named `SavedView` records | **Exact.** `getList` / `create` / `update` / `delete` is literally the CRUD ADR-0007 specifies |
| Annotations (ADR-0011) | A collection of threaded `Annotation` records with an anchor | **Exact**, with `filter` doing anchor lookup |
| Rater assertions (ADR-0011 §3) | A collection of `Assertion` records | **Exact** |
| The analysis itself (ADR-0013 `DataSource`) | One versioned aggregate document | **Poor.** It is not a queryable set |

For the fourth, take the pattern `zodal-dials` already established: it models "a settings document
as a degenerate one-item zodal collection, reusing zodal's affordance inference, renderer registry,
codecs, `explain()`, and content/metadata bifurcation". Do the same — an `AnalysisSource` is a
`DataProvider<Analysis>` over exactly one item. `getOne(analysisId)` loads it, `update()` writes it,
`subscribe()` gives ADR-0013's "load / subscribe" for free, and the standalone frozen source is a
provider that reports `canUpdate: false`.

**Third — and this is the find of the review — `getCapabilities()` is the mechanism ADR-0013 asks
for and does not name.** ADR-0013 requires that "degradation must be graceful and visible:
standalone shows saved views working locally while annotations are read-only, and says so, rather
than presenting controls that silently do nothing." `ProviderCapabilities` already carries
`canCreate / canUpdate / canDelete / canBulkUpdate / canBulkDelete / canUpsert / serverSort /
serverFilter / serverSearch / serverPagination / realtime / bifurcated`, with a documented
`DEFAULT_CAPABILITIES` fallback, and the package's own comment calls it "zodal's novel contribution
over react-admin/Refine. The same collection definition works with both a fully-capable server
backend and a simple in-memory store, with the UI automatically adjusting."

That is exactly ADR-0013's requirement, already implemented. **The view must read capabilities and
render affordances accordingly, and `comparanda` should never invent a parallel "is this
read-only?" flag.** This should go into the ADR as a binding rule, because the failure mode ADR-0013
warns about — controls that silently do nothing — is precisely what happens when a second source of
truth for editability appears.

**Verdict:** adopt `DataProvider` as the port shape for all four, with the analysis as a one-item
provider; amend ADR-0006's "key-value mapping" wording; make capability discovery the single source
of truth for what the UI offers.

#### B.3 Are `@zodal/ui`'s generators usable, or in the way?

`@zodal/ui` exports three generators (`toColumnDefs`, `toFormConfig`, `toFilterConfig`), a
framework-agnostic `createCollectionStore` plus composable slices (sorting, filter, pagination,
selection, column) and a Zustand adapter, a `createRendererRegistry` with scored `RendererTester`
predicates (`zodTypeIs`, `hasRefinement`, `fieldNameMatches`, `metaMatches`, `editWidgetIs`,
`storageRoleIs`, `and`, `or`, `PRIORITY`), plus `toPrompt()` and `toCode()`.

**The generators are structurally inapplicable to the matrix, and this is not a criticism of them.**
`toColumnDefs` maps *schema fields* to columns; it answers "render a collection of records, one
column per field". In `comparanda`, the columns are **criteria**, which are *runtime data* — entries
in a `criteria` array — not fields of a schema. There is no schema field named `Ecosystem maturity`.
The whole generator family assumes the wrong thing about where the column set comes from. Using it
would mean synthesising a Zod schema per analysis at runtime, which drags the classic-Zod builder API
(and the 61.8 kB gzip measured for the classic barrel import in §B.5) into the browser to build a
schema we already know the shape of.

What *is* worth taking:

- **`createRendererRegistry` + the tester predicates** are a good design for ADR-0010's pluggable
  encoding registry — a scored resolution over declarative predicates, with an `explain()` that
  shows every candidate's score. **Copy the pattern; do not import the package**, because our
  predicates are over `(criterion, measure, level-of-measurement)`, not over Zod types. And see
  §B.10 for the tree-shaking hazard this pattern creates.
- **The state slices** (`createSelectionSlice`, `createColumnSlice`) are close to ADR-0007's view
  state, but they are TanStack-Table-shaped (`rowSelection: Record<string, boolean>`,
  `columnOrder: string[]`, `grouping: string[]`) and `comparanda` needs symmetric state on *both*
  axes. Write our own `ViewState`; the slice-factory pattern is worth mirroring so that dirty-state
  comparison (ADR-0007) can be a structural diff over a plain object.
- **`toPrompt()`** generates an LLM prompt describing a collection from its schema. That is a
  cross-repo idea worth flagging to `rubricator`: the agent's description of the analysis contract
  could be generated from the same schema rather than hand-maintained, which is exactly ADR-0004's
  "one contract, two consumers" argument extended to the prompt.

**Verdict: do not depend on `@zodal/ui` in the view.** Take two patterns, write ~200 lines, and keep
the generator code we would not call out of the bundle. No size figure is quoted here: unlike every
other number in this section, `@zodal/ui` was **not** measured *(UNVERIFIED — no measurement taken)*,
and the argument does not rest on one.

#### B.4 Does `zodal-groups` already solve grouping?

Substantially, yes — better than I expected, and it matches ADR-0008 almost line for line.

`@zodal/groups-core` stores membership as "a flat set of reified edges" and computes every
hierarchy, tag cloud, facet browser and breadcrumb as a **projection** over that edge set. It ships:

- **profiles** — `filesystem` (single-homed), `labels` (Gmail semantics: items multi-parent, group
  tree is a tree), and others, as *named restrictions on one model*. ADR-0008's "membership is
  many-to-many (groups are tags, not a partition)" and "groups may nest in the schema; render one
  level initially" is the `labels` profile exactly;
- **projections** — `projectTree` (with `toggleExpanded`, `expandedForPath`, `twinsOf`),
  `projectColumns`, `allPaths` / `primaryPath` / `breadcrumbs` / `otherLocations`, and a facet panel
  with `scopeFilter` — which is precisely ADR-0008's "show me this group and everything under it";
- **intensional ("smart") groups** — `smartGroup(rule)`, `unfiled`, `multiHomed`. `unfiled` and
  `multiHomed` are directly useful: "which criteria has nobody grouped yet";
- **fractional-index ordering** — `orderBetween(before?, after?)` mints a sortable string strictly
  between two neighbours so that a reorder writes **one** record rather than renumbering every
  sibling, and the rank lives on the *membership edge* rather than the item, because "an item in
  three groups needs three ranks". This is the correct primitive for drag-reorder within a group;
- a documented sharp edge worth inheriting verbatim into our own docs: locale-aware string
  comparison silently corrupts fractional-index ordering (`'a'.localeCompare('B')` is negative under
  most locales, positive under byte comparison), so comparison must be by code unit and a Postgres
  column must be `COLLATE "C"`. This bug is quiet — "the list is *mostly* right" — which is exactly
  the kind of defect that survives review;
- `lint()` for structural health, `findCycle` / `detectCycles` for the polyhierarchy case.

Measured cost: **16.1 kB raw / 5.7 kB gzip** for `defineGroups` (§B.5). It has `zod` as an *optional*
peer dependency, so it does not drag a validator in.

**Two gaps `comparanda` must fill itself:**

1. `orderBetween` orders members *within a group*. `comparanda` also needs a **global axis order**
   in view state (ADR-0007 saves "alternative order, criterion order"), which is a different object.
   Use fractional indices there too, for the same write-amplification reason, but store it in view
   state rather than on an edge.
2. **Group-pair inapplicability** — "criteria group *G* does not apply to alternatives group *H*",
   which auto-populates a block with `not-applicable` — has no analogue in `zodal-groups`. It is a
   relation between two *group spaces*, and `zodal-groups` models one space at a time. Build it on
   top as a `comparanda` concept; it is a small table of `(alternativeGroupId, criterionGroupId)`
   pairs plus a derived-missingness rule.

**Verdict: adopt `@zodal/groups-core` for grouping on both axes**, with the `labels` profile, and
build the two gaps above in `comparanda/core`. This removes a genuinely fiddly subsystem (nested,
multi-homed, orderable groups with cycle detection) from our scope for 5.7 kB gzip.

#### B.5 Measured bundle sizes

All figures measured on this machine on 2026-08-18, with **esbuild 0.27.4**, flags
`--bundle --minify --format=esm --platform=browser` (plus `--define:process.env.NODE_ENV=\"production\"`
for React), and `gzip -9` for the compressed column. Same bundler, same settings, same day, so the
columns are comparable to each other — which is the property published third-party size tables
usually lack.

**Schema layer:**

| Entry | Raw bytes | gzip -9 |
|---|---:|---:|
| `import { z } from 'zod'` (v4.3.6) + a comparanda-shaped schema | 310,946 | 61,756 |
| Named imports from `zod` classic, same schema | 68,204 | 19,032 |
| `import * as z from 'zod/mini'`, same schema | **15,250** | **5,491** |
| `@zodal/core` `defineCollection` alone (no zod value import) | 10,819 | 3,785 |
| `zod/mini` + `@zodal/core` `defineCollection` | **22,369** | **7,969** |
| `@zodal/groups-core` `defineGroups` | 16,063 | 5,701 |

Three things fall out. **(a) The `z` namespace barrel is the single most expensive line of code in
the project.** Importing `z` as a namespace object keeps the entire classic surface alive —
inspection of the output confirms `toJSONSchema`, the locale table, `emoji`, `ipv6`, `base64url`,
`jwt` and `duration` all present — because a namespace object's properties cannot be
dead-code-eliminated. On raw bytes, named imports recover 4.6× (3.2× on gzip) and `zod/mini`
recovers **20×**.
**(b) `@zodal/core` is nearly free** (3.8 kB gzip) and its `dist` emits a bare `import "zod"` which
esbuild drops entirely, because Zod declares `"sideEffects": false`. **(c) `zod/mini` schemas still
emit JSON Schema**: I verified that `zc.toJSONSchema(miniSchema)` produces correct draft-2020-12
output. So the ADR-0004 contract artifact can be generated by a **Node-only build step** that
imports classic Zod, while the browser only ever sees `zod/mini`.

**View layer:**

| Entry | Raw bytes | gzip -9 |
|---|---:|---:|
| React 19.2.6 + `react-dom/client`, one trivial `useState` component | 193,327 | 60,146 |
| Preact 10.29.1 + `preact/hooks`, same component | **12,781** | **5,331** |
| `preact/compat` + `preact/compat/client`, same component | 18,591 | 7,456 |
| Vanilla TS | 0 | 0 |

Preact is **15.1× smaller raw** and **11.3× smaller gzipped** than React for the same trivial app.
The React-compatibility escape hatch (`preact/compat`, which lets React-ecosystem components run)
costs only **2.1 kB gzip / 5.8 kB raw** more than bare Preact — cheap insurance.

For the frameworks not installed on this machine I did not measure and will not invent numbers.
Their own primary claims: Preact's site says "Fast 3kB alternative to React" without stating whether
that is minified or compressed [24] (my measured 5.3 kB gzip for the realistic `preact + hooks +
render` entry is the honest figure). Lit states: "Weighing in at around 5 KB (minified and
compressed), Lit helps keep your bundle size small and your loading time short" [25]. Svelte and
Solid ship most of their runtime cost as compiler output proportional to component count rather than
as a fixed runtime, so a single-number comparison is not meaningful for them; I found no primary
measurement I would stake a decision on **(UNVERIFIED — no primary, comparable measurement located)**.

**Why raw bytes matter more than gzip here (EVIDENCE + REASONING).** The standalone artifact is a
file on disk that gets attached to an email and opened over `file://`. No transport applies gzip to
a saved attachment, and mail encodes attachments in base64, which *adds* about 33%. So the column
that governs whether the file is mailable is the **raw** one, and the raw gap is the larger of the
two. React + classic-Zod-as-namespace is 504 kB before a single line of `comparanda`; Preact +
`zod/mini` + `@zodal/core` + `@zodal/groups-core` is **51 kB**.

**A constraint on the mailed file that is not about size at all.** Microsoft Defender for Office 365's
common attachments filter lists `htm` and `html` among the "additional file types to select in the
Defender portal", and its true-type matcher recognises `html` regardless of the filename extension —
so renaming the file does not evade it [26]. Note the exact status: `htm`/`html` sit on the *opt-in*
additional list, not in the default blocked set, so the filter bites only where an admin has selected
them — but the option exists because HTML attachments are a common phishing vector. **Expect the
mailed HTML file to be rejected or quarantined at some recipients regardless of its size** (REASONING,
on the mechanism documented in [26]), and `comparanda` should not discover this in the field.
The build command should say so in its output and the docs should give the workaround (share via a
link, or have the recipient's admin allow-list). This does not change the recommendation; it changes
what the CLI prints.

#### B.6 The framework decision

**Recommend Preact.** The reasoning, in order of weight:

1. **Measured size**, §B.5. At 12.8 kB raw it disappears into the noise of a realistic analysis
   payload (a 22×12 matrix with per-cell justifications and evidence excerpts is comfortably
   50–150 kB of JSON). At 193 kB raw, React is the largest single thing in the file and is bigger
   than the data it exists to show. That is indefensible for an artifact whose entire premise is
   "mail it to someone".
2. **It is boring and maintained.** `BRIEF.md` asks for dependencies that "must still build in three
   years". Preact has shipped since 2015, has no compiler, no plugin, no build-step coupling, and
   works with plain esbuild and TSX. Svelte and Solid are excellent and both couple the source to a
   compiler and its plugin; that is a build-toolchain bet, and the brief explicitly asks us not to
   make optional bets.
3. **`preact/compat` is a real escape hatch at a measured 2.1 kB gzip.** If a React-ecosystem
   component becomes necessary, we are not stuck. Lit has no equivalent, and its web-component model
   would put every cell behind a shadow root, which complicates exactly the two things this project
   cares most about — computed text contrast against a rendered background (ADR-0010) and a single
   coherent `role="grid"` accessibility tree.
4. **Against vanilla TS + a tiny reactive layer:** the saving is at most ~13 kB raw, and the cost is
   that we own a reactive renderer forever. The specific thing a diffing renderer buys us here is
   **DOM identity preservation across re-render**, which is what keeps keyboard focus and the roving
   `tabindex` stable while rows are being reordered — the single fiddliest requirement in the
   visualisation brief. Hand-rolling that is where the bugs live. (REASONING; the size figures are
   evidence, the focus-stability argument is judgement.)
5. **Against Lit:** shadow DOM plus `forced-colors` plus computed-contrast plus print is a bad
   combination, and ADR-0010 needs all four.

**Consequence for ADR-0008 — withdraw the `dnd-kit` recommendation.** `dnd-kit` is a React library;
adopting it means pulling `preact/compat` plus `dnd-kit` into the bundle to solve a problem
`comparanda` has in a very restricted form. The usual counter-argument is accessibility, and it is
weaker than it looks. The leading framework-agnostic alternative,
`@atlaskit/pragmatic-drag-and-drop`, describes its core package as "vanillaJS library (authored in
TypeScript) that can be used with any view library", and its README says of the set of packages:
"These pieces are unopinionated about visual language or **accessibility**, and have no dependency on
the Atlassian Design System" [1]. (The project does publish separate accessibility guidance and an
optional React accessibility package, so this is a statement about what the core hands you for free,
not a claim that the project neglects accessibility.) The inference: drag libraries give you a pointer
abstraction, not an accessible reorder, and you write the keyboard path and the announcements either
way (REASONING).

So: **write the keyboard path first and treat it as the reference implementation** — select a header,
`Alt`+`Arrow` to move it, announce the new position through an `aria-live="polite"` region — and add
pointer dragging as a second, thinner path over the same `moveTo(axis, fromIndex, toIndex)` core.
The scope is one axis at a time, one container, ≤ ~40 headers, no nesting, no virtualisation, no
auto-scroll across containers. Adopt `@atlaskit/pragmatic-drag-and-drop` only if auto-scroll or
cross-container dragging turns out to be needed; **do not adopt `dnd-kit`**.

#### B.7 Should `comparanda/react` exist in v1?

**No.** Three reasons.

1. It doubles the interaction-test matrix (`BRIEF.md`: "the view needs interaction tests for
   reorder, keyboard operation and dirty-state") for a wrapper that adds no behaviour.
2. With Preact chosen, `comparanda/react` means either shipping `preact/compat` to consumers who
   already have React — a second VDOM in their bundle — or maintaining a second renderer. Both are
   worse than not shipping it.
3. The actual consumer need is "mount this into my app", and it is satisfied by an imperative mount
   contract that any framework wraps in a dozen lines:

```ts
// comparanda/view
export function mountMatrix(
  el: HTMLElement,
  props: MatrixProps,
): { update(next: Partial<MatrixProps>): void; destroy(): void };
```

Document a ~15-line React wrapper (`useRef` + `useEffect` + `update` on prop change) and a Vue one
in the README. If two real consumers ask for a published wrapper, add `comparanda/react` in v2 — by
which time the subpath structure makes it mechanical, which is exactly ADR-0005's own argument.

#### B.8 How the standalone build should be produced

**Use Vite with `vite-plugin-singlefile`**, not a hand-rolled esbuild-plus-inline script.

The plugin lets you "inline all JavaScript and CSS resources directly into the final
`dist/index.html` file",
adjusts the Vite config automatically (`useRecommendedBuildConfig`, default `true`), and exposes
`removeViteModuleLoader`, `inlinePattern`, `deleteInlinedFiles` and `overrideConfig` [27]. Its stated
limitations matter and are all acceptable here: it produces "one HTML file and no other files", so it
is unsuitable for multi-entry apps (we have one entry); "static resources in `public` folder (like
`favicon`) are not inlined by Vite, and this plugin doesn't do that either" (so ship no `public`
folder); and "inlining of SVG isn't supported directly by Vite, so it isn't supported directly here
either" (so any icon must be an inline `<svg>` element in source, never an `import` of a `.svg`
file — worth an ESLint rule).

Why not esbuild + a hand-rolled inliner: we would reimplement asset inlining, CSS extraction and
data-URI encoding, and get the SVG and font cases wrong the first two times. Prefer the maintained
thing, per the brief. Quarto reached the same conclusion for the same artifact shape —
`embed-resources: true` "will produce a standalone HTML file with no external dependencies, using
`data:` URIs" [16] — which is corroboration that this is the settled way to build this kind of file.

**Build pipeline (concrete):**

```
comparanda build <analysis.json> [--out report.html] [--view <saved-view-id>]
  1. validate  analysis.json against the published JSON Schema   (fail loudly, cite the path)
  2. inline    the analysis as  <script type="application/json" id="comparanda-analysis">
  3. vite build --config standalone.vite.config.ts   (viteSingleFile)
  4. inject    a CSP meta tag (§B.9)
  5. assert    zero network (§B.9) — the build FAILS if the check fails
  6. report    raw bytes, gzip bytes, and the mail-gateway warning (§B.5)
```

Step 2 as `<script type="application/json">` rather than as a JS literal avoids escaping bugs and
keeps the data inspectable by anyone who opens the file in an editor — which is itself a small
auditability win, and consistent with ADR-0014's spirit.

Step 5 must be part of `build`, not only of CI. ADR-0013 asks for a CI check; a check that only runs
in CI does not protect someone who runs `comparanda build` locally and mails the result.

#### B.9 How to CI-assert zero network requests

**Do both of these. They are not redundant — one enforces, one detects.**

**(1) Enforce it in the artifact with CSP.** Inject into the built `<head>`:

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'unsafe-inline';
  style-src  'unsafe-inline';
  img-src    data:;
  font-src   data:;
  connect-src 'none';
  form-action 'none';
  base-uri 'none'">
```

`connect-src 'none'` makes `fetch`, `XMLHttpRequest`, `EventSource`, `WebSocket` and
`navigator.sendBeacon` *fail at runtime* rather than merely being absent, and `default-src 'none'`
blocks any resource type not explicitly re-allowed. `'unsafe-inline'` for script and style is the
price of a single-file artifact with no external resources; in a `file://` document with no network
capability at all, it grants nothing. **This turns ADR-0013's "no component may reach past its port"
from a code-review convention into a property enforced by the browser**, which is the strongest
available answer and is worth writing into the ADR.

**(2) Detect it in CI with a real browser.** Playwright, loading the built file over `file://`:

```ts
const seen: string[] = [];
page.on('request', r => { if (!r.url().startsWith('file://')) seen.push(r.url()); });
await context.route('**/*', route => route.abort('failed'));   // belt and braces
await page.goto(`file://${builtHtml}`);
await page.getByRole('grid').waitFor();
await exerciseTheView(page);        // sort, reorder, switch encoding, open the detail panel
expect(seen).toEqual([]);
```

Two details that make this test actually catch things rather than pass vacuously. First, **exercise
the view** — a `fetch()` inside a cell renderer only fires when that renderer runs, so a test that
loads and asserts will miss precisely the bug ADR-0013 names. Second, assert the **absence of console
errors** too, because a CSP violation surfaces as a console error and would otherwise be invisible.

**(3) A cheap static grep as a pre-filter**, so the failure message is legible: reject the built file
if it contains `http://`, `https://`, `//fonts.`, `@import url(`, `new Worker(`, `importScripts(`,
`EventSource(`, `new WebSocket(`, or `sendBeacon(`. This runs in milliseconds and names the offending
string, where the Playwright test only names the URL.

#### B.10 Does one package with subpath exports actually tree-shake? — the ADR-0005 condition

**Yes, and I verified it — but the verification uncovered a hazard that is more important than the
question.**

I built a fixture package with `"sideEffects": false` and an export map of
`{".": "./index.js", "./view": "./view.js"}`, where `view.js` imports a `heavy.js` module carrying a
unique marker string, and bundled two consumers with esbuild.

| Package config | Core-only consumer | View consumer |
|---|---|---|
| `sideEffects: false`, encoding **self-registers** at module scope | 43 B, marker absent ✅ | **65 B, marker absent — the encoding was silently deleted** ❌ |
| No `sideEffects` field, encoding self-registers | 43 B, marker absent ✅ | 176 B, marker present ✅ |
| `sideEffects: false`, encoding registered **explicitly by the consumer** | 43 B, marker absent ✅ | 180 B, marker present ✅ |

**Row 1 is the finding.** With `"sideEffects": false` declared — which is what you must declare to
get good tree-shaking — esbuild removed a module whose only purpose was its module-scope
`register('blended', heavyEncoding)` call, **from the bundle that needs it**. The view shipped; the
encoding registry was empty; nothing errored at build time. `"sideEffects": false` is a *promise to
the bundler* that importing a module for its side effects is never necessary, and a self-registering
encoding module breaks that promise.

ADR-0010 says encodings are "registered against the view rather than hard-coded", and `@zodal/ui`'s
`createRendererRegistry` is the model. If `comparanda` implements that with self-registering modules
— which is the natural way to write it — this bug is waiting. Therefore, as a binding rule:

> **Registries are populated by the composition root, explicitly. No module may register itself at
> module scope. `comparanda/view` exports the encodings as plain named exports; `mountMatrix` (or
> the caller) registers the ones it wants.**

This also *improves* the product: a consumer who only wants `value` and `uncertainty-suppressed`
does not ship `disagreement`, `staleness` and `completeness`, and tree-shaking now works *in their
favour* rather than against them.

**On the ADR-0005 question itself:** core-only isolation held in **all three** rows, including the
one with no `sideEffects` field at all. That is because a subpath export is a **separate module
graph** — a consumer importing `comparanda` never reaches `comparanda/view`, so there is nothing to
shake. **ADR-0005's condition of acceptance is met, and the package should not be split.** The
`sideEffects` field is still needed, but for a different reason: dropping unused *named exports*
from within one entry point.

**How to verify it continuously (this is the part ADR-0005 asks for):**

```
tests/bundle/
  core-only.fixture.ts      import { validateAnalysis } from 'comparanda';
  view.fixture.ts           import { mountMatrix }      from 'comparanda/view';
```

1. `esbuild core-only.fixture.ts --bundle --metafile=meta.json` → assert **no input path** in
   `meta.inputs` matches `/(^|\/)view\//` or `/preact/`. This is the direct, unambiguous assertion,
   and the metafile names the offending import chain when it fails, which a size budget does not.
2. Assert a **byte budget** on each fixture (raw and gzip), with the numbers checked into the repo
   and printed on failure. A budget catches accidental growth that the path assertion cannot.
3. `publint` and `@arethetypeswrong/cli` on the published tarball, to catch a broken `exports` map —
   the most common way subpath exports stop working, and one that a local bundle test does not see.
4. A **no-DOM assertion for core**: run the core test suite in a Node environment with no `document`
   or `window`, plus an ESLint `no-restricted-globals` rule scoped to `src/core/**`. ADR-0005 says
   "if you need a DOM API in `core`, the design is wrong"; this makes that a build failure rather
   than a review comment.

---

## What this means for the schema / the view / the agent

**Schema (`comparanda` core).**

- Author the Zod schema with `import * as z from 'zod/mini'`. Never `import { z } from 'zod'` in any
  file that can reach the browser bundle. Add an ESLint `no-restricted-imports` rule for it, because
  it is a 296 kB mistake that looks like a style preference.
- Emit JSON Schema in a **Node-only** entry (`comparanda/schema-tools`, or a `bin/` script) that
  imports classic `zod` for `toJSONSchema`. Verified: `toJSONSchema` accepts `zod/mini` schemas.
- Use `@zodal/core`'s `defineCollection` for affordances, and `affordanceRegistry.register()` for any
  affordance on a schema that gets wrapped in `z.optional(...)` — which is every optional measure.
- Model evidence excerpts as **content fields** (`storageRole: 'content'`) so ADR-0014's
  standalone-embedded versus resolver-fetched split falls out of zodal's bifurcation rather than
  being special-cased.
- `AnnotationAnchor` is the discriminated union in §A.2. Entities carry `id` (minted once from a
  slug, then frozen), `aliases: string[]`, `retired?: boolean`, `supersededBy?: Id[]`. Annotations
  carry a non-authoritative `repairHint: { labelAtAnchorTime, axisIndexAtAnchorTime }`.
- Order lives in fractional-index strings; comparison is `compareOrder`-style by code unit, never
  `localeCompare`. Copy `zodal-groups`' warning into our own module docstring.

**Ports (ADR-0013).**

```
AnalysisSource    = DataProvider<Analysis>        // degenerate one-item provider
SavedViewStore    = DataProvider<SavedView>
AnnotationSink    = DataProvider<Annotation>
AssertionStore    = DataProvider<Assertion>
IdentityProvider  = (unchanged, ADR-0012)
EvidenceResolver  = (unchanged, ADR-0014) — backed by getContent()/getUrl() where a provider exists
```

The view reads `getCapabilities()` and derives every enable/disable from it. There is no second
source of truth for editability.

**View.**

- Preact + TSX, built with Vite. `mountMatrix(el, props) => { update, destroy }` is the only public
  mounting contract. No `comparanda/react` in v1.
- Grouping from `@zodal/groups-core` with the `labels` profile, on both axes. `comparanda` adds the
  global axis order and the group-pair inapplicability table.
- Reorder: `moveTo(axis, fromIndex, toIndex)` as the core; keyboard (`Alt`+arrows, `aria-live`
  announcement) as the reference implementation; pointer dragging as a second path over the same
  core. No `dnd-kit`.
- Seriation default: **optimal leaf ordering over hierarchical clustering**, per Bertifier [23].
  Presented as a starting point, never as a mode.
- Encodings are plain named exports registered explicitly by the composition root. Never
  self-registering. (§B.10.)
- Crossets — one control at each header intersection carrying that axis's whole operation set —
  as the interaction model [23].

**Agent (`rubricator`).**

- Ids are minted once and are stable across runs. A re-run that renames a criterion must reuse the
  existing id and push the old slug into `aliases`. This is a contract requirement, not an
  implementation detail: violating it orphans every annotation in the document.
- `@zodal/ui`'s `toPrompt()` is a pattern worth stealing — generate the agent's description of the
  analysis contract from the same schema rather than hand-maintaining it in prompt text.

---

## Draft ADR body — ready to become ADR-0017

> **ADR-0017: Preact for the view; `zod/mini` for the runtime schema; explicit registries**
>
> **Status:** proposed
> **Date:** 2026-08-18
>
> ### Context
>
> `BRIEF.md` requires the framework be chosen in an ADR before view code is written, justified
> against the standalone-bundle constraint: the single self-contained HTML file gets mailed, so
> bundle size matters. ADR-0005 additionally makes tree-shaking a condition of accepting the
> one-package-with-subpath-exports structure. Both were deferred to research; this settles them.
>
> Measurements were taken with esbuild 0.27.4, `--bundle --minify --format=esm --platform=browser`,
> and `gzip -9`, on the same machine on the same day, so the figures are mutually comparable. The
> mailed artifact is opened over `file://`, where no transport compression applies and mail encoding
> adds ~33%; **raw bytes, not gzip, are the governing figure.**
>
> ### Decision
>
> **1. The view is built on Preact.** Measured: React 19 + `react-dom/client` for one trivial
> component is 193,327 raw / 60,146 gzip bytes; Preact 10 + `preact/hooks` for the same component is
> 12,781 raw / 5,331 gzip. `preact/compat` remains available as an escape hatch at a measured
> +5,810 raw / +2,125 gzip over bare Preact. Preact requires no compiler and no bundler plugin,
> which satisfies the brief's "must still build in three years".
>
> **2. The runtime schema is authored in `zod/mini`.** Measured for the same comparanda-shaped
> schema: `import { z } from 'zod'` is 310,946 raw / 61,756 gzip; named classic imports are 68,204 /
> 19,032; `zod/mini` is 15,250 / 5,491. `@zodal/core`'s `defineCollection` works unchanged on
> `zod/mini` schemas (verified by execution), and classic Zod's `toJSONSchema` accepts them
> (verified). **JSON Schema emission is therefore a Node-only build step and classic Zod must never
> appear in a browser entry point.** Enforce with an ESLint `no-restricted-imports` rule.
>
> **3. `comparanda/react` is not published in v1.** The public mounting contract is
> `mountMatrix(el, props) => { update, destroy }`. Framework wrappers are documented, not shipped.
> Revisit when two real consumers ask.
>
> **4. Registries are populated explicitly by the composition root.** No module registers itself at
> module scope. Demonstrated: with `"sideEffects": false` declared, esbuild deletes a
> self-registering module *from the bundle that needs it*, shipping an empty registry with no error.
> Encodings (ADR-0010) are plain named exports; the caller registers what it wants, and a consumer
> who wants two encodings ships two.
>
> **5. The standalone build is Vite + `vite-plugin-singlefile`.** The analysis is inlined as
> `<script type="application/json">`. The build injects a Content-Security-Policy meta tag with
> `default-src 'none'; connect-src 'none'`, which makes ADR-0013's no-network property **enforced by
> the browser** rather than merely tested. The build fails — not just CI — if the zero-network check
> fails. The build prints raw bytes, gzip bytes, and a warning that HTML email attachments are
> commonly blocked by enterprise mail filters regardless of size.
>
> **6. ADR-0005's condition of acceptance is met; do not split the package.** A subpath export is a
> separate module graph, so a `comparanda`-only consumer never reaches `comparanda/view` — verified
> in all tested configurations, including with no `sideEffects` field. CI asserts this continuously
> with an esbuild `--metafile` input-path assertion plus per-fixture byte budgets, `publint` and
> `@arethetypeswrong/cli` on the published tarball, and a no-DOM test environment for `core`.
>
> **7. Reordering takes no drag-and-drop library.** The keyboard path is the reference
> implementation; pointer dragging is a thinner second path over the same
> `moveTo(axis, from, to)` core. `dnd-kit` is rejected as React-only, and the accessibility argument
> for any such library is weaker than it looks — the leading framework-agnostic option's README states
> that "these pieces are unopinionated about visual language or accessibility". Revisit only if
> auto-scroll or cross-container dragging becomes necessary.
>
> ### Consequences
>
> The whole dependency floor — Preact, `zod/mini`, `@zodal/core`, `@zodal/groups-core` — is about
> 51 kB raw / 19 kB gzip, leaving the analysis payload as the largest thing in the mailed file,
> which is the correct proportion for an artifact whose purpose is to carry an analysis. The costs:
> Preact is a smaller ecosystem than React, so a React-only component requires `preact/compat` or a
> replacement; `zod/mini`'s API is more verbose (`z.optional(z.int())` rather than
> `z.int().optional()`); and explicit registration means the composition root has a list that must
> be kept current, which is a visible, greppable cost rather than an invisible one.
>
> ### Alternatives considered
>
> - *React.* 11× the gzipped cost and 15× the raw cost for no capability this project uses; the
>   familiarity argument does not survive an artifact whose defining constraint is that it is mailed.
> - *Svelte or Solid.* Both plausibly smaller than Preact in output. Both couple the source to a
>   compiler and a bundler plugin, which is the bet the brief asks us not to make, and neither has a
>   compatibility layer if we need an existing component.
> - *Lit.* Shadow DOM complicates computed text contrast against a rendered background (ADR-0010),
>   `forced-colors`, print, and a single coherent `role="grid"` tree — four things this project
>   cares about more than most.
> - *Vanilla TS plus a small reactive layer.* Saves at most ~13 kB raw and costs us a hand-written
>   renderer that must preserve DOM identity and keyboard focus across reorder — the fiddliest
>   requirement in the visualisation brief.
> - *esbuild plus a hand-rolled inliner.* Reimplements asset inlining, CSS extraction and data-URI
>   encoding; `vite-plugin-singlefile` and Quarto's `embed-resources` are the settled solutions.

---

## Recommended ADR actions

| ADR | Action | Reason |
|---|---|---|
| ADR-0017 | **new ADR** | Framework (Preact), runtime validator (`zod/mini`), no `comparanda/react` in v1, explicit registries, single-file build, zero-network enforcement. Draft body above. |
| ADR-0005 | **amend** | Its condition of acceptance is verified met — subpath exports isolate core-only consumers. Record the verification method (esbuild `--metafile` input-path assertion + byte budgets + `publint`/`attw` + no-DOM core test env) as the standing CI requirement. |
| ADR-0006 | **amend** | Factually wrong: there is no key-value "zodal store" interface. `@zodal/store` provides `DataProvider<T>` (collection CRUD). Restate the port in those terms; add that `getCapabilities()` is the single source of truth for what the UI offers. |
| ADR-0008 | **amend** | Withdraw the `dnd-kit` recommendation (React-only; contradicts ADR-0017). Make the keyboard path the reference implementation. Adopt `@zodal/groups-core` (`labels` profile) for grouping, noting the two gaps `comparanda` must fill. Name **optimal leaf ordering** as the seriation default, per Bertifier. |
| ADR-0007 | **amend** | Add **locked** as a third view mode alongside personal and shared, per Airtable. Add **per-dimension revert** ("revert just the column order"), per Figma's per-property reset. Add an ordered **sequence of saved views** as a narrative mode, per Miro frames. |
| ADR-0011 | **amend** | Add the anchor rules: anchors are tuples of stable opaque ids only; entities are tombstoned, never hard-deleted, when they carry annotations; `supersededBy` handles splits; `repairHint` is stored but never used for resolution; orphaned annotations get a visible tray. Add bulk accept/reject for suggestion mode. Frame the disagreement encoding as Polis-style group-informed consensus, not spread. |
| ADR-0013 | **amend** | Upgrade zero-network from a CI test to a **CSP-enforced property** baked into the artifact, plus the browser test *and* the static grep. Require the check to run in `comparanda build`, not only in CI. Record the mail-gateway constraint on `.html` attachments as a documented limitation. |
| ADR-0004 | **confirm** (with a note) | Schema-first on zodal is confirmed by reading the source. Add the note that JSON Schema emission is a **build-time, Node-only** concern, since the classic Zod import that provides it costs 61.8 kB gzip. |
| ADR-0010 | **amend** | Encodings are plain named exports registered by the composition root; no self-registration at module scope. This is a correctness requirement under `"sideEffects": false`, demonstrated above, not a style preference. |
| ADR-0015 | **confirm** | The rank-reversal critique of AHP is a live, unresolved objection at the level of the method's axioms; the no-default-aggregation stance is the correct response. Add: if weights are offered, sensitivity analysis must include an add/remove-an-alternative perturbation. |
| ADR-0014 | **confirm** (with a note) | Evidence excerpts should be modelled as zodal **content fields**, so the standalone-embedded / resolver-fetched split falls out of the existing bifurcation machinery. |

---

## Open questions

1. **Svelte and Solid output size for this specific view.** I could not measure them (no install
   permitted, not present on this machine) and found no primary, comparable published figure I would
   act on. Settled by building the same trivial-component fixture in each and measuring with the
   same bundler. My expectation is that both land near Preact and that the compiler-coupling
   argument decides it regardless — but that expectation is not evidence.
2. **The realistic total.** The measured figures are dependency floors. Nobody has measured
   `comparanda`'s own view code because it does not exist. Settled by setting a byte budget at Phase 3
   (suggested: 200 kB raw for the whole bundle excluding the analysis payload) and failing CI on it,
   so the number is discovered under pressure rather than discovered late.
3. **How large is a real analysis payload, inlined?** This determines whether the mailed-file size
   story is dominated by code or by data, and therefore how much the framework choice actually
   matters at the margin. Settled by building the messy ADR-0016 example once Phase 1 exists.
4. **Does `preact/compat` cover `@atlaskit/pragmatic-drag-and-drop`'s optional React packages** if we
   ever need them? Not investigated, because the recommendation is to take neither.
5. **The `zodal-groups` group-pair relation.** I am confident it is not in `@zodal/groups-core` (I
   read the full export surface), but it may be a reasonable upstream contribution rather than a
   `comparanda` local. Worth raising with that package's maintainer.
6. **Brush et al. (CHI 2001) full text.** I cite it for the existence and framing of the problem
   only; I read the abstract and venue record, not the paper. If the design of the orphaned-annotation
   tray becomes contentious, obtain the full text — it is the one empirical study of what users
   actually expect when an annotation loses its target.
7. **Phelps & Wilensky (WWW9 2000) full text.** The mirror I tried returned 404. The principle
   (multiple redundant descriptors, resolve strongest-first) is well attested through the W3C spec's
   multiple-selector rule [8] and Hypothesis's implementation [9], both of which I did read, so the
   recommendation does not rest on the unread paper.

---

## REFERENCES

1. [Pragmatic drag and drop — Atlassian, GitHub README](https://github.com/atlassian/pragmatic-drag-and-drop) — source of "These pieces are unopinionated about visual language or accessibility, and have no dependency on the Atlassian Design System." The "vanillaJS library … can be used with any view library" sentence is on the [core package page, Atlassian Design System](https://atlassian.design/components/pragmatic-drag-and-drop/core-package/).
2. [Manage comments and replies — Google Drive API, Google Workspace (2026)](https://developers.google.com/workspace/drive/api/guides/manage-comments)
3. [Getting started with Airtable views — Airtable Support (2026)](https://support.airtable.com/docs/getting-started-with-airtable-views)
4. [Database views, filters, sorts & groups — Notion Help Center (2026)](https://www.notion.com/help/views-filters-and-sorts); linked-database behaviour from [Using linked databases — Notion Help Center (2026)](https://www.notion.com/help/guides/using-linked-databases)
5. [Create a detail view — Coda Help Center (2026)](https://help.coda.io/hc/en-us/articles/39555867630989-Create-a-detail-view)
6. [Robust intra-document locations — Thomas A. Phelps, Robert Wilensky, WWW9 / *Computer Networks* 33:105–118 (2000), doi:10.1016/S1389-1286(00)00043-8](https://www.semanticscholar.org/paper/bf3a9da17f9dbeb2d2d09f4d562c903e4e9b2f2e) — record verified; full text not obtained.
7. [Robust annotation positioning in digital documents — A. J. Bernheim Brush, David Bargeron, Anoop Gupta, Jonathan J. Cadiz, CHI 2001](https://dl.acm.org/doi/10.1145/365024.365117) — abstract verified against the [Microsoft Research record (MSR-TR-2000-95)](https://www.microsoft.com/en-us/research/publication/robust-annotation-positioning-in-digital-documents/); full text not obtained.
8. [Web Annotation Data Model — Robert Sanderson, Paolo Ciccarese, Benjamin Young, W3C Recommendation (2017)](https://www.w3.org/TR/annotation-model/)
9. [Fuzzy Anchoring — Hypothesis (2013)](https://web.hypothes.is/blog/fuzzy-anchoring/)
10. [Suggest edits in Google Docs — Google Docs Editors Help (2026)](https://support.google.com/docs/answer/6033474)
11. [Proposals — Loomio User Manual (2026)](https://www.loomio.com/docs/en/user_manual/polls/proposals); the agree/abstain/disagree/block response set and the meaning of *block* are on [Consensus — Loomio User Manual (2026)](https://www.loomio.com/docs/en/user_manual/polls/proposals/consensus)
12. [Algorithms — The Computational Democracy Project / Polis (2026)](https://compdemocracy.org/algorithms/)
13. [Apply overrides to instances — Figma Help Center (2026)](https://help.figma.com/hc/en-us/articles/360039150733-Apply-overrides-to-instances)
14. [Presentation mode — Miro Help Center (2026)](https://help.miro.com/hc/en-us/articles/34307373858450-Presentation-mode)
15. [Locking content on the board — Miro Help Center (2026)](https://help.miro.com/hc/en-us/articles/4408887253778-Locking-content-on-the-board)
16. [HTML Basics — Quarto documentation (2026)](https://quarto.org/docs/output-formats/html-basics.html)
17. [Data loaders — Observable Framework documentation (2026)](https://observablehq.com/framework/data-loaders)
18. [What is the PAPRIKA method? — 1000minds; after P. Hansen & F. Ombler, *Journal of Multi-Criteria Decision Analysis* 15:87–107 (2008)](https://www.1000minds.com/paprika)
19. [SuperDecisions — decision-making software for AHP and ANP (2026)](https://www.superdecisions.com/)
20. [Decision Support Software — TransparentChoice (2026)](https://www.transparentchoice.com/software/decision-support)
21. [Criterium DecisionPlus — InfoHarvest, Inc. (product documentation)](http://www.infoharvest.com/ihroot/infoharv/products.asp)
22. [The state of the art development of AHP (1979–2017): a literature review with a social network analysis — A. Emrouznejad & M. Marra, *International Journal of Production Research* 55(22):6653–6675 (2017)](https://doi.org/10.1080/00207543.2017.1334976) — secondary source, used here for the standing of the critique. Primary: [J. S. Dyer, "Remarks on the Analytic Hierarchy Process", *Management Science* 36(3):249–258 (1990)](https://doi.org/10.1287/mnsc.36.3.249). Neither full text was obtained for this section.
23. [Bertifier — Charles Perin, Pierre Dragicevic, Jean-Daniel Fekete, "Revisiting Bertin Matrices: New Interactions for Crafting Tabular Visualizations", *IEEE TVCG* 20(12):2082–2091, VIS (2014)](https://aviz.fr/bertifier); [open-access PDF](https://openaccess.city.ac.uk/id/eprint/16706/1/2014_VIS_bertifier.pdf) — the optimal-leaf-ordering choice ("We thus opted for using “optimal leaf ordering” (OLO)") is in the paper body, not the abstract.
24. [Preact — Fast 3kB alternative to React (2026)](https://preactjs.com/)
25. [Lit — simple, fast web components (2026)](https://lit.dev/)
26. [Anti-malware protection for email in Microsoft 365 — common attachments filter, Microsoft Learn (2026)](https://learn.microsoft.com/en-us/defender-office-365/anti-malware-protection-about)
27. [vite-plugin-singlefile — Richard Tallent (2026)](https://github.com/richardtallent/vite-plugin-singlefile)
28. [Group informed consensus — The Computational Democracy Project / Polis (2026)](https://compdemocracy.org/Group-Informed-Consensus/)

**Verification note.** Every reference above was fetched during a citation-integrity pass. Three
resolve but refused automated fetching (HTTP 403 bot protection) and so were **not** content-verified:
[5] Coda, [14] Miro presentation mode, [15] Miro locking. The claims resting on them are stated as
mechanisms only, and should be re-checked by a human opening those pages before this section is
relied on for a decision.
