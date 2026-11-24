import { useEffect, useState } from 'react';
import { api, inr } from './api.js';

export default function App() {
  const [me, setMe] = useState(null);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState(null);
  const say = (t, bad) => { setNote({ t, bad }); setTimeout(() => setNote(null), 4000); };
  const refresh = async () => {
    try { setMe(await api('/me')); } catch { setMe(null); }
    setReady(true);
  };
  useEffect(() => { refresh(); }, []);
  const logout = () => { localStorage.removeItem('token'); setMe(null); };
  if (!ready) return null;

  const props = { me, refresh, say };
  return (
    <div className="wrap">
      <div className="top">
        <div className="logo">Earn<i>Loop</i></div>
        {me && <div className="row"><span className="mute">{me.username} ({me.role === 'advertiser' ? 'shop' : me.role})</span>
          <button className="btn ghost sm" onClick={logout}>Log out</button></div>}
      </div>
      {note && <div className={'msg' + (note.bad ? ' bad' : '')} role="status">{note.t}</div>}
      {!me && <Auth onDone={refresh} say={say} />}
      {me?.role === 'user' && <UserView {...props} />}
      {me?.role === 'advertiser' && <ShopView {...props} />}
      {me?.role === 'admin' && <AdminView {...props} />}
    </div>
  );
}

function Auth({ onDone, say }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ username: '', password: '', role: 'user' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      const { token } = await api('/auth/' + mode, { method: 'POST', body: f });
      localStorage.setItem('token', token);
      onDone();
    } catch (err) { say(err.message, true); }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>{mode === 'login' ? 'Log in' : 'Create your account'}</h2>
      <p className="mute">Shops pay for ads, surveys and offers. Users earn a share of every payment.</p>
      <label htmlFor="u">Username</label>
      <input id="u" value={f.username} onChange={set('username')} autoComplete="username" required />
      <label htmlFor="p">Password</label>
      <input id="p" type="password" value={f.password} onChange={set('password')} autoComplete="current-password" required />
      {mode === 'register' && (<>
        <label htmlFor="r">I want to</label>
        <select id="r" value={f.role} onChange={set('role')}>
          <option value="user">Earn money by completing offers</option>
          <option value="advertiser">Advertise my shop</option>
        </select></>)}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" type="submit">{mode === 'login' ? 'Log in' : 'Sign up'}</button>
        <button className="btn ghost" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New here? Sign up' : 'Have an account? Log in'}</button>
      </div>
    </form>
  );
}

function Hero({ label, paise, hint }) {
  return (<div className="hero"><small>{label}</small><div className="bal">{inr(paise)}</div><small>{hint}</small></div>);
}

function Tabs({ tabs, tab, setTab }) {
  return (<div className="tabs" role="tablist">{tabs.map(([k, n]) => (
    <button key={k} role="tab" aria-selected={tab === k} className="tab" onClick={() => setTab(k)}>{n}</button>))}</div>);
}

