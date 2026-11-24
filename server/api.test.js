import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_PASS = 'testpass';
const { app } = await import('./index.js');

let base, server;
test.before(async () => { server = app.listen(0); base = `http://localhost:${server.address().port}`; });
test.after(() => server.close());

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(base + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};
const register = async (username, role) => (await call('/auth/register', { method: 'POST', body: { username, password: 'secret1', role } })).data.token;

test('shop pays, user earns, margin is kept', async () => {
  const admin = (await call('/auth/login', { method: 'POST', body: { username: 'admin', password: 'testpass' } })).data.token;
  const shop = await register('chai_shop', 'advertiser');
  const user = await register('harsh', 'user');

  // shop adds funds, admin confirms
  await call('/shop/topups', { method: 'POST', token: shop, body: { amount: 500, ref: 'UPI12345' } });
  let ov = (await call('/admin/overview', { token: admin })).data;
  await call(`/admin/topups/${ov.topups[0].id}/approve`, { method: 'POST', token: admin });
  assert.equal((await call('/me', { token: shop })).data.balance_paise, 50000);

  // shop creates a survey, hidden until admin approves
  const made = await call('/shop/campaigns', { method: 'POST', token: shop, body: {
    type: 'survey', title: 'Chai habits', questions: ['How many cups a day?'], payout: 10, share_pct: 60, max_completions: 2, min_seconds: 5 } });
  assert.equal(made.status, 200);
  assert.equal((await call('/campaigns', { token: user })).data.length, 0);
  await call(`/admin/campaigns/${made.data.id}/approve`, { method: 'POST', token: admin });
  const list = (await call('/campaigns', { token: user })).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].reward_paise, 600);

  // cannot complete without starting, or too fast
  assert.equal((await call(`/campaigns/${made.data.id}/complete`, { method: 'POST', token: user, body: { answers: ['3'] } })).status, 400);
  await call(`/campaigns/${made.data.id}/start`, { method: 'POST', token: user });
  assert.equal((await call(`/campaigns/${made.data.id}/complete`, { method: 'POST', token: user, body: { answers: ['3'] } })).status, 400);

  await new Promise((r) => setTimeout(r, 5100));
  const done = await call(`/campaigns/${made.data.id}/complete`, { method: 'POST', token: user, body: { answers: ['3'] } });
  assert.equal(done.data.reward_paise, 600);
  // second attempt blocked
  assert.equal((await call(`/campaigns/${made.data.id}/complete`, { method: 'POST', token: user, body: { answers: ['3'] } })).status, 409);

  assert.equal((await call('/me', { token: user })).data.balance_paise, 600);
  assert.equal((await call('/me', { token: shop })).data.balance_paise, 49000);
  ov = (await call('/admin/overview', { token: admin })).data;
  assert.equal(ov.totals.margin_paise, 400);
});

test('roles are enforced', async () => {
  const user = await register('someuser', 'user');
  assert.equal((await call('/shop/campaigns', { method: 'POST', token: user, body: {} })).status, 403);
  assert.equal((await call('/admin/overview', { token: user })).status, 403);
  assert.equal((await call('/me')).status, 401);
});
