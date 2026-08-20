# Conversation notes are snapshots keyed by conversation, not by day

A pi session is a per-cwd, per-start JSONL file and can be resumed across days; an Obsidian note named `YYYY-MM-DD - Title.md` is keyed by conversation. We decided that the note's date is the conversation's **first-message date** and its filename is stable for the conversation's lifetime — a resume on a later day updates the same note, and same-day collisions get a ` 2` suffix. The note is fully rewritten on export **whenever** the session gained new messages since the last export (tracked via last-exported entry id in the extension's state file, which lives outside the vault). The export folder is an **archive**: its notes are never edited by hand, so no user-edit protection exists. Exports skip sessions with no assistant turns.

**Status**: accepted

**Considered Options**:
- Per-day notes (each day's activity gets its own note containing the full history so far) — duplicates content across notes and breaks "one note per conversation".
- Append-only diffs under a `## Continued` header — produces patchwork notes and fights full-snapshot semantics.
- User-edit protection (skip rewriting any note whose Obsidian mtime changed) — rejected: the export folder is an archive that the user never edits, and protecting against phantom edits would silently drop new conversation turns.

**Consequences**: resumed conversations extend the original date's note (readers must accept that a note dated a month ago may contain fresh entries); a stale link arises naturally if a note is manually renamed in Obsidian (see ADR 0002).
