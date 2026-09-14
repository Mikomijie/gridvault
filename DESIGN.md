# GridVault Design Specification

**Document version:** 1.0
**Status:** Approved direction. Implement in Phase 8 of [AGENTS.md](AGENTS.md).
**Scope:** the visual and material language for all five surfaces in [PRD.md](PRD.md) §3.

**Design read:** *Redesign (overhaul) of a clinical safety system for Nigerian hospital wards, for two audiences at once - clinicians under time pressure and auditors looking for proof - with an institutional, evidentiary language, leaning toward paper-and-instrument materiality rather than any SaaS component kit.*

**Dials.** These are not one setting. GridVault is two products wearing one skin today, which is the root cause of why it looks templated.

| Surface | Variance | Motion | Density | Reference class |
| :--- | :-- | :-- | :-- | :--- |
| Public site (`/`) | 4 | 2 | 4 | Trust-first institutional |
| Ward terminal (`/dashboard`) | 2 | 1 | 7 | Clinical dense UI (NHS Design System, IBM Carbon) |
| Security console (`/dashboard/security`) | 2 | 2 | 8 | Forensic instrument panel |
| Print (handover, triage slip) | 1 | 0 | 6 | Clinical paper form |

Landing-page design rules apply only to the public site. The ward terminal and the security console are dense product UI and follow clinical-density conventions instead: they are not marketing pages and must not be decorated like one.

---

## 1. The audit: what is wrong with the current design

This is not a matter of taste. Each item below is a counted instance in the existing three pages.

### 1.1 The palette is a generated theme, not a brand

`#FAF8FF` background, `#EAEDFF` container, `#D3E4FF` selected, `#81F3E5` mint status, `#005EA4` primary. That is unmodified Material Theme Builder output, including the violet cast in the neutrals and the `on-surface-variant` naming in `tailwind.config.js`. Generated palettes read as generated. The mint at 25 percent opacity used as a status fill is the single most recognisable tell on the page.

### 1.2 The type is too small to be safe, and has no scale

257 arbitrary size values across three files. The two most common are `text-[12px]` (50 uses) and `text-[11px]` (45 uses). Those are the dominant sizes for patient status, vitals labels, ward names and action buttons.

This is a clinical safety problem before it is an aesthetic one. The terminal runs on a shared ward tablet, often a cheap panel with poor viewing angles, under fluorescent glare or a window, read at arm's length by someone wearing gloves who is holding something else in the other hand. 11px fails all of that. It also fails the PRD's own accessibility target.

### 1.3 Glassmorphism on the hero

`bg-white/95 backdrop-blur-md rounded-xl shadow-lg` on two cards absolutely positioned over the hero photograph, plus a `bg-gradient-to-t from-[#283044]/40` scrim beneath them. Floating frosted cards over a stock photo is the most reproduced AI hero composition in existence.

### 1.4 Pills, everywhere

21 instances of `rounded-full`: the hero eyebrow, patient status, filter chips, the avatar circle, four decorative status dots, and a progress bar with a filled background track. Pills are the default shape of a component kit. They carry no meaning here.

### 1.5 Decorative pulsing dots

Four `animate-pulse` green dots labelled "live", "online" and "system operational". In a clinical interface, a pulsing element is an alarm vocabulary. Spending it on decoration means a real alarm has nothing left to say.

### 1.6 Three identical feature cards

`grid md:grid-cols-3` with three `bg-white p-8 rounded-lg border shadow-sm hover:shadow-md` blocks. Followed by a centred call to action on a solid brand-blue field. Both are stock layout families.

### 1.7 Mixed shape system

`rounded-lg` (38), `rounded-full` (21), `rounded-xl` (15), `rounded-md` (2), `rounded-2xl` (1) across the same three pages, with no rule governing which is used where. Four radii in one product reads as four designers who never met.

### 1.8 Roughly 120 hand-rolled inline SVG icon paths

Each page opens with a 60-line `Icons` object of copied Material Symbols path data. They are inconsistent in size (14, 15, 16, 18, 20, 22, 30) and weight, they bloat every file, and most of them are decorative: an icon sitting next to a heading that the heading already explains.

### 1.9 Elevation used as decoration

`shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl` and `hover:shadow-md` lifts on cards that are not above anything. Every surface floats, so nothing reads as foreground.

### 1.10 What is already right, and stays

The two-column hero structure. The left-aligned headline. The 1280px container. The focus-visible ring in `globals.css`. The absence of emoji. The ward, shift and role vocabulary in the login form, which is genuinely specific to the problem and should be made more prominent, not less.

---

## 2. Feeling

The product's central claim is not "we protect data". It is **"the record of who looked at this file cannot be quietly changed."** Everything on screen should support that one sentence.

The feeling to build is **evidentiary calm**: the composure of an instrument that is recording whether or not anyone is watching it.

**Reference objects** (what this should feel like):

- A laboratory notebook with numbered, signed, countersigned pages.
- An aircraft flight-data readout: monospaced, dense, unglamorous, impossible to argue with.
- A hospital drug chart on a clipboard at the foot of a bed: high contrast, large, designed to be read badly and still read correctly.
- A court exhibit stamp. Rectangular, inked, dated, unremovable.

**Anti-references** (what this must not feel like):

- A health-tech startup landing page.
- A fintech dashboard with gradient cards and a sparkline that means nothing.
- Any interface where a floating translucent panel implies sophistication.

**The emotional sequence a user should move through:**

| Moment | Intended feeling | Achieved by |
| :--- | :--- | :--- |
| Landing page, first five seconds | "These people have actually been in a ward." | Specific ward language, real product imagery, no stock optimism |
| Login | "This machine knows who I am and what I am on duty for." | Ward, shift and duty state stated plainly before the password field |
| Roster | "I can find my patient in one glance." | Bed number as the largest element on the row |
| A locked field | "I understand exactly why, and it is not personal." | The reason sentence, in full, in body-size text, not a tooltip |
| Break-glass | "This will be seen. I am prepared to be seen." | Consequence stated first, at body size, before any control |
| Emergency active | Mild, continuous discomfort | A red bar that does not go away and cannot be dismissed |
| Tamper detected | Cold certainty | One line, one index number, one broken row, no exclamation |
| Offline | "Keep working." | Amber, identical geometry to the red bar, a count, no error language |

Note the emergency state. Most products would soften it. This one should not: an override that feels comfortable is an override that becomes routine, and a routine break-glass is a failed control. The discomfort is the feature.

---

## 3. Material

Three materials, each with one job. No fourth material may be introduced.

### 3.1 Paper, for clinical surfaces

**Where:** login, ward terminal, patient dossier, admissions, handover, print.

**Why:** GridVault replaces a paper case file. Paper is also the correct optical answer to a glaring ward: matte, high-contrast, no specular highlight, legible at a bad angle, and it prints identically to what is on screen.

**Behaviour:** flat, unlit, opaque. Depth comes from two devices only, a one-step background change and a 1px hairline rule. Nothing casts a shadow. Nothing is translucent. Nothing floats.

### 3.2 Steel, for forensic surfaces

**Where:** security console, ledger inspector, abuse feed, witness status.

**Why:** the audit ledger is machinery, not paperwork. Dense monospaced hash columns are easier to scan as light-on-dark, and the console is used at a desk rather than at a bedside, where dark is appropriate.

**Behaviour:** graphite planes, hairline grid, monospace throughout, no fills except the three semantic signals.

**The rule that keeps this honest:** the material changes only at a full route boundary, never between sections of one page. A user never scrolls from paper into steel. They navigate into the console and the whole surface changes, which reads as walking into a different room rather than as a broken page.

### 3.3 Ink, the marking system

**Where:** across both materials.

Stamps, rules and hairlines. A status is not a coloured bubble; it is a mark applied to a record. Practically this means a 3px coloured edge on the leading side of a row or panel, plus a text label, plus the value itself. Never colour alone, never a fill for its own sake.

### 3.4 Materials that are banned outright

