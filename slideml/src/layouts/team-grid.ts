import type { LayoutContext, LayoutFn } from "../render/layout-context.js";
import type { ShapeList } from "../emitter/types.js";
import type { SlotSchema } from "../theme/types.js";
import { contentRect, gridCols, imageOrPlaceholder, imageRefOf, slideTitle } from "../render/primitives.js";

/**
 * Team grid — N team-member tiles, each with a circular avatar, name,
 * and role. Pick when a slide introduces multiple people: founders,
 * advisory board, panel speakers, customer success team. 2–8 members.
 *
 * Each item: { name, role?, image?, bio? }. `image` accepts the same
 * `image-ref` shape as everything else (bare path / { src, ... }).
 * The layout renders avatars with `shape: "circle"` automatically.
 */
export const slots: Record<string, SlotSchema> = {
  title:   { type: "text",    maxChars: 35, optional: true },
  members: { type: "bullets", min: 2, max: 8, itemMaxChars: 56 },
};

interface MemberRaw {
  name?: string;
  role?: string;
  image?: unknown;
  bio?: string;
}

const teamGrid: LayoutFn = (ctx: LayoutContext): ShapeList => {
  const out: ShapeList = [];
  const title = ctx.slot<string>("title");
  const members = (ctx.slot<unknown[]>("members") ?? []) as Array<MemberRaw | string>;
  const fontFace = ctx.cjk ? ctx.font("cjk") : ctx.font("latin");

  if (title) out.push(...slideTitle(ctx, title));

  const top = title ? ctx.cm(4.4) : ctx.cm(2);
  const body = contentRect(ctx, { top });
  // 2–4 members → single row; 5–8 → two rows.
  const cols = members.length <= 4 ? members.length : Math.ceil(members.length / 2);
  const rows = members.length <= 4 ? 1 : 2;
  const gridGap = ctx.cm(0.6);
  const cellW = Math.floor((body.width - gridGap * (cols - 1)) / cols);
  const cellH = Math.floor((body.height - gridGap * (rows - 1)) / rows);

  members.forEach((raw, idx) => {
    const m: MemberRaw = typeof raw === "string" ? { name: raw } : raw;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const cellX = body.x + c * (cellW + gridGap);
    const cellY = body.y + r * (cellH + gridGap);
    const avatarSize = Math.min(ctx.cm(4), Math.floor(cellH * 0.45));
    const avatarRect = {
      x: cellX + Math.floor((cellW - avatarSize) / 2),
      y: cellY,
      width: avatarSize,
      height: avatarSize,
    };
    const ref = imageRefOf(m.image);
    if (ref) ref.shape = "circle";
    out.push(...imageOrPlaceholder(ctx, avatarRect, ref, { placeholderText: "[photo]" }));
    // Name
    out.push({
      type: "text",
      id: ctx.id(),
      xfrm: { x: cellX, y: cellY + avatarSize + ctx.cm(0.3), cx: cellW, cy: ctx.cm(0.9) },
      valign: "top",
      autoFit: "shrink",
      paragraphs: [{
        align: "center",
        runs: [{
          text: m.name ?? "",
          sizeHalfPt: 26,
          color: ctx.color("text-strong"),
          bold: true,
          cjk: ctx.cjk,
          fontFace,
        }],
      }],
    });
    // Role
    if (m.role) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: cellX, y: cellY + avatarSize + ctx.cm(1.2), cx: cellW, cy: ctx.cm(0.7) },
        valign: "top",
        autoFit: "shrink",
        paragraphs: [{
          align: "center",
          runs: [{ text: m.role, sizeHalfPt: 20, color: ctx.color("brand-primary"), cjk: ctx.cjk, fontFace }],
        }],
      });
    }
    // Bio (1-2 lines max)
    if (m.bio) {
      out.push({
        type: "text",
        id: ctx.id(),
        xfrm: { x: cellX + ctx.cm(0.2), y: cellY + avatarSize + ctx.cm(2.0), cx: cellW - ctx.cm(0.4), cy: ctx.cm(2) },
        valign: "top",
        autoFit: "shrink",
        paragraphs: [{
          align: "center",
          lineSpacingHalfPt: 36,
          runs: [{ text: m.bio, sizeHalfPt: 18, color: ctx.color("text-muted"), cjk: ctx.cjk, fontFace }],
        }],
      });
    }
  });

  // Suppress unused import in some envs.
  void gridCols;
  return out;
};

export default teamGrid;
