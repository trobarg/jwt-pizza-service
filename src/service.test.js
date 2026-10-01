const { app, request } = require('./testHelpers');
const version = require('./version.json');

test('root', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'welcome to JWT Pizza', version: version.version });
});

test('docs', async () => {
  const res = await request(app).get('/api/docs');
  expect(res.status).toBe(200);
  expect(res.body.version).toBe(version.version);
  expect(res.body.endpoints.length).toBeGreaterThan(0);
  expect(res.body.config).toEqual({ factory: expect.any(String), db: expect.any(String) });
});

test('unknown endpoint', async () => {
  const res = await request(app).get('/api/nope');
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('unknown endpoint');
});

test('cors headers', async () => {
  const res = await request(app).get('/').set('Origin', 'http://example.com');
  expect(res.headers['access-control-allow-origin']).toBe('http://example.com');
});
