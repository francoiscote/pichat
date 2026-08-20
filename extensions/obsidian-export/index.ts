/**
 * Obsidian Conversation Exporter for PiChat
 *
 * Exports pi sessions as Obsidian Markdown notes named `YYYY-MM-DD - Title.md`
 * into a vault folder, with images copied into an `_assets` subfolder and
 * embedded via Obsidian-relative links.
 *
 * Design (see docs/adr/0001, docs/adr/0002 and CONTEXT.md):
 *  - One note per *conversation*, dated at the first message; resumes update
 *    the same note. Same-day collisions get " 2" suffixes.
 *  - Full rewrite only when the session gained new entries AND the user has
 *    not edited the note since the last export.
 *  - Fork/clone sessions render only their post-fork segment (entry ids that
 *    do not exist in the parent session) and open with a [[wikilink]] to the
 *    parent conversation note.
 *  - Sessions with no assistant turns are skipped.
 *
 * Configuration (environment variables):
 *  - PICHAT_VAULT_EXPORT_DIR  (default: ~/Obsidian/Vault/pi-conversations)
 *  - PICHAT_VAULT_EXPORT_ASSETS (default: _assets) — assets subfolder name
 *
 * State is kept outside the vault at $PI_CODING_AGENT_DIR/state/obsidian-export.json
 * (fallback ~/.pi/pichat/state/obsidian-export.json).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";

/* ------------------------------------------------------------------ */
/* Constants & config                                                  */
/* ------------------------------------------------------------------ */

