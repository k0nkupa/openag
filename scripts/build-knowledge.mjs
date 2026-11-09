// Release handbook: validate canonical topics, then atomically replace the generated bundle.
import { readFileSync, lstatSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { handbookSchema, handbookVersion, HELP_INDEX_MAX } from '../apps/daemon/dist/knowledge.js';

const root = new URL('../', import.meta.url);
const source = new URL('docs/help/', root);
const read = url => {
  const st = lstatSync(url);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 100_000) throw Error('Invalid handbook source: ' + fileURLToPath(url));
  return readFileSync(url, 'utf8');
};
const manifest = JSON.parse(read(new URL('manifest.json', source)));
if (!Array.isArray(manifest) || manifest.length > 13) throw Error('Invalid handbook manifest');
const topics = handbookSchema.parse(manifest.map(entry => {
  if (!/^[a-z0-9-]{1,40}$/.test(entry.slug)) throw Error('Invalid topic ID');
  return { ...entry, body: read(new URL(entry.slug + '.md', source)) };
}));
for (const topic of topics) for (const reference of topic.sources) {
  if (!/^(docs\/|apps\/daemon\/src\/|apps\/desk\/src\/)[a-zA-Z0-9_./-]+$/.test(reference) || reference.split('/').includes('..')) throw Error('Invalid handbook reference');
  if (!lstatSync(new URL(reference, root)).isFile()) throw Error('Missing handbook reference: ' + reference);
}
// Same loader used at runtime validates the generated index and digest before publishing.
const output = new URL('apps/daemon/dist/knowledge.json', root);
const temporary = new URL(`apps/daemon/dist/knowledge-${randomUUID()}.tmp`, root);
writeFileSync(temporary, JSON.stringify({ version: handbookVersion(topics), topics }) + '\n', { flag: 'wx' });
try {
const { loadKnowledge } = await import('../apps/daemon/dist/knowledge.js');
const loaded = loadKnowledge(temporary);
if (!loaded.load(topics[0].slug).found || Buffer.byteLength(loaded.index()) > HELP_INDEX_MAX) throw Error('Invalid packaged handbook');
renameSync(temporary, output);
} finally { rmSync(temporary, { force: true }); }
console.log(`Handbook packaged: ${topics.length} topics`);
