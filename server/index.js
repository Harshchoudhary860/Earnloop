import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DAILY_CAP = 15;            // max completions per user per 24h
const MIN_WITHDRAW = 10000;      // paise (₹100)
const rupeesToPaise = (v) => Math.round(Number(v) * 100);

export const app = express();
app.use(cors());
app.use(express.json());

const fail = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };
const wrap = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'You already completed this offer.' });
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
};
const auth = (roles) => (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { id } = jwt.verify(token, SECRET);
    const u = db.prepare('SELECT id, username, role, balance_paise FROM users WHERE id = ?').get(id);
    if (!u) throw new Error('no user');
    if (roles && !roles.includes(u.role)) return res.status(403).json({ error: 'Not allowed.' });
    req.user = u; next();
  } catch { res.status(401).json({ error: 'Please log in.' }); }
};
const sign = (id) => jwt.sign({ id }, SECRET, { expiresIn: '7d' });

// Seed an admin account on first run. Change these with env vars.
const adminName = process.env.ADMIN_USER || 'admin';
if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(adminName)) {
  db.prepare("INSERT INTO users (username, pass_hash, role) VALUES (?, ?, 'admin')")
    .run(adminName, bcrypt.hashSync(process.env.ADMIN_PASS || 'admin123', 10));
}

/* ---------- auth ---------- */
app.post('/api/auth/register', wrap((req, res) => {
  const { username, password, role } = req.body || {};
  if (!/^[a-z0-9_]{3,30}$/i.test(username || '')) fail(400, 'Username needs 3-30 letters, numbers or underscores.');
  if ((password || '').length < 6) fail(400, 'Password needs at least 6 characters.');
  if (!['user', 'advertiser'].includes(role)) fail(400, 'Choose whether you earn or run a shop.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is taken.');
  const id = db.prepare('INSERT INTO users (username, pass_hash, role) VALUES (?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 10), role).lastInsertRowid;
  res.json({ token: sign(Number(id)) });
}));

app.post('/api/auth/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!u || !bcrypt.compareSync(password || '', u.pass_hash)) fail(401, 'Wrong username or password.');
  res.json({ token: sign(u.id) });
}));

app.get('/api/me', auth(), wrap((req, res) => res.json(req.user)));

