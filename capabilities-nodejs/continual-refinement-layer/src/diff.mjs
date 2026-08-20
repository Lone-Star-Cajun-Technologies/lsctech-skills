// Minimal line-based diff, used only to size a proposed edit ("is this a
// small edit?"). No external deps — this layer has to run in any harness.

/** Longest-common-subsequence length between two line arrays. */
function lcsLength(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Count of changed lines (removed + added) between two bodies. Two
 * identical bodies return 0; a full rewrite returns oldLines + newLines.
 */
export function lineChangeCount(oldBody, newBody) {
  const a = oldBody.split('\n');
  const b = newBody.split('\n');
  const common = lcsLength(a, b);
  return (a.length - common) + (b.length - common);
}
