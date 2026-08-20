# Conversation notes are snapshots keyed by conversation, not by day

A pi session is a per-cwd, per-start JSONL file and can be resumed across days; an Obsidian note named `YYYY-MM-DD - Title.md` is keyed by conversation. We decided that the note's date is the conversation's **first-message date** and its filename is stable for the conversation's lifetime — a resume on a later day updates the same note, and same-day collisions get a ` 2` suffix. The note is fully rewritten on export **only when** the session gained new messages since the last export **and** the user has not edited the note since (tracked via last-exported entry id and note mtime in the extension's state file, which lives outside the vault). Exports skip sessions with no assistant turns.

**Status**: accepted

**Considered Options**:
- Per-day notes (each day's activity gets its own note containing the full history so far) — duplicates content across notes and breaks "one note per conversation".
- Append-only diffs under a `## Continued` header — preserves user edits but produces patchwork notes.
- Always-rewrite on every export point — deterministic but clobbers user tags/annotations in Obsidian.

**Consequences**: resumed conversations extend the original date's note (readers must accept that a note dated a month ago may contain fresh entries); a stale link arises naturally if a note is manually renamed in Obsidian (see ADR 0002).
