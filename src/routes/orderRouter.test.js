const { app, request, randomName, registerUser, createAdminUser, auth } = require('../testHelpers');

let admin;
let diner;
let menuItem;
let franchise;
let store;

beforeAll(async () => {
  admin = await createAdminUser();
  diner = await registerUser();

  const item = { title: randomName(), description: 'test pizza', image: 'pizza9.png', price: 0.0001 };
  const menuRes = await request(app).put('/api/order/menu').set(auth(admin.token)).send(item);
  menuItem = menuRes.body.find((m) => m.title === item.title);

  franchise = (await request(app).post('/api/franchise').set(auth(admin.token)).send({ name: randomName(), admins: [] })).body;
  store = (await request(app).post(`/api/franchise/${franchise.id}/store`).set(auth(admin.token)).send({ name: randomName() })).body;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function orderFor(menu = menuItem) {
  return { franchiseId: franchise.id, storeId: store.id, items: [{ menuId: menu.id, description: menu.title, price: menu.price }] };
}

// The factory is an external service, so stub only its HTTP call. The database stays real.
function mockFactory(ok, body) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({ ok, json: async () => body });
}

test('get menu', async () => {
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(res.body).toContainEqual(menuItem);
});

test('admin adds menu item', async () => {
  const item = { title: randomName(), description: 'another', image: 'pizza1.png', price: 0.002 };
  const res = await request(app).put('/api/order/menu').set(auth(admin.token)).send(item);
  expect(res.status).toBe(200);
  expect(res.body).toContainEqual(expect.objectContaining(item));
});

test('diner cannot add menu item', async () => {
  const res = await request(app).put('/api/order/menu').set(auth(diner.token)).send({ title: 'nope', description: 'x', image: 'x.png', price: 1 });
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to add menu item');
});

test('create order', async () => {
  const fetchMock = mockFactory(true, { reportUrl: 'http://factory/report', jwt: 'a.b.c' });
  const order = orderFor();

  const res = await request(app).post('/api/order').set(auth(diner.token)).send(order);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ order: { ...order, id: expect.any(Number) }, followLinkToEndChaos: 'http://factory/report', jwt: 'a.b.c' });

  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/api\/order$/);
  expect(JSON.parse(options.body).diner).toEqual({ id: diner.id, name: diner.name, email: diner.email });
});

test('create order factory failure', async () => {
  mockFactory(false, { reportUrl: 'http://factory/report' });
  const res = await request(app).post('/api/order').set(auth(diner.token)).send(orderFor());
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ message: 'Failed to fulfill order at factory', followLinkToEndChaos: 'http://factory/report' });
});

test('create order with unknown menu item', async () => {
  const fetchMock = mockFactory(true, {});
  const res = await request(app).post('/api/order').set(auth(diner.token)).send(orderFor({ id: 999999999, title: 'ghost', price: 1 }));
  expect(res.status).toBe(500);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('get orders', async () => {
  const user = await registerUser();
  mockFactory(true, { reportUrl: 'http://factory/report', jwt: 'a.b.c' });
  await request(app).post('/api/order').set(auth(user.token)).send(orderFor());

  const res = await request(app).get('/api/order').set(auth(user.token));
  expect(res.status).toBe(200);
  expect(res.body.dinerId).toBe(user.id);
  expect(res.body.page).toBe(1);
  expect(res.body.orders).toHaveLength(1);
  expect(res.body.orders[0].items).toEqual([expect.objectContaining({ menuId: menuItem.id, price: menuItem.price })]);
});

test('get orders unauthenticated', async () => {
  const res = await request(app).get('/api/order');
  expect(res.status).toBe(401);
});
