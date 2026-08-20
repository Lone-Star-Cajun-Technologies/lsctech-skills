import { mkdir, appendFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

/**
 * Integration points required by LON-68's scope line "Integration with
 * existing memory tool and SOP wiki". Deliberately thin: the ledger
 * (store.mjs) is the source of truth and history; these two functions only
 * project a `memory`-type global item into the two systems an agent
 * actually reads from at wake time, so a refined ledger item is discoverable
 * without an agent having to know the ledger exists.
 */

/**
 * Project a global `memory`-type item into this agent's existing
 * frontmatter-memory convention (a `<slug>.md` file plus a one-line
 * `MEMORY.md` index pointer, per AGENTS.md). Idempotent: re-running after a
 * refine overwrites the body file and leaves the index line alone if
 * already present.
 *
 * @param item a `memory`-type item from HarnessStateStore, scope 'global'
 * @param memoryDir directory containing MEMORY.md and the per-topic files
 */
export async function exportGlobalMemoryToFile(item, memoryDir) {
  if (item.type !== 'memory') throw new Error(`exportGlobalMemoryToFile expects a 'memory' item, got '${item.type}'`);
  if (item.scope !== 'global') throw new Error("exportGlobalMemoryToFile expects scope 'global' (task-scoped memories don't belong in the org index)");

  const slug = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const fileName = `${slug}.md`;
  await mkdir(memoryDir, { recursive: true });

  const frontmatter = [
    '---',
    `name: ${slug}`,
    `description: ${item.title}`,
    'metadata:',
    '  type: project',
    `  ledgerId: ${item.id}`,
    `  ledgerRevision: ${item.currentRevision}`,
    '---',
    '',
    item.body,
    '',
  ].join('\n');
  await writeFile(path.join(memoryDir, fileName), frontmatter);

  const indexPath = path.join(memoryDir, 'MEMORY.md');
  const indexLine = `- [${item.title}](${fileName}) — synced from harness-state-store (${item.id.slice(0, 8)})`;
  let exists = false;
  try {
    await access(indexPath);
    exists = true;
  } catch {
    // no index yet
  }
  if (!exists) {
    await writeFile(indexPath, `${indexLine}\n`);
    return { fileName, indexUpdated: true };
  }
  const { readFile } = await import('node:fs/promises');
  const current = await readFile(indexPath, 'utf8');
  if (current.includes(`(${item.id.slice(0, 8)})`)) {
    return { fileName, indexUpdated: false };
  }
  await appendFile(indexPath, `${indexLine}\n`);
  return { fileName, indexUpdated: true };
}

/**
 * Create a `prompt_note`-shaped payload that cites an SOP wiki doc instead
 * of copying it — the wiki stays authoritative for doctrine (per
 * AGENTS.md: "The LSCTech-Wiki is authoritative for operating doctrine"),
 * the ledger only stores a pointer plus the specific hook that made this
 * task consult it. Callers pass the result straight to `store.create`.
 */
export function wikiReference(wikiPath, { hook, scope = 'global', taskId = null }) {
  if (!wikiPath) throw new Error('wikiPath is required');
  if (!hook) throw new Error('hook is required (why this doc was relevant)');
  return {
    type: 'prompt_note',
    scope,
    taskId,
    title: `wiki-ref: ${wikiPath}`,
    body: `See ${wikiPath}.\n\nWhy: ${hook}`,
  };
}
