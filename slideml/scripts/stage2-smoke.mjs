#!/usr/bin/env node
/**
 * Stage 2 exit-criterion smoke test.
 *
 * Produces /tmp/slideml-stage2-smoke.pptx so a human can open it in
 * PowerPoint / Keynote / LibreOffice and confirm the file is valid.
 *
 * Run after `pnpm build`:
 *   node scripts/stage2-smoke.mjs
 *   open /tmp/slideml-stage2-smoke.pptx
 */
import { writeFileSync } from "node:fs";
import { emitPackage } from "../dist/emitter/package.js";
import { cm, inch } from "../dist/units.js";

// 1×1 transparent PNG (base64-encoded).
const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

const deck = {
  size: "16x9",
  language: "zh-CN",
  title: "SlideML Stage 2 Smoke Test",
  author: "SlideML",
  slides: [
    {
      background: { type: "solid", color: "0B1B2A" },
      shapes: [
        {
          type: "text",
          id: 2,
          xfrm: { x: cm(2), y: cm(2), cx: cm(20), cy: cm(2.5) },
          valign: "middle",
          paragraphs: [
            {
              align: "center",
              runs: [
                { text: "SlideML ", bold: true, sizeHalfPt: 56, color: "F5F9FC" },
                { text: "Stage 2", bold: true, sizeHalfPt: 56, color: "3CC2FF" },
              ],
            },
          ],
        },
        {
          type: "text",
          id: 3,
          xfrm: { x: cm(2), y: cm(5), cx: cm(20), cy: cm(2) },
          valign: "middle",
          paragraphs: [
            {
              align: "center",
              runs: [
                { text: "OOXML emitter — 中文也可以", sizeHalfPt: 32, color: "8DA8C2", cjk: true, fontFace: "PingFang SC" },
              ],
            },
          ],
        },
        {
          type: "shape",
          id: 4,
          preset: "roundRect",
          xfrm: { x: cm(3), y: cm(9), cx: cm(8), cy: cm(4) },
          fill: { type: "solid", color: "11293E" },
          line: { color: "1F3F5C", width: 12700 },
          cornerRadius: 0.1,
        },
        {
          type: "shape",
          id: 5,
          preset: "rect",
          xfrm: { x: cm(13), y: cm(9), cx: cm(8), cy: cm(4) },
          fill: { type: "solid", color: "1078B5" },
        },
        {
          type: "image",
          id: 6,
          xfrm: { x: cm(11), y: cm(11), cx: inch(0.5), cy: inch(0.5) },
          src: dataUrl,
          altText: "smoke test pixel",
        },
      ],
    },
  ],
};

const buffer = await emitPackage(deck);
const outPath = "/tmp/slideml-stage2-smoke.pptx";
writeFileSync(outPath, buffer);
console.log(`wrote ${buffer.length} bytes to ${outPath}`);
console.log(`open with:  open "${outPath}"`);
