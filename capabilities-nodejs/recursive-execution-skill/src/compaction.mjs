// Compaction-aware context management.
//
// Research report §2.2 / §4.1 state: summarize older trace entries once the
// estimated token size crosses a threshold, while keeping the most recent
// entries verbatim and never touching persistent structured state (budget
// ledger, child registry) -- only the free-text trace gets compacted, same
// as "IPython kernel state persists through compaction" in the source
// system, translated away from a Python-specific mechanism.

// Rough, dependency-free token estimate (chars/4). Good enough for a budget
// gate; callers needing real accuracy should inject a tokenizer instead.
export function estimateTokens(text) {
  return Math.ceil((text?.length ?? 0) / 4);
}

function entryTokens(entry) {
  return estimateTokens(JSON.stringify(entry.detail ?? entry));
}

// entries: append-only array of {id, parentId, type, detail, ...}.
// Returns a possibly-shortened array with a synthetic 'compactionSummary'
// entry prepended over anything older than the kept boundary.
export function compactIfNeeded(entries, { thresholdTokens, keepRecentTokens, summarize } = {}) {
  if (!Number.isFinite(thresholdTokens) || !Number.isFinite(keepRecentTokens)) {
    throw new Error('compactIfNeeded: thresholdTokens and keepRecentTokens are required');
  }
  const totalTokens = entries.reduce((sum, e) => sum + entryTokens(e), 0);
  if (totalTokens <= thresholdTokens) {
    return { entries, compacted: false, totalTokens };
  }

  // Walk backwards from the end, keeping whole entries until keepRecentTokens
  // is reached -- this is the "kept boundary" (firstKeptEntryId) concept.
  let kept = [];
  let keptTokens = 0;
  let splitIndex = entries.length;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const t = entryTokens(entries[i]);
    if (keptTokens + t > keepRecentTokens && kept.length > 0) {
      splitIndex = i + 1;
      break;
    }
    kept.unshift(entries[i]);
    keptTokens += t;
    splitIndex = i;
  }

  const older = entries.slice(0, splitIndex);
  if (older.length === 0) {
    return { entries, compacted: false, totalTokens };
  }

  const summaryText = summarize
    ? summarize(older)
    : `Compacted ${older.length} earlier trace entries (${older.reduce((s, e) => s + entryTokens(e), 0)} tokens).`;

  const summaryEntry = {
    id: `compaction-${Date.now().toString(36)}`,
    type: 'compactionSummary',
    detail: { summary: summaryText, replacedEntryCount: older.length },
  };

  return { entries: [summaryEntry, ...kept], compacted: true, totalTokens };
}
