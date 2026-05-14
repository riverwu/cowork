# Seedream Icon Sheet Fixtures

These fixtures are real icon-sheet outputs from the Doubao Seedream image
generation engine, captured from SlideML2 deck-generation runs.

The files intentionally keep their original `.png` extension even though the
payload bytes are JPEG/JFIF. Seedream returned downloadable image bytes that the
app saved at the requested `.png` output path, so `slice-icons` must identify
the image format from the file signature rather than the extension.

Fixture sources:

- `youdao-business-3x3.seedream.png` — `doubao-seedream-4-5-251128`, 4096x4096,
  white background, 3x3 business icon sheet.
- `chilechuan-dark-3x3-six-icons.seedream.png` — `doubao-seedream-4-5-251128`,
  4096x4096, dark background, 3x3 sheet with six requested icons and unused cells.
- `physics-dark-3x3.seedream.png` — `doubao-seedream-4-5-251128`, 4096x4096,
  dark science icon sheet, 3x3.
- `physics-dark-1x1.seedream.png` — `doubao-seedream-4-5-251128`, 4096x4096,
  dark science icon sheet, 1x1.
