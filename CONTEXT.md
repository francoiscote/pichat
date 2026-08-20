# Glossary

The shared vocabulary for PiChat's Obsidian export extension.

- **Session**: a pi session — one JSONL file under the pichat `sessions/` directory, created per working-directory/start-time. The unit of storage, not of user-facing conversations.
- **Conversation**: the user-facing chat experience. May span one session, or continue across sessions (resumed sessions, `/new` chains, forks). A conversation is what gets exported.
- **Conversation note**: the exported Markdown file in the vault, named `YYYY-MM-DD - Title.md`.
- **Export**: the act of rendering a session's active branch (plus metadata) into a conversation note. Runs automatically at session end and on demand via `/export`.
- **Active branch**: the entry path from root to the current leaf of a session — what a conversation note renders. Side branches are not exported.
- **Title**: the conversation's display name used in the filename. Resolution order: session `/name` → cleaned/truncated first user message → `Untitled`; overridable via `/export "Title"`.
- **Asset**: an image binary copied out of a session into the vault assets subfolder (`_assets` by default); embedded in the conversation note via an Obsidian-relative link.
- **Frontmatter**: the YAML header of a conversation note. Kept lean by choice: `title`, `date` (first-message time), `models` (unique provider/model pairs), `tokens` (grand total), `cost_total` (dollars). Richer per-message detail (per-model breakdowns, session id, cwd) is intentionally excluded.
- **Compaction block**: the quoted summary section in a conversation note representing a pi compaction entry — history the session summarised and dropped.
- **Export metadata**: the aggregated facts recorded in frontmatter — distinct from **conversation content**, which is the human-readable transcript in the note body.
- **Parent session**: the session a fork or clone was created from; the fork's session header points at its file (`parentSession`).
- **Post-fork segment**: the entries of a fork's active branch whose ids do **not** appear in the parent session. Fork notes render only this segment — the parent conversation is never duplicated.
- **Continuation link**: the Obsidian wikilink opening a fork note, pointing at the parent conversation note (`> Continues [[…]]`).
- **Conversation boundary**: the cut between duplicated parent history and a fork's own content. Determined by id provenance, not by position in the file.