/* ---------------- users ---------------- */
function UserView({ me, refresh, say }) {
  const [tab, setTab] = useState('earn');
  const [list, setList] = useState([]);
  const [task, setTask] = useState(null);
  const [history, setHistory] = useState([]);
  const [upi, setUpi] = useState('');
  const load = async () => { setList(await api('/campaigns')); setHistory(await api('/history')); refresh(); };
  useEffect(() => { load().catch((e) => say(e.message, true)); }, []);

  const withdraw = async () => {
    try { await api('/withdrawals', { method: 'POST', body: { upi } }); say('Withdrawal requested. You will be paid by UPI.'); setUpi(''); load(); }
    catch (e) { say(e.message, true); }
  };
  const label = { ad: 'Ad', survey: 'Survey', offer: 'Offer' };
  return (<>
    <Hero label="Your balance" paise={me.balance_paise} hint="Withdraw from ₹100" />
    <Tabs tabs={[['earn', 'Earn'], ['wallet', 'Wallet']]} tab={tab} setTab={setTab} />
    {tab === 'earn' && (<>
      {list.length === 0 && <div className="card"><h3>No offers right now</h3><p className="mute">Shops add new ads and surveys all the time. Check back soon.</p></div>}
      {list.map((c) => (
        <div className="card" key={c.id}><div className="row">
          <div><span className="pill">{label[c.type]}</span> <span className="mute">by {c.shop}</span>
            <h3 style={{ margin: '6px 0 2px', fontSize: 18 }}>{c.title}</h3>
            <div className="mute">{c.description || 'Takes about ' + c.min_seconds + ' seconds.'}</div></div>
          <div style={{ textAlign: 'right' }}><div className="pay">{inr(c.reward_paise)}</div>
            <button className="btn sm" onClick={() => setTask(c)}>Start</button></div>
        </div></div>))}
    </>)}
    {tab === 'wallet' && (<>
      <div className="card"><h3>Withdraw to UPI</h3>
        <label htmlFor="upi">UPI ID</label>
        <input id="upi" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" />
        <div style={{ marginTop: 12 }}><button className="btn" onClick={withdraw}>Withdraw {inr(me.balance_paise)}</button></div></div>
      <div className="card"><h3 style={{ marginBottom: 8 }}>History</h3>
        {history.length === 0 && <p className="mute">Nothing yet. Finish an offer on the Earn tab.</p>}
        {history.map((h, i) => (<div className="row" key={i} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
          <span>{h.label}</span><b style={{ color: h.amount_paise > 0 ? 'var(--ok)' : 'var(--bad)' }}>{h.amount_paise > 0 ? '+' : '−'}{inr(Math.abs(h.amount_paise))}</b></div>))}
      </div></>)}
    {task && <TaskModal c={task} say={say} onClose={() => { setTask(null); load(); }} />}
  </>);
}

function TaskModal({ c, say, onClose }) {
  const [left, setLeft] = useState(null);
  const [answers, setAnswers] = useState(c.questions.map(() => ''));
  useEffect(() => { api(`/campaigns/${c.id}/start`, { method: 'POST' }).then((r) => setLeft(r.min_seconds)).catch((e) => { say(e.message, true); onClose(); }); }, []);
  useEffect(() => { if (left > 0) { const t = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(t); } }, [left]);
  const claim = async () => {
    try { const r = await api(`/campaigns/${c.id}/complete`, { method: 'POST', body: { answers } }); say('You earned ' + inr(r.reward_paise) + '.'); onClose(); }
    catch (e) { say(e.message, true); }
  };
  const ready = left === 0 && answers.every((a) => a.trim());
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={c.title}><div className="modal">
      <h3>{c.title}</h3>
      <p className="mute">{c.description}</p>
      {c.link && <p><a href={c.link} target="_blank" rel="noopener noreferrer">Open {c.type === 'offer' ? 'the offer' : 'the ad'} in a new tab</a></p>}
      {c.questions.map((q, i) => (<div key={i}><label htmlFor={'q' + i}>{q}</label>
        <input id={'q' + i} value={answers[i]} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} /></div>))}
      {left !== null && <div className="bar"><b style={{ width: ((c.min_seconds - left) / c.min_seconds) * 100 + '%' }} /></div>}
      <p>{left > 0 ? `Reward unlocks in ${left}s` : 'Ready to claim.'}</p>
      <div className="row"><button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn" disabled={!ready} onClick={claim}>Claim {inr(c.reward_paise)}</button></div>
    </div></div>
  );
}

/* ---------------- shops ---------------- */
const blank = { type: 'ad', title: '', description: '', link: '', questions: '', payout: '5', share_pct: '60', max_completions: '100', min_seconds: '15' };
const statusClass = { active: 'ok', pending: '', paused: '', rejected: 'bad', exhausted: 'bad' };

