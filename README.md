# PiChat - a pi non-coding harness for General AI chats

A separate, self-contained [pi](https://pi.dev) harness with its own
skills, extensions, themes, and settings. It runs as a second pi instance
alongside your normal one, sharing only credentials if you choose.

- Config directory: `~/.pi/pichat` (override via `PI_PICHAT_DIR`)
- Command: `pichat` — a thin launcher that points pi at that directory
- Skill isolation: the launcher runs `pi --no-skills --skill <dir>/skills`,
  so PiChat's skills are the only ones loaded (your `~/.agents/skills` and
  `~/.pi/agent/skills` are not picked up)
- Automatic export of all conversation into an Obsidian Vault as Markdown files.

## Layout

| Path            | Purpose                                          |
|-----------------|--------------------------------------------------|
| `settings.json` | pichat's pi settings (theme, models, …)          |
| `skills/`       | skills (SKILL.md directories), loaded via --skill |
| `extensions/`   | pi extensions (auto-discovered, `*.ts`)          |
| `themes/`       | themes (auto-discovered, `*.json`)               |
| `prompts/`      | prompt templates (auto-discovered)               |
| `bin/pichat`    | the launcher script                              |
| `install.sh`    | bootstrap installer for new machines             |

Generated state (`auth.json`, `sessions/`, `npm/`, `models-store.json`, ...)
is never committed; see `.gitignore`.

## Prerequisites

- [pi](https://pi.dev) on PATH (e.g. `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`)
- git

## Install

```sh
git clone <this-repo-url> ~/.pi/pichat   # or clone anywhere and set PI_PICHAT_DIR
~/.pi/pichat/install.sh                  # --force --link-auth --rc as desired
```

`install.sh` options:

- `--force` — replace an existing directory (backs it up first)
- `--link-auth` — symlink `auth.json` to your existing `~/.pi/agent/auth.json`
  so both harnesses share credentials (OAuth token refresh keeps working)
- `--rc` — add a `pichat` shell function to `~/.zshrc` (convenience for
  interactive shells; the `pichat` command on PATH already works everywhere)
- `--bin-dir <dir>` / `--no-bin` — control where the `pichat` command is linked

No credentials are ever written or copied. Without `--link-auth`, run
`/login` once inside the new harness.

## Use

```sh
pichat            # start the PiChat harness
pichat -p "…"     # one-shot, as with pi
pichat update     # git pull the installed config + pi update --all
```

## Obsidian conversation exporter

`extensions/obsidian-export/` exports every conversation into your Obsidian
vault as `YYYY-MM-DD - Conversation Title.md` notes.

- **Trigger:** automatic whenever a session ends (quit, `/new`, `/resume`,
  `/fork`), plus a manual `/export "Custom Title"` command.
- **Content:** user and assistant messages, tool calls and (truncated) results,
  compaction summaries, image attachments (copied into an `_assets` subfolder
  and embedded via `![[…]]` links). Thinking blocks are excluded.
- **Fork/clone sessions** render only their own continuation and open with a
  `> Continues [[parent note]]` wikilink — the parent conversation is never
  duplicated.
- **Frontmatter** (lean): `title`, `date`, `models`, `tokens` (total),
  `cost_total`.
- **Safety:** notes are rewritten only when the conversation gained new
  messages and you haven't edited the note in Obsidian since.

Configuration (environment variables):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICHAT_VAULT_EXPORT_DIR` | `~/Obsidian/Vault/pi-conversations` | Vault export folder |
| `PICHAT_VAULT_EXPORT_ASSETS` | `_assets` | Assets subfolder name |
| `PICHAT_EXPORT_DEBUG` | — | `1` to log skip reasons to stderr |

State (last-exported entry ids, note mtimes, written note paths) lives in
`$PI_CODING_AGENT_DIR/state/obsidian-export.json` — never inside the vault.

## Security

The launcher's skill/extension/theme loading is exactly what is shipped in
this repo. Skills can instruct the model to run arbitrary commands and
extensions run as your user — review anything new before committing it.
Never commit `auth.json` or any credential to this repository.