const DEFAULT_EXPORT_DIR = join(homedir(), "Obsidian", "Vault", "pi-conversations");
const OUTPUT_CAP = 4000; // tool result / shell output cap in the note
const ARGS_CAP = 200; // tool arguments cap
const SUMMARY_CAP = 2000; // compaction / branch summary cap
const TITLE_MAX = 60; // title length cap
const SANITIZE_RE = /[\/\\:*?"<>|\u0000-\u001f]/g; // illegal filename chars (incl. | for wiki-links)
const MARKDOWN_NOISE_RE = /[*_~`#>|]/g; // stripped from titles derived from messages
const AUTO_REASONS = new Set(["quit", "new", "resume", "fork"]);
const MAX_PARENT_DEPTH = 5;
const DEBUG = process.env.PICHAT_EXPORT_DEBUG === "1";

function debugLog(...args: unknown[]) {
  if (DEBUG) console.log("[obsidian-export]", ...args);
}

function getConfig() {
  const exportDir =
    (process.env.PICHAT_VAULT_EXPORT_DIR ?? "").trim() || DEFAULT_EXPORT_DIR;
  const assetsName =
    (process.env.PICHAT_VAULT_EXPORT_ASSETS ?? "").trim() || "_assets";
  return {
    exportDir,
    assetsName: sanitizeFilename(assetsName) || "_assets",
    assetsDir: join(exportDir, sanitizeFilename(assetsName) || "_assets"),
  };
}

function getStateFile(): string {
  const agentDir =
    process.env.PI_PICHAT_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    join(homedir(), ".pi", "pichat");
  return join(agentDir, "state", "obsidian-export.json");
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function sanitizeFilename(s: string): string {
  return s.replace(SANITIZE_RE, "").replace(/\s+/g, " ").trim();
}

function truncateText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n…(truncated — full output in session)`;
}

function extractText(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts;
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return map[mimeType.toLowerCase()] ?? "png";
}

function formatClock(ts: unknown): string {
  const d = new Date(typeof ts === "string" ? ts : (ts as number));
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    .replace(/^0(\d):/, "$1:");
}

/** Clean a raw message fragment into a short title. */
function titleFromText(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(MARKDOWN_NOISE_RE, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > TITLE_MAX ? `${cleaned.slice(0, TITLE_MAX).trimEnd()}…` : cleaned;
}

/** First available filename for a base name; same-day collisions get " 2", " 3", … */
async function uniqueNotePath(exportDir: string, base: string): Promise<string> {
  const existing = new Set(await safeReaddir(exportDir));
  let candidate = `${base}.md`;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${base} ${n}.md`;
    n += 1;
  }
  return join(exportDir, candidate);
}

async function sessionHasMessages(file: string): Promise<boolean> {
  try {
    return (await readFile(file, "utf8")).includes('"type":"message"');
  } catch {
    return false;
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* State (last-exported entry, note mtime, written note path)          */
/* ------------------------------------------------------------------ */

interface SessionRecord {
  lastExportedEntryId: string | null;
  notePath: string;
  noteMtime: number;
}

interface ExportState {
  sessions: Record<string, SessionRecord>;
}

let stateCache: ExportState | null = null;

async function loadState(): Promise<ExportState> {
  if (stateCache) return stateCache;
  const file = getStateFile();
  try {
    stateCache = JSON.parse(await readFile(file, "utf8")) as ExportState;
  } catch {
    stateCache = { sessions: {} };
  }
  // Prune records whose session file disappeared.
  for (const [filePath, record] of Object.entries(stateCache.sessions)) {
    if (!(await exists(filePath)) || !(await exists(record.notePath))) {
      delete stateCache.sessions[filePath];
    }
  }
  return stateCache;
}

async function saveState(state: ExportState): Promise<void> {
  const file = getStateFile();
  await mkdir(join(file, ".."), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, file);
}

/* ------------------------------------------------------------------ */
/* Session analysis                                                    */
/* ------------------------------------------------------------------ */

type HeaderLike = { parentSession?: string; cwd?: string } | null;

interface SegmentInfo {
  header: HeaderLike;
  parentFile: string | null;
  parentReadable: boolean;
  /** Branch entries limited to the post-fork segment (fork-aware). */
  segment: any[];
  /** First message timestamp as ISO string, or null. */
  firstMessageIso: string | null;
  /** First user message text on the segment, or null. */
  firstUserText: string | null;
  /** /name from session_info entries on the segment. */
  sessionName: string | null;
  assistantCount: number;
  models: Array<{ provider: string; model: string }>;
  tokens: number;
  cost: number;
}

/**
 * Fork-aware analysis of a session file. When `depth` allows, entries whose
 * ids exist in the parent session are removed — a fork note never duplicates
 * the parent conversation (see ADR 0002).
 */
async function openSegment(file: string, depth = MAX_PARENT_DEPTH): Promise<SegmentInfo> {
  const sm = await SessionManager.open(file);
  const header = sm.getHeader() as HeaderLike;
  let segment = sm.getBranch();
  let parentFile: string | null = header?.parentSession ?? null;
  let parentReadable = false;

  if (parentFile && depth > 0) {
    try {
      const parent = await SessionManager.open(parentFile);
      const parentIds = new Set(parent.getEntries().map((e) => e.id));
      segment = segment.filter((e) => !parentIds.has(e.id));
      parentReadable = true;
    } catch {
      parentReadable = false;
    }
    if (segment.length === 0) {
      // Parent unreadable and nothing left — give up on the diff, export as-is.
      if (!parentReadable) {
        segment = sm.getBranch();
      }
    }
  }

  const info: SegmentInfo = {
    header,
    parentFile,
    parentReadable,
    segment,
    firstMessageIso: null,
    firstUserText: null,
    sessionName: null,
    assistantCount: 0,
    models: [],
    tokens: 0,
    cost: 0,
  };

  const modelKeys = new Map<string, { provider: string; model: string }>();

  for (const entry of segment) {
    if (entry.type === "session") continue;

    if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim()) {
      info.sessionName = entry.name.trim();
      continue;
    }
    if (entry.type !== "message") continue;

    const msg = entry.message as any;
    if (!msg || typeof msg !== "object") continue;
    const ts = entry.timestamp;

    if (info.firstMessageIso === null) {
      info.firstMessageIso = new Date(ts).toISOString();
    }

    if (msg.role === "user") {
      const text = extractText(msg.content).join("\n");
      if (info.firstUserText === null && text.trim()) info.firstUserText = text;
    } else if (msg.role === "assistant") {
      info.assistantCount += 1;
      if (msg.provider && msg.model) {
        const key = `${msg.provider}/${msg.model}`;
        if (!modelKeys.has(key)) modelKeys.set(key, { provider: msg.provider, model: msg.model });
      }
      info.tokens += msg.usage?.totalTokens ?? 0;
      info.cost += msg.usage?.cost?.total ?? 0;
    } else if (msg.role === "toolResult") {
      info.tokens += msg.usage?.totalTokens ?? 0;
      info.cost += msg.usage?.cost?.total ?? 0;
    }

    if (entry.type === "compaction" || entry.type === "branch_summary") {
      const u = (entry as any).usage;
      if (u) {
        info.tokens += u.totalTokens ?? 0;
        info.cost += u.cost?.total ?? 0;
      }
    }
  }

  info.models = [...modelKeys.values()];
  return info;
}

/* ------------------------------------------------------------------ */
/* Note rendering                                                      */
/* ------------------------------------------------------------------ */

function yamlQuote(value: string): string {
  if (
    value === "" ||
    /[:#\[\]{},&*!|>'"%@`]|^\s|[-?]\s|:\s|\n|\t/.test(value)
  ) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** Renders segment entries to Markdown. Writes image assets on the way. */
async function renderBody(segment: any[], assetsDir: string, assetsName: string): Promise<string> {
  const out: string[] = [];
  const pendingTools = new Map<string, { name: string; argsText: string }>();
  const writtenAssets = new Map<string, string>(); // data-hash -> filename (dedupe)

  for (const entry of segment) {
    if (entry.type !== "message") continue;
    const msg = entry.message as any;
    if (!msg || typeof msg !== "object") continue;
    const clock = entry.timestamp ? ` — ${formatClock(entry.timestamp)}` : "";
    const role = msg.role;

    // --- User ---------------------------------------------------------
    if (role === "user") {
      const { text, images } = await renderParts(
        msg.content,
        entry.id,
        writtenAssets,
        assetsDir,
        assetsName,
      );
      const lines = [...images];
      if (text.trim()) lines.push(text.trim());
      if (lines.some((l) => l.trim())) {
        out.push(`## 🧑 You${clock}`, ...lines);
      }
      continue;
    }

    // --- Assistant -----------------------------------------------------
    if (role === "assistant") {
      const { text, images } = await renderParts(
        msg.content,
        entry.id,
        writtenAssets,
        assetsDir,
        assetsName,
      );
      const textParts = text
        .split("\n\n")
        .map((p) => p.trim())
        .filter((p) => p.length);
      if (images.length || text.trim()) {
        out.push(`## 🤖 Assistant${clock}`, ...images, ...textParts.map((t) => t.trimEnd()));
      }
      for (const block of msg.content ?? []) {
        if (!block || typeof block !== "object") continue;
        const b = block as { type?: string };
        if (b.type === "toolCall") {
          pendingTools.set(
            (b as { id: string }).id,
            {
              name: (b as { name: string }).name,
              argsText: formatArgs((b as { arguments?: Record<string, unknown> }).arguments),
            },
          );
        }
      }
      continue;
    }

    // --- Tool result ----------------------------------------------------
    if (role === "toolResult") {
      const call = pendingTools.get(msg.toolCallId);
      pendingTools.delete(msg.toolCallId);
      const name = call?.name ?? msg.toolName ?? "tool";
      const argsLine = call?.argsText ?? "";
      const status = msg.isError ? " ⚠️" : "";
      const exitCode =
        msg.details && typeof msg.details.exitCode === "number"
          ? ` — exit ${msg.details.exitCode}`
          : "";
      out.push(`> 🔧 **${name}**${status}${exitCode}${argsLine ? " · " + argsLine : ""}`);
      const { text, images } = await renderParts(
        msg.content,
        entry.id,
        writtenAssets,
        assetsDir,
        assetsName,
      );
      const lines = [...images, truncateText(text, OUTPUT_CAP)];
      if (lines.some((l) => l.trim())) {
        out.push(">", ...lines.join("\n\n").split("\n").map((l) => (l ? `> ${l}` : ">")));
      }
      out.push("");
      continue;
    }

    // --- Shell commands run by the user (! / !!) -------------------------
    if (role === "bashExecution") {
      const exit = typeof msg.exitCode === "number" ? ` — exit ${msg.exitCode}` : "";
      out.push(`## 🧑 You (shell)${clock}${exit}`, ">", `> \`! ${truncateText(msg.command ?? "", 200).replace(/\n/g, " ")}\``);
      if (msg.output) {
        const capped = truncateText(msg.output, OUTPUT_CAP);
        out.push(">", ...capped.split("\n").map((l) => (l ? `> ${l}` : ">")));
      }
      out.push("");
      continue;
    }

    // --- Custom (extension-injected) messages ---------------------------
    if (role === "custom" && msg.display !== false) {
      const text = extractText(msg.content).join("\n").trim();
      if (text) out.push("> 📌", ...text.split("\n").map((l) => (l ? `> ${l}` : ">")));
      continue;
    }
  }

  // Compaction & branch summaries (non-message entries).
  for (const entry of segment) {
    if (entry.type === "compaction") {
      const summary = truncateText(String(entry.summary ?? "").trim(), SUMMARY_CAP);
      if (summary) out.push("> 📦 _Compacted:_", ...summary.split("\n").map((l) => `> ${l}`));
    } else if (entry.type === "branch_summary") {
      const summary = truncateText(String(entry.summary ?? "").trim(), SUMMARY_CAP);
      if (summary) out.push("> 🔀 _Abandoned branch:_", ...summary.split("\n").map((l) => `> ${l}`));
    } else if (entry.type === "model_change") {
      out.push(`---\n*— switched to ${entry.provider}/${entry.modelId} —*`);
    }
  }

  return out.join("\n\n").trim() + "\n";
}

function formatArgs(args: Record<string, unknown> | undefined): string {
  if (!args || typeof args !== "object") return "";
  if (typeof (args as Record<string, unknown>).command === "string") {
    return `\`${truncateText(String((args as Record<string, unknown>).command), 200).replace(/\n/g, " ")}\``;
  }
  let json: string;
  try {
    json = JSON.stringify(args);
  } catch {
    json = String(args);
  }
  if (json.length > ARGS_CAP) json = `${json.slice(0, ARGS_CAP)}…`;
  return `\`${json}\``;
}

/** Renders text + image embeds for a content payload (user/assistant/toolResult). */
async function renderParts(
  content: unknown,
  entryId: string,
  writtenAssets: Map<string, string>,
  assetsDir: string,
  assetsName: string,
): Promise<{ text: string; images: string[] }> {
  const images: string[] = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: string; data?: string; mimeType?: string };
      if (b.type === "image" && typeof b.data === "string") {
        const link = await writeAsset(
          b.data,
          b.mimeType ?? "image/png",
          entryId,
          writtenAssets,
          assetsDir,
          assetsName,
        );
        images.push(`![[${link}]]`);
      }
    }
  }
  return { text: extractText(content).join("\n"), images };
}