| Banned | Reason |
| :--- | :--- |
| `backdrop-filter` / any blur | Glassmorphism. Also: blur is not redaction. The lock overlay must be opaque and the protected value must not be in the DOM at all. |
| `box-shadow` of any kind | Elevation is not hierarchy here. Nothing in a clinical record is above anything else. One exception is defined in §5.5. |
| Gradients, mesh, aurora, scrims over photographs | Decoration with no informational job. |
| `rounded-full` on anything other than a true circle of a real avatar photograph | Pills are component-kit filler. |
| Translucent fills (`bg-*/10`, `/20`, `/25`) | Produces unpredictable contrast over a changing background. Clinical contrast must be computable. |
| Decorative status dots | Reserved vocabulary, see §1.5. |
| Skeleton shimmer | Use a static skeleton block in the final layout's shape. Shimmer competes with real motion. |
| Emoji | Never, on any surface, including empty states and toasts. |
| Icon-set glyphs used decoratively | An icon must be an affordance or a status. Not an ornament beside a heading. |

---

## 4. Tokens

Implement as CSS custom properties in `frontend/src/styles/tokens.css`, consumed by `tailwind.config.js`. Delete the current Material palette entirely.

### 4.1 Colour

```css
:root {
  /* Paper (clinical) */
  --paper:          #F4F4F1;   /* page field, neutral, zero violet cast */
  --paper-raised:   #FFFFFF;   /* the record itself */
  --paper-sunk:     #E9E9E4;   /* input wells, table headers */
  --ink:            #14171A;   /* primary text, off-black not pure black */
  --ink-2:          #494F55;   /* secondary text, reason sentences */
  --ink-3:          #6C737A;   /* metadata, timestamps */
  --rule:           #D4D5CF;   /* hairline */
  --rule-strong:    #ADAFA7;   /* section boundary, table head */

  /* Steel (forensic) */
  --steel:          #15181B;
  --steel-raised:   #1C2024;
  --steel-sunk:     #101214;
  --ink-inv:        #E8E9E5;
  --ink-inv-2:      #9AA0A6;
  --rule-inv:       #2E3338;

  /* Signals. Same meaning on both materials. */
  --signal:         #12507A;   /* interactive, links, primary action */
  --signal-inv:     #7CB8E3;
  --alarm:          #A31D18;   /* break-glass, tamper, critical patient */
  --alarm-inv:      #F0827A;
  --caution:        #7A5200;   /* observation, offline, degraded, stale */
  --caution-inv:    #E3AC4E;
  --verified:       #1C5638;   /* chain healthy, sync complete, granted */
  --verified-inv:   #6ABA8D;
}
```

**Rules of colour.**

1. **One accent.** `--signal` is the only interactive colour. Every link, every primary button, every focus ring, on both materials.
2. **Red is rationed.** `--alarm` as a *fill* appears in exactly three situations: the emergency override control, the emergency banner, and a tamper-detected ledger row. Nowhere else, ever. A form error uses `--alarm` as *text and rule*, never as a fill. If red is spent on a delete button it will not mean anything on the day it matters.
3. **Status is never colour alone.** Every semantic colour is accompanied by a text label and a shape (a 3px leading edge). This survives colour-blindness, monochrome printing, a failing panel and a photograph of the screen taken as evidence.
4. **Contrast floors.** Clinical text (patient data, vitals, status, protected-field reasons) targets **7:1**, which is WCAG AAA, because of ward glare and low-grade panels. Non-clinical text targets 4.5:1. Verified in AT-903.
5. No colour in the token set may be introduced at the component level. If a component needs a colour that is not here, the design is wrong, not the palette.

### 4.2 Typography

**Families** (both SIL Open Font License, self-hosted, no CDN link):

- **IBM Plex Sans** - interface and prose. Institutional rather than friendly, excellent at small sizes, and it carries the connotation of a systems design language rather than a consumer app.
- **IBM Plex Mono** - every number that is data: vitals, hashes, hospital numbers, staff IDs, bed numbers, log indices, timestamps, countdowns.
- **IBM Plex Sans Condensed** - dense ward table column headers only.

Plus Jakarta Sans is retired. It is a friendly geometric sans, which is the wrong register for a system whose job is to be believed.

**Scale.** Fixed, named, no arbitrary values. The 11px and 12px tier is deleted from clinical surfaces.

