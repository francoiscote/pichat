# Fork notes render only the continuation and link to the parent conversation note

Pi's fork/clone machinery copies the parent session's entries (with their original ids) into a new session file whose header points at the parent (`parentSession`). A naive export would therefore duplicate the parent conversation into every fork note. We decided fork notes render **only the post-fork segment** — entries of the fork's active branch whose ids do not appear in the parent session file — and open with a quoted Obsidian wikilink: `> Continues [[<parent-note>]]`. The link target resolves from the extension's export registry (exact note path the exporter last wrote for the parent session), falling back to the canonical parent filename computed from the parent file on disk. Forks with no post-fork output produce no note.

**Status**: accepted

**Considered Options**:
- Duplicate the full parent transcript into the fork note — self-contained but bloats the vault and diverges if the parent changes.
- Render the post-fork segment without any link — loses the parent context.

**Consequences**: fork notes carry only their own content and are linked (not nested) to the parent; chains of forks resolve transitively one link per note; a link goes stale if the parent note is renamed manually in Obsidian.
