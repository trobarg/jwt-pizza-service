const request = require('supertest');
const app = require('./service');
const { Role, DB } = require('./database/database.js');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5);
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

// Registers a fresh diner through the API and returns the user, its password, and its token.
async function registerUser() {
  const user = { name: randomName(), email: randomName() + '@test.com', password: 'a' };
  const res = await request(app).post('/api/auth').send(user);
  expectValidJwt(res.body.token);
  return { ...res.body.user, password: user.password, token: res.body.token };
}

// No endpoint creates an admin, so insert one directly and log it in through the API.
async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';
  user = await DB.addUser(user);

  const res = await request(app).put('/api/auth').send({ email: user.email, password: 'toomanysecrets' });
  expectValidJwt(res.body.token);
  return { ...user, password: 'toomanysecrets', token: res.body.token };
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { app, request, randomName, expectValidJwt, registerUser, createAdminUser, auth };