| Token | Size / line | Family | Use |
| :--- | :--- | :--- | :--- |
| `data-xl` | 34 / 34 | Mono 500 | Vitals values, bed number, ledger head hash |
| `h1` | 40 / 44 | Sans 600 | Page title. Landing hero 48 / 50 |
| `h2` | 28 / 34 | Sans 600 | Section |
| `h3` | 20 / 26 | Sans 600 | Panel, card, tab |
| `body` | 16 / 24 | Sans 400 | Default. Reason sentences. Consequence copy |
| `body-strong` | 16 / 24 | Sans 500 | Patient name, emphasis |
| `dense` | 15 / 22 | Sans 400 | Table cells. **Absolute minimum on any clinical surface** |
| `data` | 15 / 22 | Mono 400 | Inline data: IDs, hashes, times |
| `meta` | 13 / 18 | Mono 400 | Non-clinical metadata only. Never patient data |
| `stamp` | 12 / 12 | Mono 500, `tracking-[0.08em]`, uppercase | Status stamps, column heads |

**Rules of type.**

1. `font-variant-numeric: tabular-nums` globally. Columns of vitals that do not align are a defect.
2. Body measure caps at 68 characters.
3. Emphasis uses weight and colour. Never a second family inside a line, never italic in the interface.
4. No uppercase running text. Uppercase is reserved for `stamp`.
5. Numbers a clinician acts on are always monospace. This is what makes a change of one digit visible.

### 4.3 Shape, rule and space

```
Radius:   2px. One value. Buttons, inputs, panels, modals, stamps.
          Tables and full-bleed bars: 0.
          Nothing else exists. No rounded-full, no rounded-xl.

Border:   1px solid var(--rule)            hairline, the default separator
          3px solid var(--<signal>)        a leading edge that marks status
          2px solid var(--signal)          focus ring, offset 2px

Elevation: none. Layering is background step plus hairline.

Space:    4px base. 4 8 12 16 24 32 48 64 96.
          Ward table row: 56px. Touch target minimum: 44px.
          Landing section rhythm: 96 desktop / 56 mobile.
          Terminal panel padding: 24 desktop / 16 tablet.
```

### 4.4 Motion

`MOTION_INTENSITY` is 1 on the terminal and 2 elsewhere. Every animation must name its job in one sentence, and there are only five jobs:

| Animation | Duration | Job |
| :--- | :-- | :--- |
| Emergency banner enters | 120ms, ease-out, translateY 8px + opacity | A state that must be noticed has begun |
| Offline bar changes state | 120ms, opacity only | Connectivity changed |
| Verification result appears | 120ms, opacity only | A long operation finished |
| Toast enters and leaves | 120ms / 160ms | Transient acknowledgement |
| Sync progress | determinate width, no easing | Real progress against a real count |

Everything else is instant. No hover lift, no scroll reveal, no parallax, no pulse, no spinner except an indeterminate 1px bar on an operation that genuinely has no known length. All five collapse to instant under `prefers-reduced-motion: reduce`.

### 4.5 Icons

`@phosphor-icons/react`, weight `regular`, one family, two sizes: 20px for controls, 16px inline. The roughly 120 hand-rolled Material SVG paths are deleted.

**Budget:** an icon appears only when it is an affordance (a control the user acts on) or a status (lock, offline, verified, alarm). Zero icons beside headings. Zero icons inside body copy. If a page has more than 12 icons visible at once, cut.

---

## 5. Composition

### 5.1 Public site

Six layout families, each used once. Nothing repeats.

**Navigation.** 64px, single line, hairline bottom. Wordmark set in Plex Sans 600 at 18px, three links, one `--signal` action. No pill, no dot, no avatar circle, no top announcement strip.

**Hero.** Asymmetric 7 / 5 split, left aligned, `pt-24` maximum.

- Headline, two lines maximum, 48 / 50: state the claim, not a category.
- Subtext, 20 words maximum, `body`, measure capped.
- One primary action and one plain text link. Not two buttons.
- No eyebrow. No trust strip. No tagline under the buttons. Four text elements total.
- **The visual is the product.** A tight, full-bleed crop of the ledger inspector on `--steel`, at the moment verification returns TAMPERED, with the broken row carrying its alarm edge. Real monospace, real hashes, real index. Not a photograph, not an illustration, and under no circumstances a product screenshot built out of styled `div` elements.

