const { app, request, randomName, expectValidJwt, registerUser, createAdminUser, auth } = require('../testHelpers');

let diner;

beforeAll(async () => {
  diner = await registerUser();
});

test('get me', async () => {
  const meRes = await request(app).get('/api/user/me').set(auth(diner.token));
  expect(meRes.status).toBe(200);
  expect(meRes.body).toMatchObject({ id: diner.id, name: diner.name, email: diner.email, roles: [{ role: 'diner' }] });
});

test('get me unauthenticated', async () => {
  const meRes = await request(app).get('/api/user/me');
  expect(meRes.status).toBe(401);
});

test('update self name only', async () => {
  const user = await registerUser();
  const newName = randomName();
  const updateRes = await request(app).put(`/api/user/${user.id}`).set(auth(user.token)).send({ name: newName });
  expect(updateRes.status).toBe(200);
  expectValidJwt(updateRes.body.token);
  expect(updateRes.body.user).toMatchObject({ id: user.id, name: newName, email: user.email });
});

test('update self email and password', async () => {
  const user = await registerUser();
  const newEmail = randomName() + '@test.com';
  const updateRes = await request(app).put(`/api/user/${user.id}`).set(auth(user.token)).send({ email: newEmail, password: 'newpass' });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({ id: user.id, email: newEmail });

  const loginRes = await request(app).put('/api/auth').send({ email: newEmail, password: 'newpass' });
  expect(loginRes.status).toBe(200);
});

test('update rejects sql in fields', async () => {
  const user = await registerUser();
  const sneakyName = "x', email='hijacked@test.com";
  const updateRes = await request(app).put(`/api/user/${user.id}`).set(auth(user.token)).send({ name: sneakyName });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({ name: sneakyName, email: user.email });
});

test('diner cannot update another user', async () => {
  const other = await registerUser();
  const updateRes = await request(app).put(`/api/user/${other.id}`).set(auth(diner.token)).send({ name: 'hacked' });
  expect(updateRes.status).toBe(403);
});

test('admin can update another user', async () => {
  const admin = await createAdminUser();
  const other = await registerUser();
  const newName = randomName();
  const updateRes = await request(app).put(`/api/user/${other.id}`).set(auth(admin.token)).send({ name: newName });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({ id: other.id, name: newName });
});

test('admin update unknown user', async () => {
  const admin = await createAdminUser();
  const updateRes = await request(app).put('/api/user/999999999').set(auth(admin.token)).send({ name: 'nobody' });
  expect(updateRes.status).toBe(404);
});

test('delete user not implemented', async () => {
  const deleteRes = await request(app).delete(`/api/user/${diner.id}`).set(auth(diner.token));
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('not implemented');
});

describe('list users', () => {
  let admin;

  beforeAll(async () => {
    admin = await createAdminUser();
  });

  test('unauthenticated', async () => {
    const listRes = await request(app).get('/api/user');
    expect(listRes.status).toBe(401);
  });

  test('diner is forbidden', async () => {
    const listRes = await request(app).get('/api/user').set(auth(diner.token));
    expect(listRes.status).toBe(403);
  });

  test('admin gets users without passwords', async () => {
    const listRes = await request(app).get('/api/user').set(auth(admin.token));
    expect(listRes.status).toBe(200);
    expect(typeof listRes.body.more).toBe('boolean');
    expect(listRes.body.users.length).toBeGreaterThan(0);
    for (const user of listRes.body.users) {
      expect(Object.keys(user).sort()).toEqual(['email', 'id', 'name', 'roles']);
    }
  });

  // The test database keeps users from earlier runs, so these tests only look at
  // users whose names share a prefix unique to this run.
  describe('filtering and paging', () => {
    const prefix = randomName();
    let users;

    beforeAll(async () => {
      users = [];
      for (const suffix of ['a', 'b', 'c']) {
        users.push(await registerUser(`${prefix}${suffix}`));
      }
    });

    const list = (query) => request(app).get(`/api/user?${query}`).set(auth(admin.token));
    const summary = ({ id, name, email }) => ({ id, name, email, roles: [{ role: 'diner' }] });

    test('name filter with wildcard', async () => {
      const listRes = await list(`name=${prefix}*`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toEqual({ users: users.map(summary), more: false });
    });

    test('exact name filter', async () => {
      const listRes = await list(`name=${prefix}b`);
      expect(listRes.body).toEqual({ users: [summary(users[1])], more: false });
    });

    test('first page reports more', async () => {
      const listRes = await list(`name=${prefix}*&page=0&limit=2`);
      expect(listRes.body).toEqual({ users: users.slice(0, 2).map(summary), more: true });
    });

    test('last page reports no more', async () => {
      const listRes = await list(`name=${prefix}*&page=1&limit=2`);
      expect(listRes.body).toEqual({ users: users.slice(2).map(summary), more: false });
    });
  });
});