/* ---------- user: earn ---------- */
app.get('/api/campaigns', auth(['user']), wrap((req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.type, c.title, c.description, c.link, c.questions, c.min_seconds,
           c.payout_paise, c.share_pct, a.username AS shop
    FROM campaigns c JOIN users a ON a.id = c.advertiser_id
    WHERE c.status = 'active'
      AND a.balance_paise >= c.payout_paise
      AND NOT EXISTS (SELECT 1 FROM completions x WHERE x.user_id = ? AND x.campaign_id = c.id)
      AND (SELECT COUNT(*) FROM completions y WHERE y.campaign_id = c.id) < c.max_completions
    ORDER BY c.payout_paise DESC`).all(req.user.id);
  res.json(rows.map((c) => ({
    ...c, questions: JSON.parse(c.questions),
    reward_paise: Math.floor((c.payout_paise * c.share_pct) / 100),
  })));
}));

app.post('/api/campaigns/:id/start', auth(['user']), wrap((req, res) => {
  const c = db.prepare("SELECT id, min_seconds FROM campaigns WHERE id = ? AND status = 'active'").get(req.params.id);
  if (!c) fail(404, 'Offer not available.');
  db.prepare('INSERT OR REPLACE INTO starts (user_id, campaign_id, started_at) VALUES (?, ?, ?)')
    .run(req.user.id, c.id, Date.now());
  res.json({ min_seconds: c.min_seconds });
}));

app.post('/api/campaigns/:id/complete', auth(['user']), wrap((req, res) => {
  const c = db.prepare("SELECT * FROM campaigns WHERE id = ? AND status = 'active'").get(req.params.id);
  if (!c) fail(404, 'Offer not available.');
  const s = db.prepare('SELECT started_at FROM starts WHERE user_id = ? AND campaign_id = ?').get(req.user.id, c.id);
  if (!s) fail(400, 'Start the offer first.');
  if (Date.now() - s.started_at < c.min_seconds * 1000) fail(400, 'Too fast. Spend the full time on this offer.');
  const qs = JSON.parse(c.questions);
  const answers = (req.body && req.body.answers) || [];
  if (qs.length && (answers.length !== qs.length || answers.some((a) => !String(a).trim()))) fail(400, 'Answer every question.');
  const today = db.prepare('SELECT COUNT(*) n FROM completions WHERE user_id = ? AND created_at > ?')
    .get(req.user.id, Date.now() - 86400000).n;
  if (today >= DAILY_CAP) fail(429, `Daily limit of ${DAILY_CAP} offers reached.`);

  const reward = db.transaction(() => {
    const shop = db.prepare('SELECT balance_paise FROM users WHERE id = ?').get(c.advertiser_id);
    const n = db.prepare('SELECT COUNT(*) n FROM completions WHERE campaign_id = ?').get(c.id).n;
    if (n >= c.max_completions || shop.balance_paise < c.payout_paise) {
      db.prepare("UPDATE campaigns SET status = 'exhausted' WHERE id = ?").run(c.id);
      return null;
    }
    const r = Math.floor((c.payout_paise * c.share_pct) / 100);
    db.prepare('INSERT INTO completions (user_id, campaign_id, answers, adv_paise, user_paise, created_at) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, c.id, JSON.stringify(answers), c.payout_paise, r, Date.now());
    db.prepare('UPDATE users SET balance_paise = balance_paise - ? WHERE id = ?').run(c.payout_paise, c.advertiser_id);
    db.prepare('UPDATE users SET balance_paise = balance_paise + ? WHERE id = ?').run(r, req.user.id);
    if (n + 1 >= c.max_completions) db.prepare("UPDATE campaigns SET status = 'exhausted' WHERE id = ?").run(c.id);
    return r;
  })();
  if (reward === null) fail(410, 'This offer just ended.');
  res.json({ reward_paise: reward });
}));

app.get('/api/history', auth(['user']), wrap((req, res) => {
  const earned = db.prepare(`SELECT 'earn' kind, c.title label, x.user_paise amount_paise, x.created_at
    FROM completions x JOIN campaigns c ON c.id = x.campaign_id WHERE x.user_id = ?`).all(req.user.id);
  const wd = db.prepare(`SELECT 'withdraw' kind, 'Withdrawal to ' || upi || ' (' || status || ')' label,
    -amount_paise amount_paise, created_at FROM withdrawals WHERE user_id = ?`).all(req.user.id);
  res.json([...earned, ...wd].sort((a, b) => b.created_at - a.created_at));
}));

app.post('/api/withdrawals', auth(['user']), wrap((req, res) => {
  const { upi } = req.body || {};
  if (!/^[\w.-]{2,}@[a-z]{2,}$/i.test(upi || '')) fail(400, 'Enter a valid UPI ID, like name@bank.');
  const bal = req.user.balance_paise;
  if (bal < MIN_WITHDRAW) fail(400, `Minimum withdrawal is ₹${MIN_WITHDRAW / 100}.`);
  db.transaction(() => {
    db.prepare('UPDATE users SET balance_paise = 0 WHERE id = ?').run(req.user.id);
    db.prepare('INSERT INTO withdrawals (user_id, upi, amount_paise, created_at) VALUES (?,?,?,?)')
      .run(req.user.id, upi, bal, Date.now());
  })();
  res.json({ ok: true });
}));

/* ---------- shop (advertiser) ---------- */
app.post('/api/shop/campaigns', auth(['advertiser']), wrap((req, res) => {
  const b = req.body || {};
  const type = b.type;
  if (!['ad', 'survey', 'offer'].includes(type)) fail(400, 'Pick ad, survey or offer.');
  const title = String(b.title || '').trim();
  if (title.length < 3 || title.length > 80) fail(400, 'Title needs 3-80 characters.');
  const description = String(b.description || '').slice(0, 300);
  const link = String(b.link || '').trim();
  if ((type === 'offer' || link) && !/^https?:\/\/\S+$/i.test(link)) fail(400, 'Enter a link starting with http:// or https://.');
  const questions = type === 'survey' ? (b.questions || []).map((q) => String(q).trim()).filter(Boolean).slice(0, 8) : [];
  if (type === 'survey' && !questions.length) fail(400, 'Add at least one survey question.');
  const payout = rupeesToPaise(b.payout);
  if (!(payout >= 100 && payout <= 50000)) fail(400, 'Payout per completion must be between ₹1 and ₹500.');
  const share = Number(b.share_pct);
  if (!(share >= 30 && share <= 80)) fail(400, 'User share must be between 30% and 80%.');
  const max = Math.floor(Number(b.max_completions));
  if (!(max >= 1 && max <= 100000)) fail(400, 'Max completions must be between 1 and 100000.');
  const minSec = Math.min(300, Math.max(5, Math.floor(Number(b.min_seconds) || 10)));
  const id = db.prepare(`INSERT INTO campaigns (advertiser_id, type, title, description, link, questions,
    payout_paise, share_pct, max_completions, min_seconds, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, type, title, description, link, JSON.stringify(questions), payout, share, max, minSec, Date.now()).lastInsertRowid;
  res.json({ id: Number(id), status: 'pending' });
}));