The existing stock hospital photograph and its two frosted overlay cards are removed. The screenshot is more persuasive than the photograph because it is the only thing on the page a competitor cannot also claim.

**Section 2, the comparison.** The single most convincing thing GridVault does, so it comes first and gets the most room. Two columns divided by one vertical hairline: *what the attending nurse sees* beside *what the records clerk sees*, for the same patient, rendered in the real interface components. No cards, no headings inside the columns, one caption below each. The reader should understand field-level redaction without reading a word of explanation.

**Section 3, the chain.** Full-bleed `--steel`. A real ledger extract, monospace, one row marked. Three lines of copy set left at `body` above it. This is where hash chaining and the external witness get explained, in plain sentences, without a diagram.

**Section 4, the downtime answer.** Plain prose, 68ch, lifted verbatim from PRD §10.1, beside a rendering of the printed triage slip. Prose is correct here: this section answers a question the brief asked in words, and dressing it as features would weaken it.

**Section 5, deployment.** Two columns: a short grouped specification list on the left, the install command in `--steel` monospace on the right. Grouped into three clusters with one rule per cluster, never ten rows with ten hairlines.

**Footer.** Hairline top, three columns, `meta`. No invented partner logos, no fabricated adoption numbers, no certification marks. Every claim on this page must appear in `docs/COMPLIANCE.md`, per PRD §14.1.

Removed from the current page: the four-up statistics strip, the three equal feature cards, the centred call-to-action band on solid blue.

### 5.2 Ward terminal

**The roster is a table, not a grid of cards.** A ward round is a list traversal. Cards force scanning in two dimensions for data that is naturally one-dimensional, and they waste the vertical space that lets a nurse see the whole ward at once.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ WARD A EAST          MORNING 06:00-14:00   ON DUTY      Online, ward node  │  56px bar
├──────┬─────────────────────┬──────────────┬───────────┬────────┬──────────┤
│ BED  │ PATIENT             │ STATUS       │ LAST OBS  │  AGE   │          │  stamp
├──────┼─────────────────────┼──────────────┼───────────┼────────┼──────────┤
│ A-04 │ Chinedu Nnamdi      │ Stable       │ 09:12     │  0h47  │  Open →  │  56px
│      │ 42 M                │              │           │        │          │
├──────┼─────────────────────┼──────────────┼───────────┼────────┼──────────┤
▌ A-05 │ Amara Okafor        │ Observation  │ 08:55     │  1h04  │  Open →  │  3px caution edge
│      │ 31 F                │ BP 158/95    │           │        │          │
└──────┴─────────────────────┴──────────────┴───────────┴────────┴──────────┘
```

- **Bed number is the largest element on the row**, set in `data` monospace. That is how a nurse navigates a physical ward, and no current design reflects it.
- **Status is a word plus a 3px leading edge.** Not a pill. When the status is `observation` or `critical`, the triggering value is printed beside it, because "observation" alone tells a nurse nothing actionable.
- **Age of last observation** is a column. It turns `--caution` past four hours and `--alarm` past eight. This is a real clinical affordance that the current design does not have at all, and it is the kind of detail that separates a product from a mockup.
- Off-ward patients, when a clinician has widened the roster, appear with the masked name, no clinical columns, and a single `Emergency access` action. They are visibly a different class of row through a `--paper-sunk` field, not through a badge.

**Patient dossier.** Two columns. Left is fixed identity plus the vitals strip: four numbers in `data-xl` monospace, each labelled in `stamp`, separated by hairlines, no cards, no gauges, no sparklines. Right is tabbed: Overview, Vitals, MAR, Notes, Protected.

**Protected fields.** A restricted value renders as a rule-bounded block on `--paper-sunk`:

```
┌─────────────────────────────────────────────────────┐
│ [lock 16]  HIV STATUS                               │  stamp
│                                                     │
│ Restricted to attending clinicians.                 │  body, --ink-2
│ You are signed in as a records clerk.               │
└─────────────────────────────────────────────────────┘
```

The reason is a complete sentence at body size, not a tooltip and not truncated. A person who is told plainly why they cannot see something does not go looking for a shared login. This block is also the enforcement boundary: the value is not in the DOM, so there is nothing to blur and nothing to inspect.

**Break-glass modal.** Opaque scrim `rgba(20,23,26,0.72)`, no blur. A single 480px panel, `--paper-raised`, 3px `--alarm` top edge. Order on the panel is deliberate:

1. The consequence, at `body`, in full: *"This opens the complete record for Babatunde Adeleke. An alert goes to the Chief Medical Officer and the charge nurse immediately, and this access is written permanently into the audit ledger. It cannot be removed."*
2. Patient identity, ward, bed.
3. Clinical reason, a select.
4. Notes, optional except for Other.
5. PIN.
6. One `--alarm` filled button, one plain text cancel.

No icon, no warning triangle, no animation. The sentence carries it. A warning triangle is what an interface uses when it does not trust its own words.

**Emergency banner and offline bar are the same component in two states.** 44px, full width, fixed below the top bar, never dismissible.

```
▌ EMERGENCY ACCESS ACTIVE   Babatunde Adeleke, ICU-02   Audit #1284   58:41 remaining   End access
▌ OFFLINE   Local cache active   3 items queued   Last sync 14:02   Sync now
```

Alarm fill for the first, caution fill for the second, identical geometry, identical typography, identical position. One grammar for "the system is in a state you must know about". Consistency between these two bars is what makes the interface feel designed rather than assembled.

**Lock overlay.** Opaque `--paper`, not a blur. Staff name, ward, a PIN field, nothing else. All patient data removed from the DOM, verified by AT-115.

### 5.3 Security console

Dark by default. Full-bleed, no container, no cards, monospace throughout.

```
CHAIN STATUS                                                          Verify chain
▌ TAMPERED   Hash mismatch at index 7   Head 9f2c1a8e   Witness diverged   41ms

  INDEX  TIME          STAFF     ACTION            PATIENT              PREV      CURR
   0006  13:58:02+01   SN-7742   VIEW_RECORD       HOSP-LOS-2025-082    3a91c40e  7d22b8f1