/** Writes a base64 image asset once (deduped by data hash). Returns Obsidian link name. */
async function writeAsset(
  data: string,
  mimeType: string,
  entryId: string,
  writtenAssets: Map<string, string>,
  assetsDir: string,
  assetsName: string,
): Promise<string> {
  const hash = hashString(data);
  const existing = writtenAssets.get(hash);
  if (existing) return existing;
  const file = `${sanitizeFilename(entryId) || "img"}-${writtenAssets.size + 1}.${mimeToExt(mimeType)}`;
  const abs = join(assetsDir, file);
  if (!(await exists(abs))) {
    await writeFile(abs, Buffer.from(data, "base64"));
  }
  const link = `${assetsName}/${file}`;
  writtenAssets.set(hash, link);
  return link;
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return `${h >>> 0}`;
}

/* ------------------------------------------------------------------ */
/* Title / note name                                                   */
/* ------------------------------------------------------------------ */

function deriveTitle(info: SegmentInfo, override: string | null): string {
  if (override && override.trim()) return titleFromText(override.trim()) ?? "Untitled";
  if (info.sessionName) return titleFromText(info.sessionName) ?? "Untitled";
  if (info.firstUserText) return titleFromText(info.firstUserText) ?? "Untitled";
  return "Untitled";
}

