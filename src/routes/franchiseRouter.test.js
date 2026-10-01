const { app, request, randomName, registerUser, createAdminUser, auth } = require('../testHelpers');

let admin;
let franchisee;
let diner;

beforeAll(async () => {
  admin = await createAdminUser();
  franchisee = await registerUser();
  diner = await registerUser();
});

async function createFranchise(adminEmails = [franchisee.email]) {
  const franchise = { name: randomName(), admins: adminEmails.map((email) => ({ email })) };
  const res = await request(app).post('/api/franchise').set(auth(admin.token)).send(franchise);
  expect(res.status).toBe(200);
  return res.body;
}

async function createStore(franchiseId, token = admin.token) {
  return request(app).post(`/api/franchise/${franchiseId}/store`).set(auth(token)).send({ name: randomName() });
}

test('admin creates franchise', async () => {
  const franchise = await createFranchise();
  expect(franchise.id).toEqual(expect.any(Number));
  expect(franchise.admins).toEqual([expect.objectContaining({ email: franchisee.email, id: franchisee.id, name: franchisee.name })]);
});

test('diner cannot create franchise', async () => {
  const res = await request(app).post('/api/franchise').set(auth(diner.token)).send({ name: randomName(), admins: [] });
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to create a franchise');
});

test('create franchise with unknown admin', async () => {
  const email = randomName() + '@nobody.com';
  const res = await request(app).post('/api/franchise').set(auth(admin.token)).send({ name: randomName(), admins: [{ email }] });
  expect(res.status).toBe(404);
  expect(res.body.message).toBe(`unknown user for franchise admin ${email} provided`);
});

test('list franchises anonymously', async () => {
  const franchise = await createFranchise();
  const store = (await createStore(franchise.id)).body;

  const res = await request(app).get(`/api/franchise?name=${franchise.name}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ franchises: [{ id: franchise.id, name: franchise.name, stores: [{ id: store.id, name: store.name }] }], more: false });
});

test('list franchises as admin includes admins and revenue', async () => {
  const franchise = await createFranchise();
  await createStore(franchise.id);

  const res = await request(app).get(`/api/franchise?name=${franchise.name}`).set(auth(admin.token));
  expect(res.status).toBe(200);
  const [listed] = res.body.franchises;
  expect(listed.admins).toEqual([expect.objectContaining({ id: franchisee.id })]);
  expect(listed.stores).toEqual([expect.objectContaining({ totalRevenue: 0 })]);
});

test('list franchises paging', async () => {
  const prefix = randomName();
  for (let i = 0; i < 3; i++) {
    await request(app).post('/api/franchise').set(auth(admin.token)).send({ name: `${prefix}${i}`, admins: [] });
  }

  const page0 = await request(app).get(`/api/franchise?name=${prefix}*&limit=2&page=0`);
  expect(page0.body.franchises).toHaveLength(2);
  expect(page0.body.more).toBe(true);

  const page1 = await request(app).get(`/api/franchise?name=${prefix}*&limit=2&page=1`);
  expect(page1.body.franchises).toHaveLength(1);
  expect(page1.body.more).toBe(false);
});

test('list franchises rejects sql in limit', async () => {
  const res = await request(app).get(`/api/franchise?limit=${encodeURIComponent('1 UNION SELECT id, password FROM user')}`);
  expect(res.status).toBe(200);
  expect(res.body.franchises.length).toBeLessThanOrEqual(1);
});

test('get own franchises', async () => {
  const franchise = await createFranchise();
  const res = await request(app).get(`/api/franchise/${franchisee.id}`).set(auth(franchisee.token));
  expect(res.status).toBe(200);
  expect(res.body).toContainEqual(expect.objectContaining({ id: franchise.id, name: franchise.name }));
});

test('get franchises for user with none', async () => {
  const res = await request(app).get(`/api/franchise/${diner.id}`).set(auth(diner.token));
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('cannot get another user franchises', async () => {
  await createFranchise();
  const res = await request(app).get(`/api/franchise/${franchisee.id}`).set(auth(diner.token));
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('admin gets another user franchises', async () => {
  const franchise = await createFranchise();
  const res = await request(app).get(`/api/franchise/${franchisee.id}`).set(auth(admin.token));
  expect(res.body).toContainEqual(expect.objectContaining({ id: franchise.id }));
});

test('franchisee creates and deletes store', async () => {
  const franchise = await createFranchise();
  const createRes = await createStore(franchise.id, franchisee.token);
  expect(createRes.status).toBe(200);
  expect(createRes.body).toMatchObject({ id: expect.any(Number), franchiseId: franchise.id });

  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}/store/${createRes.body.id}`).set(auth(franchisee.token));
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('store deleted');
});

test('diner cannot create or delete store', async () => {
  const franchise = await createFranchise();
  const createRes = await createStore(franchise.id, diner.token);
  expect(createRes.status).toBe(403);
  expect(createRes.body.message).toBe('unable to create a store');

  const store = (await createStore(franchise.id)).body;
  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}/store/${store.id}`).set(auth(diner.token));
  expect(deleteRes.status).toBe(403);
  expect(deleteRes.body.message).toBe('unable to delete a store');
});

test('store routes on missing franchise', async () => {
  const createRes = await createStore(999999999);
  expect(createRes.status).toBe(403);

  const deleteRes = await request(app).delete('/api/franchise/999999999/store/1').set(auth(admin.token));
  expect(deleteRes.status).toBe(403);
});

test('admin deletes franchise', async () => {
  const franchise = await createFranchise();
  await createStore(franchise.id);

  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}`).set(auth(admin.token));
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('franchise deleted');

  const listRes = await request(app).get(`/api/franchise?name=${franchise.name}`);
  expect(listRes.body.franchises).toEqual([]);
});

test('delete franchise requires admin', async () => {
  const franchise = await createFranchise();

  const anonRes = await request(app).delete(`/api/franchise/${franchise.id}`);
  expect(anonRes.status).toBe(401);

  const franchiseeRes = await request(app).delete(`/api/franchise/${franchise.id}`).set(auth(franchisee.token));
  expect(franchiseeRes.status).toBe(403);
  expect(franchiseeRes.body.message).toBe('unable to delete a franchise');
});
