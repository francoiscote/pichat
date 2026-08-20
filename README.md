# PiChat - a pi non-coding harness for General AI chats

A separate, self-contained [pi](https://pi.dev) harness with its own
skills, extensions, themes, and settings. It runs as a second pi instance
alongside your normal one, sharing only credentials if you choose.

- Config directory: `~/.pi/pichat` (override via `PI_PICHAT_DIR`)
- Command: `pichat` — a thin launcher that points pi at that directory
- CLI parity: every argument is passed through to pi untouched, so package
  management works the same as in regular pi (`pichat install npm:x`,
  `pichat list`, `pichat config`, …) — but writes to PiChat's own config dir
- Same resource discovery as pi: skills, extensions, themes, and prompts are
  auto-discovered from the PiChat config directory, the home-level
  `~/.agents/skills`, and project `.agents/skills` on trusted projects. Your
  `~/.pi/agent/skills` (the other harness's agent dir) is never picked up —
  keep PiChat-specific skills in this repo's `skills/` dir
- Automatic export of all conversation into an Obsidian Vault as Markdown files.

## Layout

| Path            | Purpose                                          |
|-----------------|--------------------------------------------------|
| `settings.json` | pichat's pi settings (theme, models, …)          |
| `skills/`       | skills (SKILL.md directories, auto-discovered)    |
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
pichat install npm:whatever   # install a package (same CLI as pi)
pichat list       # list installed packages
pichat config     # package/settings TUI (Tab switches scope)
pichat update     # git pull the installed config + pi update --all
```

## Obsidian conversation exporter

`extensions/obsidian-export/` exports every conversation into your Obsidian
vault as `YYYY-MM-DD - Conversation Title.md` notes.

- **Trigger:** automatic whenever a session ends (quit, `/new`, `/resume`,
  `/fork`), plus a manual `/export-obsidian "Custom Title"` command.
- **Content:** user and assistant messages, tool calls and (truncated) results,
  compaction summaries, image attachments (copied into an `_assets` subfolder
  and embedded via `![[…]]` links). Thinking blocks are excluded.
- **Fork/clone sessions** render only their own continuation and open with a
  `> Continues [[parent note]]` wikilink — the parent conversation is never
  duplicated.
- **Frontmatter** (lean): `title`, `date`, `models`, `tokens` (total),
  `cost_total`.
- **Archive semantics:** the export folder is an archive — notes are
  rewritten in full whenever the conversation gained new messages, with no
  hand-edit detection.

Configuration (environment variables):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PICHAT_VAULT_EXPORT_DIR` | `~/Obsidian/Vault/pi-conversations` | Vault export folder |
| `PICHAT_VAULT_EXPORT_ASSETS` | `_assets` | Assets subfolder name |
| `PICHAT_EXPORT_DEBUG` | — | `1` to log skip reasons to stderr |

State (last-exported entry ids, written note paths) lives in
`$PI_CODING_AGENT_DIR/state/obsidian-export.json` — never inside the vault.

## Security

Resources (skills, extensions, themes, prompts) are loaded from the same
discovery paths as regular pi: the PiChat config directory (what is shipped
in this repo plus anything you `pichat install` into it), the home-level
`~/.agents/skills`, and project `.agents/skills` on trusted projects. Skills
can instruct the model to run arbitrary commands and extensions run as your
user — review anything new before installing or committing it. Never commit
`auth.json` or any credential to this repository.
