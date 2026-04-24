/**
 * Extended catalog skills from https://github.com/anthropics/skills
 *
 * These skills provide professional document generation capabilities.
 * Full SKILL.md content is stored here and written to filesystem on install.
 */

import type { CatalogSkill } from "./catalog";

// Skill content fetched from the Anthropic skills repo
// Each contains the complete SKILL.md for installation

export const ANTHROPIC_SKILLS: CatalogSkill[] = [
  {
    id: "docx",
    name: "Word Document (DOCX)",
    version: "1.0.0",
    description: "Create, read, edit, and manipulate Word documents (.docx files) with professional formatting",
    skillMd: `---
name: docx
description: "Create, read, edit, or manipulate Word documents (.docx files). Triggers on mentions of 'Word doc', '.docx', or requests for professional documents with formatting like tables of contents, headings, page numbers."
---
## Instructions
- For creating new .docx files, use docx-js (npm install -g docx)
- For reading content, use pandoc or unpack the XML
- For editing existing files, unpack → edit XML → repack
- Always set page size explicitly (defaults to A4, use US Letter 12240x15840 DXA for US)
- Never use \\n — use separate Paragraph elements
- Never use unicode bullets — use LevelFormat.BULLET with numbering config
- Tables need dual widths: columnWidths array AND cell width, both must match
- Always use WidthType.DXA for tables (never PERCENTAGE — breaks in Google Docs)
- ImageRun requires type parameter (png, jpg, etc.)
- PageBreak must be inside a Paragraph
- For tracked changes, use "Claude" as author
- Validate output with: python scripts/office/validate.py doc.docx
`,
  },
  {
    id: "pdf",
    name: "PDF Processing",
    version: "1.0.0",
    description: "Read, create, merge, split, and manipulate PDF files with Python tools",
    skillMd: `---
name: pdf
description: "Process PDF files: read/extract text and tables, merge/split PDFs, rotate pages, add watermarks, create new PDFs, fill forms, encrypt/decrypt, extract images, OCR scanned PDFs."
---
## Instructions
- Use pypdf for basic operations (merge, split, rotate, encrypt)
- Use pdfplumber for text and table extraction
- Use reportlab for creating new PDFs
- For scanned PDFs, use pytesseract + pdf2image for OCR
- Never use Unicode subscript/superscript characters in ReportLab (renders as black boxes)
- Use ReportLab XML markup tags instead: <sub> and <super>
- For form filling, use pdf-lib or pypdf
- Command line tools: pdftotext, qpdf, pdftk
- Extract tables to Excel: pdfplumber → pandas → to_excel
`,
  },
  {
    id: "frontend-design",
    name: "Frontend Design",
    version: "1.0.0",
    description: "Create distinctive, production-grade frontend interfaces with high design quality",
    skillMd: `---
name: frontend-design
description: "Create distinctive, production-grade frontend interfaces. Use when building web components, pages, dashboards, React components, HTML/CSS layouts, or styling any web UI."
---
## Instructions
- Before coding, commit to a BOLD aesthetic direction (brutally minimal, maximalist, retro-futuristic, etc.)
- Choose fonts that are beautiful and unique — NEVER use generic fonts like Arial, Inter, Roboto
- Pair a distinctive display font with a refined body font
- Use CSS variables for color consistency
- Dominant colors with sharp accents outperform timid, evenly-distributed palettes
- Add animations: staggered reveals, scroll-triggering, surprising hover states
- Use unexpected layouts: asymmetry, overlap, diagonal flow, grid-breaking elements
- Create atmosphere with gradient meshes, noise textures, geometric patterns, layered transparencies
- NEVER use generic AI aesthetics: overused fonts, purple gradients on white, predictable layouts
- Match implementation complexity to the aesthetic vision
- Every generation should look different — vary themes, fonts, aesthetics
`,
  },
  {
    id: "pptx",
    name: "PowerPoint (PPTX)",
    version: "1.0.0",
    description: "Create, read, edit, and manipulate PowerPoint presentations with professional design",
    skillMd: `---
name: pptx
description: "Create, read, edit PowerPoint presentations (.pptx). Use for slide decks, pitch decks, presentations. Triggers on mentions of 'deck', 'slides', 'presentation', or .pptx files."
---
## Instructions
- Read content: python -m markitdown presentation.pptx
- Create from scratch: use pptxgenjs (npm install -g pptxgenjs)
- Edit existing: unpack → manipulate slides → edit content → pack
- Pick a bold, content-informed color palette (not generic blue)
- Every slide needs a visual element — image, chart, icon, or shape
- Vary layouts: two-column, icon+text rows, 2x2 grid, half-bleed image
- Use large stat callouts (60-72pt) for data display
- Choose interesting font pairings (not Arial defaults)
- Title: 36-44pt bold, Body: 14-16pt, Captions: 10-12pt
- 0.5" minimum margins, 0.3-0.5" between content blocks
- NEVER use accent lines under titles (hallmark of AI-generated slides)
- Don't repeat the same layout across slides
- Dark backgrounds for title + conclusion, light for content
- Always do visual QA: convert to images and inspect
- Convert to images: soffice --convert-to pdf → pdftoppm -jpeg -r 150
- Dependencies: markitdown[pptx], pptxgenjs, LibreOffice, Poppler
`,
  },
  {
    id: "xlsx",
    name: "Excel Spreadsheet (XLSX)",
    version: "1.0.0",
    description: "Create, edit, and analyze Excel spreadsheets with formulas, formatting, and charts",
    skillMd: `---
name: xlsx
description: "Create, edit, analyze Excel spreadsheets (.xlsx, .xlsm, .csv, .tsv). Triggers for any spreadsheet file as input or output."
---
## Instructions
- Use pandas for data analysis, openpyxl for formulas and formatting
- ALWAYS use Excel formulas instead of hardcoded Python calculations
- Use professional font (Arial, Times New Roman) unless user specifies otherwise
- Deliver with ZERO formula errors (#REF!, #DIV/0!, #VALUE!, #N/A, #NAME?)
- Financial model color coding: Blue=inputs, Black=formulas, Green=cross-sheet links
- Number formatting: Currency $#,##0, Percentages 0.0%, Negatives in parentheses
- Place ALL assumptions in separate cells, reference them in formulas
- After creating/modifying: recalculate with python scripts/recalc.py output.xlsx
- Verify recalc output JSON for any errors, fix and recalculate again
- openpyxl cells are 1-based (row=1, column=1 = A1)
- WARNING: data_only=True + save permanently loses formulas
- Document data sources for hardcoded values in cell comments
`,
  },
];
