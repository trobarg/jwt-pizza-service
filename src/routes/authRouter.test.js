const { app, request, expectValidJwt, registerUser, auth } = require('../testHelpers');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test('register', async () => {
  const registerRes = await request(app).post('/api/auth').send({ name: 'new diner', email: Math.random().toString(36).substring(2, 12) + '@test.com', password: 'b' });
  expect(registerRes.status).toBe(200);
  expectValidJwt(registerRes.body.token);
  expect(registerRes.body.user).toMatchObject({ name: 'new diner', roles: [{ role: 'diner' }] });
  expect(registerRes.body.user.password).toBeUndefined();
});

test('register missing fields', async () => {
  const registerRes = await request(app).post('/api/auth').send({ name: 'no email', password: 'a' });
  expect(registerRes.status).toBe(400);
  expect(registerRes.body.message).toBe('name, email, and password are required');
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('login bad password', async () => {
  const loginRes = await request(app).put('/api/auth').send({ email: testUser.email, password: 'wrong' });
  expect(loginRes.status).toBe(404);
  expect(loginRes.body.message).toBe('unknown user');
});

test('logout', async () => {
  const user = await registerUser();
  const logoutRes = await request(app).delete('/api/auth').set(auth(user.token));
  expect(logoutRes.status).toBe(200);
  expect(logoutRes.body.message).toBe('logout successful');

  // The token is still a valid JWT, but its row is gone from the auth table.
  const meRes = await request(app).get('/api/user/me').set(auth(user.token));
  expect(meRes.status).toBe(401);
});

test('logout without token', async () => {
  const logoutRes = await request(app).delete('/api/auth');
  expect(logoutRes.status).toBe(401);
  expect(logoutRes.body.message).toBe('unauthorized');
});

test('garbage token', async () => {
  const meRes = await request(app).get('/api/user/me').set(auth('not-a-jwt'));
  expect(meRes.status).toBe(401);
});

test('tampered token', async () => {
  // Keep the real signature (so the auth table lookup succeeds) but swap the payload, so jwt.verify fails.
  const [header, , signature] = testUserAuthToken.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ id: 1, roles: [{ role: 'admin' }] })).toString('base64url');
  const meRes = await request(app).get('/api/user/me').set(auth(`${header}.${forgedPayload}.${signature}`));
  expect(meRes.status).toBe(401);
});