function ymdOf(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : null;
}

/** Resolve the parent conversation note name (filename without .md), or null. */
async function resolveParentNoteName(
  parentFile: string,
  state: ExportState,
  exportDir: string,
): Promise<string | null> {
  // 1) Exact path from the registry.
  const rec = state.sessions[parentFile];
  if (rec && (await exists(rec.notePath))) {
    return basename(rec.notePath, ".md");
  }
  // 2) Canonical filename computed from the parent session contents.
  try {
    const parentInfo = await openSegment(parentFile);
    const parentTitle = deriveTitle(parentInfo, null);
    const ymd = ymdOf(parentInfo.firstMessageIso);
    if (!ymd) return null;
    const base = sanitizeFilename(`${ymd} - ${parentTitle}`);
    const entries = await safeReaddir(exportDir);
    const matches = entries.filter((f) => f.startsWith(`${base}.`) || f.startsWith(`${base} `));
    if (matches.length > 0) return basename(matches.sort().at(-1)!, ".md");
    return base;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

interface ExportResult {
  wrote: boolean;
  reason: "wrote" | "no-assistant-turns" | "up-to-date" | "user-edited" | "ephemeral" | "error";
  notePath?: string;
}

async function exportConversation(
  sessionManager: { getSessionFile(): string | undefined; getBranch(): any[]; getLeafId(): string | null },
  opts: { manual: boolean; titleOverride?: string },
): Promise<ExportResult> {
  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) {
    debugLog("skip: ephemeral session");
    return { wrote: false, reason: "ephemeral" };
  }

  // A session file with no message entries (e.g. a /new quit before any
  // exchange) has nothing to export — skip quietly without touching state.
  if (!(await sessionHasMessages(sessionFile))) {
    debugLog("skip: no message entries", sessionFile);
    return { wrote: false, reason: "no-assistant-turns" };
  }

  const state = await loadState();
  const config = getConfig();

  let info: SegmentInfo;
  try {
    // Prefer reading the live session through the same logic used for parents.
    info = await openSegment(sessionFile);
  } catch (err) {
    console.error("[obsidian-export] failed to analyze session:", err);
    return { wrote: false, reason: "error" };
  }

  if (info.assistantCount === 0) {
    debugLog("skip: no assistant turns", sessionFile);
    if (opts.manual) console.log("[obsidian-export] skipping: no assistant turns");
    return { wrote: false, reason: "no-assistant-turns" };
  }

  const title = deriveTitle(info, opts.titleOverride);
  const ymd = ymdOf(info.firstMessageIso);
  if (!ymd) {
    debugLog("skip: no dated messages", sessionFile);
    if (opts.manual) console.log("[obsidian-export] skipping: no dated messages");
    return { wrote: false, reason: "no-assistant-turns" };
  }

  const rec = state.sessions[sessionFile];
  let notePath: string;

  if (rec && (await exists(rec.notePath))) {
    const mtimeMs = (await stat(rec.notePath)).mtimeMs;
    if (mtimeMs !== rec.noteMtime) {
      if (opts.manual) console.log("[obsidian-export] note was edited manually; not overwriting");
      return { wrote: false, reason: "user-edited" };
    }
    if (rec.lastExportedEntryId === sessionManager.getLeafId() && !opts.titleOverride) {
      if (opts.manual) console.log("[obsidian-export] already up to date");
      return { wrote: false, reason: "up-to-date" };
    }
    notePath = opts.titleOverride
      ? await uniqueNotePath(config.exportDir, sanitizeFilename(`${ymd} - ${title}`))
      : rec.notePath;
  } else {
    notePath = await uniqueNotePath(config.exportDir, sanitizeFilename(`${ymd} - ${title}`));
  }

  // Continuation link for forks.
  let body = "";
  if (info.parentFile && info.parentReadable) {
    const parentNote = await resolveParentNoteName(info.parentFile, state, config.exportDir);
    if (parentNote) {
      body = `> Continues [[${parentNote}|${title.replaceAll("|", "")}]]\n\n`;
    }
  }

  await mkdir(config.assetsDir, { recursive: true });
  body += await renderBody(info.segment, config.assetsDir, config.assetsName);

  const frontmatter = [
    "---",
    `title: ${yamlQuote(title)}`,
    `date: ${info.firstMessageIso}`,
    info.models.length
      ? `models:\n${info.models.map((m) => `  - provider: ${yamlQuote(m.provider)}\n    model: ${yamlQuote(m.model)}`).join("\n")}`
      : "models: []",
    `tokens: ${info.tokens}`,
    `cost_total: ${Math.round(info.cost * 1e6) / 1e6}`,
    "---",
    "",
  ].join("\n");

  const note = `${frontmatter}${body}`;

  try {
    await mkdir(config.exportDir, { recursive: true });
    const tmp = `${notePath}.tmp-${process.pid}`;
    await writeFile(tmp, note, "utf8");
    await rename(tmp, notePath);
  } catch (err) {
    console.error("[obsidian-export] failed to write note:", err);
    return { wrote: false, reason: "error" };
  }

  state.sessions[sessionFile] = {
    lastExportedEntryId: sessionManager.getLeafId(),
    notePath,
    noteMtime: (await stat(notePath)).mtimeMs,
  };
  await saveState(state);

  if (opts.manual) console.log(`[obsidian-export] wrote ${notePath}`);
  return { wrote: true, reason: "wrote", notePath };
}

/* ------------------------------------------------------------------ */
/* Extension wiring                                                    */
/* ------------------------------------------------------------------ */

export default function (pi: ExtensionAPI) {
  // Automatic export whenever a conversation ends.
  pi.on("session_shutdown", async (event, ctx) => {
    if (!AUTO_REASONS.has(event.reason)) return; // skip "reload"
    try {
      await exportConversation(ctx.sessionManager, { manual: false });
    } catch (err) {
      console.error("[obsidian-export] auto-export failed:", err);
    }
  });

  // Manual export, optionally with a title override.
  pi.registerCommand("export-obsidian", {
    description: "Export the current conversation to the Obsidian vault as a Markdown note (/export-obsidian \"Title\")",
    handler: async (args, ctx) => {
      const titleOverride = args?.trim() || null;
      const result = await exportConversation(ctx.sessionManager, {
        manual: true,
        titleOverride,
      });
      if (!ctx.hasUI) return;
      if (result.reason === "wrote" && result.notePath) {
        ctx.ui.notify(`Exported: ${result.notePath}`, "info");
      } else if (result.reason === "user-edited") {
        ctx.ui.notify("Note was edited manually — not overwriting", "warning");
      } else if (result.reason === "up-to-date") {
        ctx.ui.notify("Conversation already up to date", "info");
      } else if (result.reason === "no-assistant-turns") {
        ctx.ui.notify("Nothing to export (no assistant turns)", "warning");
      } else if (result.reason === "error") {
        ctx.ui.notify("Export failed — see logs", "error");
      }
    },
  });
}
