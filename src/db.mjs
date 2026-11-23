// Durable local persistence (SQLite via node:sqlite). One canonical event document per event,
// with optimistic version checks, plus append-only messages, outbox and idempotency records.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class ConflictError extends Error {
  constructor(msg) { super(msg); this.name = "ConflictError"; this.status = 409; }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, version INTEGER NOT NULL, doc TEXT NOT NULL);
-- Every message in the (simulated or real) email world: human mail, ccPlannie mail, supplier mail.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,               -- internal id M-n
  message_id TEXT UNIQUE,            -- RFC 5322 Message-ID (dedupe key)
  direction TEXT NOT NULL,           -- 'human' | 'plannie' | 'supplier'
  event_id TEXT, thread_id TEXT,
  from_addr TEXT NOT NULL, to_addrs TEXT NOT NULL, cc_addrs TEXT NOT NULL,
  subject TEXT, body TEXT, html TEXT,
  in_reply_to TEXT, refs TEXT,
  at TEXT NOT NULL,
  seen_by_plannie INTEGER NOT NULL DEFAULT 0,
  identity TEXT, interpretation TEXT, interp_source TEXT,
  meta TEXT, attachments TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, event_id TEXT, kind TEXT NOT NULL, supplier_id TEXT, subject TEXT);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, dedupe_key TEXT UNIQUE NOT NULL, message_id TEXT NOT NULL,
  status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
  created_at TEXT NOT NULL, sent_at TEXT, provider_id TEXT
);
CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, result TEXT, at TEXT NOT NULL);
-- Company configuration (org chart + policy). One versioned row. Configuration, not demo state:
-- demo reset never touches this table or the company audit log.
CREATE TABLE IF NOT EXISTS company_config (
  id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, source TEXT NOT NULL,
  doc TEXT NOT NULL, updated_at TEXT, updated_by TEXT
);
-- Admin console sessions (company server). Only a SHA-256 of the session token is stored.
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
-- Application activity/audit log for company administration (not tamper-proof).
CREATE TABLE IF NOT EXISTS company_audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, entity TEXT NOT NULL, before TEXT, after TEXT, details TEXT,
  config_version INTEGER, event_id TEXT, event_created_at TEXT
);
`;

export function openDb(path = process.env.PLANNIE_DB || "data/ccplannie.sqlite") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  db.exec(SCHEMA);
  return new Store(db, path);
}

const J = (v) => (v == null ? null : JSON.stringify(v));
const P = (s) => (s == null ? null : JSON.parse(s));

class Store {
  constructor(db, path) { this.db = db; this.path = path; this.depth = 0; }

  close() { this.db.close(); }

  // Run fn inside one transaction (nested calls join the outer one).
  tx(fn) {
    if (this.depth > 0) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth++;
    try {
      const r = fn();
      this.depth--;
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.depth--;
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // ---- meta / counters / clock
  getMeta(key, dflt = null) { const r = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key); return r ? P(r.value) : dflt; }
  // null/undefined removes the key (the column is NOT NULL).
  setMeta(key, value) {
    if (value == null) { this.db.prepare("DELETE FROM meta WHERE key=?").run(key); return; }
    this.db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, J(value));
  }
  nextId(prefix) {
    const n = (this.getMeta("seq:" + prefix, 0) || 0) + 1;
    this.setMeta("seq:" + prefix, n);
    return `${prefix}-${n}`;
  }

  // ---- events
  getEvent(id) { const r = this.db.prepare("SELECT version, doc FROM events WHERE id=?").get(id); return r ? { ...P(r.doc), version: r.version } : null; }
  listEvents() { return this.db.prepare("SELECT id FROM events ORDER BY id").all().map((r) => this.getEvent(r.id)); }
  insertEvent(ev) { this.db.prepare("INSERT INTO events(id,version,doc) VALUES(?,?,?)").run(ev.id, 1, J({ ...ev, version: undefined })); ev.version = 1; return ev; }
  // Optimistic write: fails if someone else wrote a newer version first.
  saveEvent(ev, expectedVersion) {
    const r = this.db.prepare("UPDATE events SET version=version+1, doc=? WHERE id=? AND version=?").run(J({ ...ev, version: undefined }), ev.id, expectedVersion);
    if (r.changes !== 1) throw new ConflictError(`Event ${ev.id} changed since version ${expectedVersion}; reload and retry.`);
    ev.version = expectedVersion + 1;
    return ev;
  }

  // ---- messages
  insertMessage(m) {
    this.db.prepare(`INSERT INTO messages(id,message_id,direction,event_id,thread_id,from_addr,to_addrs,cc_addrs,subject,body,html,in_reply_to,refs,at,seen_by_plannie,identity,interpretation,interp_source,meta,attachments,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      m.id, m.messageId, m.direction, m.eventId ?? null, m.threadId ?? null, m.from, J(m.to || []), J(m.cc || []), m.subject ?? "", m.body ?? "", m.html ?? null,
      m.inReplyTo ?? null, J(m.references || []), m.at, m.seenByPlannie ? 1 : 0, J(m.identity), J(m.interpretation), m.interpSource ?? null, J(m.meta || {}), J(m.attachments || []), J(m.notes || []));
    return m;
  }
  updateMessage(id, patch) {
    const cols = { eventId: "event_id", threadId: "thread_id", identity: "identity", interpretation: "interpretation", interpSource: "interp_source", meta: "meta", notes: "notes", seenByPlannie: "seen_by_plannie" };
    for (const [k, v] of Object.entries(patch)) {
      const c = cols[k]; if (!c) throw new Error("bad column " + k);
      const val = ["identity", "interpretation", "meta", "notes"].includes(k) ? J(v) : k === "seenByPlannie" ? (v ? 1 : 0) : v;
      this.db.prepare(`UPDATE messages SET ${c}=? WHERE id=?`).run(val, id);
    }
  }
  rowToMsg(r) {
    return r && {
      id: r.id, messageId: r.message_id, direction: r.direction, eventId: r.event_id, threadId: r.thread_id, from: r.from_addr,
      to: P(r.to_addrs), cc: P(r.cc_addrs), subject: r.subject, body: r.body, html: r.html, inReplyTo: r.in_reply_to, references: P(r.refs),
      at: r.at, seenByPlannie: !!r.seen_by_plannie, identity: P(r.identity), interpretation: P(r.interpretation), interpSource: r.interp_source,
      meta: P(r.meta), attachments: P(r.attachments), notes: P(r.notes),
    };
  }
  getMessage(id) { return this.rowToMsg(this.db.prepare("SELECT * FROM messages WHERE id=?").get(id)); }
  getByMessageId(mid) { return this.rowToMsg(this.db.prepare("SELECT * FROM messages WHERE message_id=?").get(mid)); }
  // A reference from someone's reply: Plannie's own Message-ID, or the ID a mail provider gave the copy it
  // actually sent (recorded as the outbox provider_id). Angle brackets are optional on either side.
  getByRef(ref) {
    if (!ref) return null;
    const bare = String(ref).trim().replace(/^<|>$/g, "");
    for (const id of [`<${bare}>`, bare]) {
      const m = this.getByMessageId(id);
      if (m) return m;
      const o = this.db.prepare("SELECT message_id FROM outbox WHERE provider_id=? LIMIT 1").get(id);
      if (o) return this.getMessage(o.message_id); // outbox.message_id is ccPlannie's internal message id
    }
    return null;
  }
  listMessages(where = "1=1", ...args) { return this.db.prepare(`SELECT * FROM messages WHERE ${where} ORDER BY at, rowid`).all(...args).map((r) => this.rowToMsg(r)); }

  // ---- threads
  upsertThread(t) { this.db.prepare("INSERT INTO threads(id,event_id,kind,supplier_id,subject) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING").run(t.id, t.eventId ?? null, t.kind, t.supplierId ?? null, t.subject ?? ""); return t; }
  listThreads(eventId) { return this.db.prepare("SELECT * FROM threads WHERE event_id=? ORDER BY rowid").all(eventId).map((r) => ({ id: r.id, eventId: r.event_id, kind: r.kind, supplierId: r.supplier_id, subject: r.subject })); }
  findThread(eventId, kind, supplierId = null) {
    const r = this.db.prepare("SELECT * FROM threads WHERE event_id=? AND kind=? AND IFNULL(supplier_id,'')=IFNULL(?, '')").get(eventId, kind, supplierId);
    return r && { id: r.id, eventId: r.event_id, kind: r.kind, supplierId: r.supplier_id, subject: r.subject };
  }

  // ---- outbox (durable pending sends)
  enqueue({ dedupeKey, messageId, at }) {
    const existing = this.db.prepare("SELECT id FROM outbox WHERE dedupe_key=?").get(dedupeKey);
    if (existing) return { duplicate: true, id: existing.id };
    const id = this.nextId("O");
    this.db.prepare("INSERT INTO outbox(id,dedupe_key,message_id,status,created_at) VALUES(?,?,?,?,?)").run(id, dedupeKey, messageId, "queued", at);
    return { duplicate: false, id };
  }
  outbox(status = null) {
    const rows = status ? this.db.prepare("SELECT * FROM outbox WHERE status=? ORDER BY rowid").all(status) : this.db.prepare("SELECT * FROM outbox ORDER BY rowid").all();
    return rows.map((r) => ({ id: r.id, dedupeKey: r.dedupe_key, messageId: r.message_id, status: r.status, attempts: r.attempts, error: r.error, createdAt: r.created_at, sentAt: r.sent_at, providerId: r.provider_id }));
  }
  markOutbox(id, { status, error = null, sentAt = null, providerId = null }) {
    this.db.prepare("UPDATE outbox SET status=?, attempts=attempts+1, error=?, sent_at=?, provider_id=? WHERE id=?").run(status, error, sentAt, providerId, id);
  }

  // ---- idempotency for business actions
  seen(key) { const r = this.db.prepare("SELECT result FROM idempotency WHERE key=?").get(key); return r ? { result: P(r.result) } : null; }
  remember(key, result, at) { this.db.prepare("INSERT OR IGNORE INTO idempotency(key,result,at) VALUES(?,?,?)").run(key, J(result), at); }

  // ---- company configuration (versioned) and company audit log
  getConfig() { const r = this.db.prepare("SELECT * FROM company_config WHERE id=1").get(); return r ? { version: r.version, source: r.source, doc: P(r.doc), updatedAt: r.updated_at, updatedBy: r.updated_by } : null; }
  // Optimistic write: fails if the stored version isn't the one the caller loaded.
  saveConfig({ doc, source, updatedAt, updatedBy }, expectedVersion) {
    const cur = this.getConfig();
    if (!cur) {
      if (expectedVersion != null && expectedVersion !== 0) throw new ConflictError("No saved configuration yet; reload.");
      this.db.prepare("INSERT INTO company_config(id,version,source,doc,updated_at,updated_by) VALUES(1,1,?,?,?,?)").run(source, J(doc), updatedAt, updatedBy);
      return 1;
    }
    const r = this.db.prepare("UPDATE company_config SET version=version+1, source=?, doc=?, updated_at=?, updated_by=? WHERE id=1 AND version=?").run(source, J(doc), updatedAt, updatedBy, expectedVersion);
    if (r.changes !== 1) throw new ConflictError(`Company configuration changed (now v${cur.version}) since you loaded v${expectedVersion}. Reload to see the newer settings.`);
    return expectedVersion + 1;
  }
  insertAudit(e) {
    const seq = (this.db.prepare("SELECT IFNULL(MAX(seq),0)+1 AS n FROM company_audit").get().n);
    const id = `ACT-${String(seq).padStart(5, "0")}`;
    this.db.prepare("INSERT INTO company_audit(id,at,actor,action,entity,before,after,details,config_version,event_id,event_created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      // A demo runs on its own clock; record activity on that clock so the dashboard and the story agree.
      .run(id, this.getMeta("clock") || e.at, e.actor, e.action, e.entity, J(e.before ?? null), J(e.after ?? null), J(e.details ?? null), e.configVersion ?? null, e.eventId ?? null, e.eventCreatedAt ?? null);
    return id;
  }
  listAudit({ limit = 500, actions = [] } = {}) {
    const filter = actions.length ? ` WHERE action IN (${actions.map(() => "?").join(",")})` : "";
    return this.db.prepare(`SELECT * FROM company_audit${filter} ORDER BY seq DESC LIMIT ?`).all(...actions, limit).map((r) => ({
      id: r.id, at: r.at, actor: r.actor, action: r.action, entity: r.entity, before: P(r.before), after: P(r.after), details: P(r.details),
      configVersion: r.config_version, eventId: r.event_id, eventCreatedAt: r.event_created_at,
    }));
  }
  createSession(tokenHash, createdAt, expiresAt) { this.db.prepare("INSERT INTO admin_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)").run(tokenHash, createdAt, expiresAt); }
  getSession(tokenHash, now) { return this.db.prepare("SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at>?").get(tokenHash, now) || null; }
  deleteSession(tokenHash) { this.db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").run(tokenHash); }
  purgeSessions(now) { this.db.prepare("DELETE FROM admin_sessions WHERE expires_at<=?").run(now); }
  requeueOutbox(id) {
    const r = this.db.prepare("UPDATE outbox SET status='queued', error=NULL WHERE id=? AND status IN ('failed','held-not-allowlisted')").run(id);
    return r.changes === 1;
  }

  // Demo reset: clears demo state only. Company configuration and the company audit log survive.
  reset() { this.db.exec("DELETE FROM meta; DELETE FROM events; DELETE FROM messages; DELETE FROM threads; DELETE FROM outbox; DELETE FROM idempotency;"); }
  // Demo only: switching demo scenarios starts the activity log fresh. A real company's log is never cleared.
  clearAudit() { this.db.exec("DELETE FROM company_audit;"); }
  // Demo stepping back: drop request-related activity (it is recorded again as the story replays).
  clearRequestAudit() { this.db.exec("DELETE FROM company_audit WHERE event_id IS NOT NULL;"); }
  clearDemoRuleAudit() { this.db.exec("DELETE FROM company_audit WHERE actor = 'demo script' AND action IN ('policy.saved', 'policy.changed');"); }
  // Demo only: a freshly loaded scenario starts its configuration history at v1, like a new workspace.
  restartConfigVersion() { this.db.exec("UPDATE company_config SET version=1 WHERE id=1;"); }
}
