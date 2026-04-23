#!/bin/bash
# Build Catalog — generates catalog entries from known sources.
#
# Usage: bash scripts/build-catalog.sh
#
# This script generates catalog entries and prints them.
# Review the output and paste into src/lib/catalog.ts.

set -e

echo "=== Generating MCP entries ==="
echo ""

# Brave Search
echo "// --- Brave Search ---"
npx tsx scripts/gen-catalog-entry.ts mcp "Brave Search" \
  "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src/brave-search/README.md" \
  2>/dev/null || echo "// Failed: brave-search"
echo ""

# GitHub
echo "// --- GitHub ---"
npx tsx scripts/gen-catalog-entry.ts mcp "GitHub" \
  "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src/github/README.md" \
  2>/dev/null || echo "// Failed: github"
echo ""

echo "=== Generating Skill entries ==="
echo ""

# Note: Skills are manually crafted — the generator is for bootstrapping.
# Review and edit the output before adding to catalog.

echo "Done. Review output and paste into src/lib/catalog.ts"