app.get('/api/shop/campaigns', auth(['advertiser']), wrap((req, res) => {
  res.json(db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM completions x WHERE x.campaign_id = c.id) AS completions,
      (SELECT COALESCE(SUM(adv_paise),0) FROM completions x WHERE x.campaign_id = c.id) AS spent_paise
    FROM campaigns c WHERE advertiser_id = ? ORDER BY c.id DESC`).all(req.user.id)
    .map((c) => ({ ...c, questions: JSON.parse(c.questions) })));
}));

app.post('/api/shop/campaigns/:id/toggle', auth(['advertiser']), wrap((req, res) => {
  const c = db.prepare('SELECT id, status FROM campaigns WHERE id = ? AND advertiser_id = ?').get(req.params.id, req.user.id);
  if (!c || !['active', 'paused'].includes(c.status)) fail(400, 'Only live or paused campaigns can be changed.');
  db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run(c.status === 'active' ? 'paused' : 'active', c.id);
  res.json({ ok: true });
}));

app.post('/api/shop/topups', auth(['advertiser']), wrap((req, res) => {
  const amount = rupeesToPaise(req.body && req.body.amount);
  const ref = String((req.body && req.body.ref) || '').trim();
  if (!(amount >= 10000)) fail(400, 'Minimum top-up is ₹100.');
  if (ref.length < 4) fail(400, 'Enter the UPI transaction reference of your payment.');
  db.prepare('INSERT INTO topups (advertiser_id, amount_paise, ref, created_at) VALUES (?,?,?,?)')
    .run(req.user.id, amount, ref, Date.now());
  res.json({ ok: true });
}));

app.get('/api/shop/topups', auth(['advertiser']), wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM topups WHERE advertiser_id = ? ORDER BY id DESC').all(req.user.id));
}));

/* ---------- admin ---------- */
app.get('/api/admin/overview', auth(['admin']), wrap((req, res) => {
  const t = db.prepare('SELECT COALESCE(SUM(adv_paise),0) adv, COALESCE(SUM(user_paise),0) usr, COUNT(*) n FROM completions').get();
  res.json({
    totals: { adv_paise: t.adv, user_paise: t.usr, margin_paise: t.adv - t.usr, completions: t.n },
    campaigns: db.prepare(`SELECT c.*, a.username shop FROM campaigns c JOIN users a ON a.id = c.advertiser_id
      WHERE c.status = 'pending' ORDER BY c.id`).all().map((c) => ({ ...c, questions: JSON.parse(c.questions) })),
    topups: db.prepare(`SELECT t.*, a.username shop FROM topups t JOIN users a ON a.id = t.advertiser_id
      WHERE t.status = 'pending' ORDER BY t.id`).all(),
    withdrawals: db.prepare(`SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id = w.user_id
      WHERE w.status = 'pending' ORDER BY w.id`).all(),
  });
}));

app.post('/api/admin/campaigns/:id/:action', auth(['admin']), wrap((req, res) => {
  const status = { approve: 'active', reject: 'rejected' }[req.params.action];
  if (!status) fail(400, 'Unknown action.');
  const r = db.prepare("UPDATE campaigns SET status = ? WHERE id = ? AND status = 'pending'").run(status, req.params.id);
  if (!r.changes) fail(404, 'No pending campaign with that id.');
  res.json({ ok: true });
}));

app.post('/api/admin/topups/:id/:action', auth(['admin']), wrap((req, res) => {
  const t = db.prepare("SELECT * FROM topups WHERE id = ? AND status = 'pending'").get(req.params.id);
  if (!t) fail(404, 'No pending top-up with that id.');
  if (req.params.action === 'approve') {
    db.transaction(() => {
      db.prepare("UPDATE topups SET status = 'approved' WHERE id = ?").run(t.id);
      db.prepare('UPDATE users SET balance_paise = balance_paise + ? WHERE id = ?').run(t.amount_paise, t.advertiser_id);
    })();
  } else if (req.params.action === 'reject') {
    db.prepare("UPDATE topups SET status = 'rejected' WHERE id = ?").run(t.id);
  } else fail(400, 'Unknown action.');
  res.json({ ok: true });
}));

app.post('/api/admin/withdrawals/:id/:action', auth(['admin']), wrap((req, res) => {
  const w = db.prepare("SELECT * FROM withdrawals WHERE id = ? AND status = 'pending'").get(req.params.id);
  if (!w) fail(404, 'No pending withdrawal with that id.');
  if (req.params.action === 'paid') {
    db.prepare("UPDATE withdrawals SET status = 'paid' WHERE id = ?").run(w.id);
  } else if (req.params.action === 'reject') {
    db.transaction(() => {
      db.prepare("UPDATE withdrawals SET status = 'rejected' WHERE id = ?").run(w.id);
      db.prepare('UPDATE users SET balance_paise = balance_paise + ? WHERE id = ?').run(w.amount_paise, w.user_id);
    })();
  } else fail(400, 'Unknown action.');
  res.json({ ok: true });
}));

/* ---------- serve built client in production ---------- */
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`EarnLoop API on http://localhost:${port}`));
}