function ShopView({ me, refresh, say }) {
  const [tab, setTab] = useState('campaigns');
  const [camps, setCamps] = useState([]);
  const [topups, setTopups] = useState([]);
  const [f, setF] = useState(blank);
  const [t, setT] = useState({ amount: '', ref: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const load = async () => { setCamps(await api('/shop/campaigns')); setTopups(await api('/shop/topups')); refresh(); };
  useEffect(() => { load().catch((e) => say(e.message, true)); }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api('/shop/campaigns', { method: 'POST', body: { ...f, questions: f.questions.split('\n') } });
      say('Campaign submitted. It goes live after review.'); setF(blank); setTab('campaigns'); load();
    } catch (err) { say(err.message, true); }
  };
  const topup = async (e) => {
    e.preventDefault();
    try { await api('/shop/topups', { method: 'POST', body: t }); say('Top-up submitted. Funds appear once we confirm your payment.'); setT({ amount: '', ref: '' }); load(); }
    catch (err) { say(err.message, true); }
  };
  const toggle = async (id) => { try { await api(`/shop/campaigns/${id}/toggle`, { method: 'POST' }); load(); } catch (err) { say(err.message, true); } };
  const user = Math.floor((Number(f.payout) * Number(f.share_pct)) / 100 * 100) / 100;

  return (<>
    <Hero label="Ad funds" paise={me.balance_paise} hint="Each completion is deducted from this balance" />
    <Tabs tabs={[['campaigns', 'My campaigns'], ['new', 'Create campaign'], ['funds', 'Add funds']]} tab={tab} setTab={setTab} />
    {tab === 'campaigns' && (<>
      {camps.length === 0 && <div className="card"><h3>No campaigns yet</h3><p className="mute">Create your first ad, survey or offer.</p></div>}
      {camps.map((c) => (<div className="card" key={c.id}><div className="row">
        <div><span className={'pill ' + (statusClass[c.status] || '')}>{c.status}</span> <span className="pill">{c.type}</span>
          <h3 style={{ margin: '6px 0 2px', fontSize: 18 }}>{c.title}</h3>
          <div className="mute">{c.completions}/{c.max_completions} completed · spent {inr(c.spent_paise)} · {inr(c.payout_paise)} each</div></div>
        {['active', 'paused'].includes(c.status) && <button className="btn ghost sm" onClick={() => toggle(c.id)}>{c.status === 'active' ? 'Pause' : 'Resume'}</button>}
      </div></div>))}</>)}
    {tab === 'new' && (
      <form className="card" onSubmit={create}>
        <h3>New campaign</h3>
        <label htmlFor="t">Type</label>
        <select id="t" value={f.type} onChange={set('type')}>
          <option value="ad">Ad (user views your message for a few seconds)</option>
          <option value="survey">Survey (user answers your questions)</option>
          <option value="offer">Offer (user visits your link or signs up)</option></select>
        <label htmlFor="ti">Title</label><input id="ti" value={f.title} onChange={set('title')} required />
        <label htmlFor="d">Description (what the user sees)</label><textarea id="d" rows="2" value={f.description} onChange={set('description')} />
        <label htmlFor="l">Link {f.type === 'offer' ? '(required)' : '(optional)'}</label><input id="l" value={f.link} onChange={set('link')} placeholder="https://" />
        {f.type === 'survey' && (<><label htmlFor="q">Questions, one per line (max 8)</label>
          <textarea id="q" rows="4" value={f.questions} onChange={set('questions')} /></>)}
        <div className="two">
          <div><label htmlFor="pa">You pay per completion (₹)</label><input id="pa" type="number" min="1" max="500" value={f.payout} onChange={set('payout')} /></div>
          <div><label htmlFor="sh">User share (%)</label><input id="sh" type="number" min="30" max="80" value={f.share_pct} onChange={set('share_pct')} /></div>
          <div><label htmlFor="mx">Max completions</label><input id="mx" type="number" min="1" value={f.max_completions} onChange={set('max_completions')} /></div>
          <div><label htmlFor="ms">Minimum seconds on task</label><input id="ms" type="number" min="5" max="300" value={f.min_seconds} onChange={set('min_seconds')} /></div>
        </div>
        <p className="mute">Each user earns ₹{user.toFixed(2)}. Maximum spend: ₹{(Number(f.payout) * Number(f.max_completions) || 0).toFixed(2)}.</p>
        <button className="btn" type="submit">Submit for review</button>
      </form>)}
    {tab === 'funds' && (<>
      <form className="card" onSubmit={topup}>
        <h3>Add funds</h3>
        <p className="mute">Pay the platform owner by UPI, then enter the amount and the transaction reference here. Funds are added once the payment is confirmed.</p>
        <div className="two">
          <div><label htmlFor="am">Amount (₹)</label><input id="am" type="number" min="100" value={t.amount} onChange={(e) => setT({ ...t, amount: e.target.value })} required /></div>
          <div><label htmlFor="rf">UPI transaction reference</label><input id="rf" value={t.ref} onChange={(e) => setT({ ...t, ref: e.target.value })} required /></div></div>
        <div style={{ marginTop: 12 }}><button className="btn" type="submit">Submit payment details</button></div>
      </form>
      <div className="card"><h3 style={{ marginBottom: 8 }}>Top-up history</h3>
        {topups.length === 0 && <p className="mute">No top-ups yet.</p>}
        {topups.map((x) => (<div className="row" key={x.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
          <span>{inr(x.amount_paise)} · {x.ref}</span><span className={'pill ' + (x.status === 'approved' ? 'ok' : x.status === 'rejected' ? 'bad' : '')}>{x.status}</span></div>))}</div></>)}
  </>);
}

/* ---------------- admin ---------------- */
function AdminView({ say }) {
  const [o, setO] = useState(null);
  const load = async () => setO(await api('/admin/overview'));
  useEffect(() => { load().catch((e) => say(e.message, true)); }, []);
  const act = (path) => async () => { try { await api(path, { method: 'POST' }); load(); } catch (e) { say(e.message, true); } };
  if (!o) return null;
  return (<>
    <div className="grid">
      <div className="card"><span className="mute">Shops paid</span><b>{inr(o.totals.adv_paise)}</b></div>
      <div className="card"><span className="mute">Paid to users</span><b>{inr(o.totals.user_paise)}</b></div>
      <div className="card"><span className="mute">Your margin</span><b>{inr(o.totals.margin_paise)}</b></div>
    </div>
    <div className="card"><h3 style={{ marginBottom: 8 }}>Shop payments to confirm</h3>
      {o.topups.length === 0 && <p className="mute">None waiting.</p>}
      {o.topups.map((x) => (<div className="row" key={x.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
        <span>{x.shop}: {inr(x.amount_paise)} · ref {x.ref}</span>
        <span><button className="btn sm" onClick={act(`/admin/topups/${x.id}/approve`)}>Confirm received</button> <button className="btn ghost sm" onClick={act(`/admin/topups/${x.id}/reject`)}>Reject</button></span></div>))}</div>
    <div className="card"><h3 style={{ marginBottom: 8 }}>Campaigns to review</h3>
      {o.campaigns.length === 0 && <p className="mute">None waiting.</p>}
      {o.campaigns.map((c) => (<div key={c.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
        <div className="row"><div><span className="pill">{c.type}</span> <b>{c.title}</b> <span className="mute">by {c.shop} · {inr(c.payout_paise)} each, {c.share_pct}% to user</span></div>
          <span><button className="btn sm" onClick={act(`/admin/campaigns/${c.id}/approve`)}>Approve</button> <button className="btn ghost sm" onClick={act(`/admin/campaigns/${c.id}/reject`)}>Reject</button></span></div>
        <div className="mute">{c.description} {c.link} {c.questions.length ? 'Questions: ' + c.questions.join(' | ') : ''}</div></div>))}</div>
    <div className="card"><h3 style={{ marginBottom: 8 }}>Withdrawals to pay</h3>
      {o.withdrawals.length === 0 && <p className="mute">None waiting.</p>}
      {o.withdrawals.map((w) => (<div className="row" key={w.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
        <span>{w.username}: {inr(w.amount_paise)} to {w.upi}</span>
        <span><button className="btn sm" onClick={act(`/admin/withdrawals/${w.id}/paid`)}>Mark paid</button> <button className="btn ghost sm" onClick={act(`/admin/withdrawals/${w.id}/reject`)}>Reject and refund</button></span></div>))}</div>
  </>);
}
