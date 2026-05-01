import { classifyComponents } from "../src/component-registry.js";
const c = classifyComponents();
console.log(`PRIMITIVES (${c.primitives.length}):`);
for (const p of c.primitives) console.log(`  ${p.name.padEnd(16)} — ${p.purpose}`);
console.log(`\nSEMANTIC COMPONENTS (${c.semantics.length}):`);
for (const p of c.semantics) console.log(`  ${p.name.padEnd(20)} — ${p.purpose}`);
