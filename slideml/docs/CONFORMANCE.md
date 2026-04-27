# OOXML Conformance Protocol

PowerPoint's strict reader rejects packages that LibreOffice silently
tolerates. Several real bugs landed this way during Stages 2–4 and
Wave A. To make the boundary explicit and prevent regression, slideml
ships **three** layers of validation. Every PR that touches the OOXML
emitter or theme runtime MUST pass all three.

## Layer 1 — Unit tests
`pnpm test` (or `pnpm run check`). Vitest covers token estimation, XML
escape rules, slide-rels invariants, font/sz units, marker round-trips,
parser/validator behavior. **Must pass on every commit.**

## Layer 2 — Strict conformance audit
`pnpm run conformance:audit`. Compiles every fixture, then per-package:

1. **python-pptx round-trip.** Loads the .pptx with python-pptx's strict
   OPC reader, walks every slide's shapes, touches notes if present,
   re-saves to a temp file. Catches schema violations the OPC layer
   rejects.
2. **ZIP hygiene.** Asserts zero directory entries (`_rels/`, `ppt/`,
   etc. with size 0 — OPC forbids them; PowerPoint refuses; LibreOffice
   tolerates). Reports file count.
3. **Content_Types + rels integrity.** Every `<Override PartName=…>`
   resolves to a real file in the zip. Every `<Relationship Target=…>`
   in every `.rels` file resolves to a real file. Slide-rels rId1 is
   always the slide-layout relationship. No duplicate rId in any rels
   file.

**Must pass before merging any change to the emitter or theme runtime.**

## Layer 3 — LibreOffice render-check + content assertions
`pnpm run render:check`. Compiles every fixture, runs `soffice
--headless --convert-to pdf`, splits per slide, runs `pdftotext` and
asserts that hand-curated key strings appear (titles, KPI values,
chart labels, table cells, etc.). Catches the case where a shape
silently fails to render even though the package is structurally valid
(e.g. a `r:id` that points at the wrong rel — the symptom we fixed at
the end of Stage 4).

Run this whenever you add a new layout, change the emitter, or update
a fixture — it's the only check that exercises the *visual* output.

## Convenience target
`pnpm run check:full` runs all three layers in order:
```
lint:boundary → tsc --noEmit → vitest → conformance:audit → render:check
```

## Hard rules — what we know breaks PowerPoint

These were all real bugs we shipped. The conformance audit catches each
one. Going forward, follow these explicitly:

| Rule | Why | Caught by |
|---|---|---|
| No directory entries in the zip | OPC spec; PowerPoint refuses | Layer 2.2 |
| Every `<Override PartName=…>` must resolve to a file | OPC integrity | Layer 2.3 |
| Every `<Relationship Target=…>` must resolve | OPC integrity | Layer 2.3 |
| Slide-rels rId1 = the slide layout | Office expectation | Layer 2.3 |
| No duplicate rId within one rels file | Schema; PowerPoint hard error | Layer 2.3 |
| `<p:sldSz>` MUST carry `type="screen16x9"` etc. matching dimensions | Office default reader | embedded in `package.test.ts` |
| `<p:defaultTextStyle>` MUST contain `<a:lvl1pPr>`–`<a:lvl9pPr>` | Office default reader | embedded in `package.test.ts` |
| `<a:rPr sz="…">` is hundredths of a point (24pt → 2400) | OOXML spec | embedded in `package.test.ts` |
| Inside `<a:rPr>`, fonts go in `<a:latin>` / `<a:ea>` / `<a:cs>` — NOT `<a:rFonts>` | DrawingML schema | embedded in `package.test.ts` |
| `<p:graphicFrame>` MUST contain `<a:graphicFrameLocks noGrp="1"/>` | Office expectation | embedded in `package.test.ts` |
| Shape `r:id` rel numbering must match slide-rels (rId1 = layout, rId2+ = shapes) | OOXML linkage | Layer 1 + Layer 3 |
| `notesMaster1.xml` MUST contain the standard placeholder set (hdr / dt / sldImg / body[1] / ftr / sldNum) | Office expectation | Layer 2.1 (via python-pptx) |
| `notesSlide{N}.xml` MUST contain the matching placeholder set | Office expectation | Layer 2.1 |
| `<p:notesMasterIdLst>` (when present) MUST sit between `<p:sldMasterIdLst>` and `<p:sldIdLst>` | CT_Presentation order | Layer 2.1 |
| `<a:tcPr>` child order: lnL → lnR → lnT → lnB → lnTlToBr → lnBlToTr → cell3D → fill → … | CT_TableCellProperties | Layer 2.1 |
| `<a:tc>` content order: `<a:txBody>` then `<a:tcPr>` | CT_TableCell | Layer 2.1 |

## Adding a new emitter feature — checklist

1. Add the emitter code under `src/emitter/`.
2. Add a unit test in the corresponding `*.test.ts` that asserts the
   structural shape of the produced XML (specific elements, attribute
   values, ordering). Use the "hard rules" table above as a template.
3. Add a fixture in `fixtures/` that exercises the feature.
4. Add the fixture's name + expected text fragments to
   `scripts/render-check.mjs` `CONTENT_EXPECTATIONS`.
5. Run `pnpm run check:full` and verify all three layers pass.
6. If LibreOffice renders OK but PowerPoint doesn't, do NOT just push
   — extend `scripts/conformance-audit.mjs` with whatever check would
   have caught the issue, then fix the emitter.
