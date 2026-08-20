# PiChat - a pi non-coding harness for General AI chats

A separate, self-contained [pi](https://pi.dev) harness with its own
skills, extensions, themes, and settings. It runs as a second pi instance
alongside your normal one, sharing only credentials if you choose.

- Config directory: `~/.pi/pichat` (override via `PI_PICHAT_DIR`)
- Command: `pichat` — a thin launcher that points pi at that directory
- Skill isolation: the launcher runs `pi --no-skills --skill <dir>/skills`,
  so PiChat's skills are the only ones loaded (your `~/.agents/skills` and
  `~/.pi/agent/skills` are not picked up)

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

## Security

The launcher's skill/extension/theme loading is exactly what is shipped in
this repo. Skills can instruct the model to run arbitrary commands and
extensions run as your user — review anything new before committing it.
Never commit `auth.json` or any credential to this repository.
