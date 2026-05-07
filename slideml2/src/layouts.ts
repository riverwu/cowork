import type { DomNode, RenderedDeck, RenderedSlide, Slideml2Deck, SlideSpec } from "./types.js";

export function buildDom(source: Slideml2Deck): RenderedDeck {
  return {
    deck: {
      size: source.deck.size || "16x9",
      theme: source.deck.theme || "simple",
      brand: source.deck.brand || {},
    },
    slides: source.slides.map((slide) => ({
      id: slide.id,
      layout: slide.layout,
      dom: renderLayout(slide, source.deck.brand || {}),
    })),
  };
}

function renderLayout(slide: SlideSpec, brand: Slideml2Deck["deck"]["brand"]): DomNode {
  if (slide.layout === "cover") return cover(slide, brand || {});
  if (slide.layout === "title-and-content") return titleAndContent(slide, brand || {});
  if (slide.layout === "image-and-text") return imageAndText(slide, brand || {});
  throw new Error(`Unknown layout: ${slide.layout}`);
}

function baseSlide(slide: SlideSpec, children: DomNode[], overrides: Record<string, unknown> = {}): DomNode {
  return {
    id: `${slide.id}.root`,
    type: "slide",
    background: "background",
    ...overrides,
    children,
  };
}

function cover(slide: SlideSpec, brand: NonNullable<Slideml2Deck["deck"]["brand"]>): DomNode {
  const title = stringProp(slide, "title", "Untitled");
  const subtitle = stringProp(slide, "subtitle", "");
  const children: DomNode[] = [
    {
      id: `${slide.id}.hero`,
      type: "stack",
      area: "content",
      direction: "vertical",
      gap: 0.4,
      align: "center",
      children: [
        {
          id: `${slide.id}.title`,
          type: "text",
          text: title,
          style: "hero",
          align: "center",
          color: "text.inverse",
        },
        {
          id: `${slide.id}.subtitle`,
          type: "text",
          text: subtitle,
          style: "body",
          align: "center",
          color: "text.inverse",
        },
      ],
    },
  ];
  if (brand.logo) children.push(brandLogo(slide.id, brand.logo));
  return baseSlide(slide, children);
}

function titleAndContent(slide: SlideSpec, brand: NonNullable<Slideml2Deck["deck"]["brand"]>): DomNode {
  const title = stringProp(slide, "title", "Untitled");
  const body = stringArrayProp(slide, "items", []);
  const children: DomNode[] = [
    {
      id: `${slide.id}.title`,
      type: "text",
      text: title,
      style: "slide-title",
      align: "left",
    },
    {
      id: `${slide.id}.content`,
      type: "stack",
      area: "content",
      direction: "vertical",
      gap: 0.35,
      align: "start",
      children: body.length > 0
        ? [{ id: `${slide.id}.bullets`, type: "bullets", items: body, density: "comfortable" }]
        : [],
    },
  ];
  if (brand.logo) children.push(brandLogo(slide.id, brand.logo));
  return baseSlide(slide, children);
}

function imageAndText(slide: SlideSpec, brand: NonNullable<Slideml2Deck["deck"]["brand"]>): DomNode {
  const title = stringProp(slide, "title", "Untitled");
  const image = stringProp(slide, "image", "");
  const text = stringProp(slide, "text", "");
  const children: DomNode[] = [
    { id: `${slide.id}.title`, type: "text", text: title, style: "slide-title" },
    {
      id: `${slide.id}.columns`,
      type: "grid",
      area: "content",
      columns: 2,
      gap: 0.55,
      children: [
        { id: `${slide.id}.image`, type: "image", src: image, fit: "cover", alt: title },
        { id: `${slide.id}.text`, type: "text", text, style: "body" },
      ],
    },
  ];
  if (brand.logo) children.push(brandLogo(slide.id, brand.logo));
  return baseSlide(slide, children);
}

function brandLogo(slideId: string, src: string): DomNode {
  return {
    id: `${slideId}.brandLogo`,
    type: "image",
    src,
    alt: "Brand logo",
    anchor: "top-right",
    width: 2.4,
    height: 1.0,
    fit: "contain",
  };
}

function stringProp(slide: SlideSpec, key: string, fallback: string): string {
  const value = slide[key as keyof SlideSpec];
  return typeof value === "string" ? value : fallback;
}

function stringArrayProp(slide: SlideSpec, key: string, fallback: string[]): string[] {
  const value = slide[key as keyof SlideSpec];
  return Array.isArray(value) ? value.map(String) : fallback;
}

export function getSlide(deck: RenderedDeck, slideId: string): RenderedSlide {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Slide not found: ${slideId}`);
  return slide;
}
