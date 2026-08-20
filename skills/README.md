# PiChat skills

Add skills here as directories containing a `SKILL.md` (Agent Skills format).
The `pichat` launcher loads exactly this directory via `--skill`, so skills
here are isolated from your other pi harnesses (and from `~/.agents/skills`,
which is disabled with `--no-skills`).

Example:

```
skills/
└── pdf-tools/
    ├── SKILL.md
    └── scripts/process.sh
```

This directory must stay non-empty or the launcher omits the `--skill` flag
(the launcher checks for its existence).
