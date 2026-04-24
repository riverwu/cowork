---
name: translator
type: skill
version: 1.0.0
description: Translate documents between languages while preserving formatting and context
parameters:
  target_language: Target language for translation
---
## Instructions
- Read the source document
- Translate while preserving the original formatting (headers, lists, tables)
- Maintain technical terms and proper nouns
- Adapt idioms and cultural references appropriately
- Preserve code blocks and URLs without translation
- Write the translated version using write_file or create_artifact