▌  0007  14:02:11+01   RC-1029   ACCESS_DENIED     HOSP-LOS-2025-082    7d22b8f1  0000????
   0008  14:02:11+01   SYSTEM    ABUSE_ALERT_RAI…  HOSP-LOS-2025-082    b41e77aa  cc09d3f5
```

- The verification result is a 3px top rule and one line of text. Not a card, not a toast, not a modal. `--verified` for healthy, `--alarm` for tampered, `--caution` for a pending anchor.
- The broken row carries a full-row alarm edge and its failing hash is rendered in `--alarm`. The table itself shows the failure. This is the single screenshot the product is sold on, so it gets the strongest composition in the system.
- Hashes truncate to eight leading characters, expand on focus, copy on click. Never ellipsis in the middle of a hash: leading characters are what a human compares.
- The abuse feed uses the same row grammar, severity as a leading edge plus a `stamp` label.
- Charts only where real data exists. Break-glass rate per clinician over 30 days is the one legitimate chart: a single sparkline, no fill, no gridlines, no legend, no axis decoration.

### 5.4 Print

Print is a real output, not an afterthought. The downtime protocol depends on it.

- A4, black on white, Plex Sans 10pt, Plex Mono for all data, 0.5pt rules.
- `@media print` removes navigation, banners, buttons, and every interactive affordance.
- Diagonal watermark at 45 degrees, 8 percent ink: `PRINTED BY DR. O. ADEYEMI (GV-9042) · TERM-ICU-01 · 2026-09-13 14:22 WAT · CONFIDENTIAL`.
- The emergency triage slip is designed as a three-part carbon form: pre-printed field boxes, a hospital-number block, a signature rule. It should look like a form a ward already uses, because that is the only way it gets used correctly at 3am during a power cut.

### 5.5 The one permitted exception to "no elevation"

The modal scrim. It is a flat opaque field, not a shadow and not a blur, and it exists because a break-glass decision must interrupt everything. No other element in the product may sit above another.

---

## 6. States

Every component ships four states. A component with only its success state is not finished.

| State | Treatment |
| :--- | :--- |
| Loading | Static skeleton blocks in the final layout's exact shape, `--paper-sunk`, no shimmer, no spinner |
| Empty | One sentence at `body` saying what will appear here and what produces it. No illustration, no icon |
| Error | Inline, at the point of failure, `--alarm` text on a `--alarm` 3px leading rule, never a fill. States what failed and the next action |
| Denied | Distinct from error. States which of the three dimensions denied, in a full sentence, plus the break-glass affordance when one is available |

Denied is its own state, and treating it as an error would be a design mistake. A denial is the system working correctly.

---

## 7. Implementation

### 7.1 Order of work, inside Phase 8 of AGENTS.md

1. `tokens.css` and a rewritten `tailwind.config.js`. Delete every Material colour.
2. Self-host IBM Plex Sans, Plex Sans Condensed, Plex Mono with `font-display: swap`. Delete Plus Jakarta Sans.
3. Install `@phosphor-icons/react`. Delete the three `Icons` objects and roughly 120 inline paths.
4. Codemod the arbitrary type values: `text-[11px]` and `text-[12px]` on clinical surfaces become `dense` or `meta` per §4.2. Nothing below 15px survives on a clinical surface.
5. Global shape pass: every radius becomes 2px, tables 0. All `rounded-full` removed.
6. Global material pass: every `shadow-*`, `backdrop-blur`, `bg-gradient-*` and translucent fill removed.
7. Rebuild the status system as edge plus label plus value.
8. Rebuild the roster as a table.
9. Build the banner component once and use it for both emergency and offline.
10. Landing page recomposition, last, once the real components exist to screenshot.

### 7.2 Component inventory

| Component | Replaces |
| :--- | :--- |
| `Stamp` | every `rounded-full` badge and pill |
| `StatusEdge` | coloured pill fills and status dots |
| `DataValue` | ad-hoc vitals and hash rendering |
| `HairlineTable` | the patient card grid |
| `RestrictedBlock` | blurred or masked fields |
| `StateBar` | emergency banner and offline bar, two states of one component |
| `Scrim` + `Panel` | all modals |
| `VerifyResult` | verification toast |
| `SkeletonBlock` | spinners |

### 7.3 Pre-flight, to run before Phase 8 is called done

Mechanical checks:

```bash
grep -rn "rounded-full\|backdrop-blur\|bg-gradient\|shadow-\|animate-pulse" frontend/src   # expect 0
grep -rn "text-\[1[0-4]px\]" frontend/src                                                  # expect 0
grep -roh "rounded-[a-z0-9]*" frontend/src | sort -u                                       # expect only rounded-[2px]
grep -rn "<svg" frontend/src/components frontend/src/pages                                 # expect 0
grep -rn "—\|–" frontend/src frontend/src/i18n                                             # expect 0
```

Judgement checks:

- [ ] One accent colour across every surface. `--alarm` as a fill appears in exactly three places.
- [ ] Every status carries colour, a text label, and a shape. Remove all colour from a screenshot and it still reads.
- [ ] Clinical text passes 7:1. Non-clinical passes 4.5:1. Verified by axe in AT-903.
- [ ] Bed number is the largest element on a roster row.
- [ ] Every restricted field states its reason as a full sentence at body size, and the value is absent from the DOM.
- [ ] The break-glass modal states the consequence before the first control.
- [ ] Emergency and offline bars are geometrically identical.
- [ ] No animation exists that cannot be justified in one sentence from §4.4.
- [ ] Every surface has been viewed at 768px portrait, and the critical path works one-handed.
- [ ] Every surface has been viewed in both light and dark. The console defaults to dark; every other surface defaults to light.
- [ ] No page mixes paper and steel. The material changes only at a route boundary.
- [ ] No em-dash on any surface, including copy, alt text and print.
- [ ] Every landing-page claim appears in `docs/COMPLIANCE.md`.
- [ ] Zero emoji.

---

## 8. What this buys

The current design is competent and generic, which for this product is worse than it sounds. GridVault's entire proposition is that its records can be believed. An interface assembled from the default shapes of a component library undercuts that proposition on sight, because it looks like every other thing assembled the same way.

The direction above trades decoration for evidence: fewer colours, one shape, larger type, real data as the visual, and a deliberate refusal to make the emergency override feel comfortable. It should read less like a product someone is selling and more like an instrument someone installed.
