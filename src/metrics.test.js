jest.mock('./config.js', () => ({
  ...jest.requireActual('./config.js'),
  metrics: { source: 'jwt-pizza-service-test', endpointUrl: 'https://grafana.test/otlp/v1/metrics', accountId: '1234', apiKey: 'glc_test' },
}));

const { app, request, registerUser, auth } = require('./testHelpers');
const config = require('./config.js');
const metrics = require('./metrics.js');

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// Returns the current value of the metric data point whose attributes include all of `attributes`.
function metricValue(name, attributes = {}) {
  const dataPoint = metrics
    .buildMetrics()
    .filter((m) => m.name === name)
    .map((m) => (m.sum ?? m.gauge).dataPoints[0])
    .find((dp) => Object.entries(attributes).every(([key, value]) => dp.attributes.some((a) => a.key === key && a.value.stringValue === value)));
  return dataPoint.asInt ?? dataPoint.asDouble;
}

test('counts requests and latency by method', async () => {
  const before = metricValue('http_requests', { method: 'GET' });
  const latencyBefore = metricValue('http_request_latency', { method: 'GET' });
  await request(app).get('/');
  expect(metricValue('http_requests', { method: 'GET' })).toBe(before + 1);
  expect(metricValue('http_request_latency', { method: 'GET' })).toBeGreaterThan(latencyBefore);
});

test('counts successful and failed logins', async () => {
  const user = await registerUser();
  const success = metricValue('auth_attempts', { status: 'success' });
  const failure = metricValue('auth_attempts', { status: 'failure' });

  await request(app).put('/api/auth').send({ email: user.email, password: user.password });
  await request(app).put('/api/auth').send({ email: user.email, password: 'wrong' });

  expect(metricValue('auth_attempts', { status: 'success' })).toBe(success + 1);
  expect(metricValue('auth_attempts', { status: 'failure' })).toBe(failure + 1);
});

test('tracks active users until logout', async () => {
  const before = metricValue('active_users');
  const user = await registerUser();
  expect(metricValue('active_users')).toBe(before + 1);

  await request(app).get('/api/order').set(auth(user.token));
  expect(metricValue('active_users')).toBe(before + 1);

  await request(app).delete('/api/auth').set(auth(user.token));
  expect(metricValue('active_users')).toBe(before);
});

test('active users expire after inactivity', async () => {
  await registerUser();
  expect(metricValue('active_users')).toBeGreaterThan(0);
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);
  expect(metricValue('active_users')).toBe(0);
});

test('records pizza purchases', () => {
  const order = { items: [{ price: 0.05 }, { price: 0.25 }] };
  const sold = metricValue('pizzas_sold');
  const revenue = metricValue('pizza_revenue');
  const failures = metricValue('pizza_creation_failures');
  const orders = metricValue('pizza_orders');

  metrics.pizzaPurchase(true, 120, order);
  metrics.pizzaPurchase(false, 300, order);

  expect(metricValue('pizzas_sold')).toBe(sold + 2);
  expect(metricValue('pizza_revenue')).toBeCloseTo(revenue + 0.3);
  expect(metricValue('pizza_creation_failures')).toBe(failures + 1);
  expect(metricValue('pizza_orders')).toBe(orders + 2);
  expect(metricValue('pizza_creation_latency')).toBeGreaterThanOrEqual(420);
});

test('reports system usage percentages', () => {
  for (const name of ['cpu_usage', 'memory_usage']) {
    expect(metricValue(name, { source: 'jwt-pizza-service-test' })).toBeGreaterThanOrEqual(0);
  }
});

test('sends metrics to grafana periodically', async () => {
  jest.useFakeTimers();
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });

  const timer = metrics.sendMetricsPeriodically(1000);
  await jest.advanceTimersByTimeAsync(1000);
  clearInterval(timer);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe(config.metrics.endpointUrl);
  expect(options.headers.Authorization).toBe('Bearer 1234:glc_test');
  const sent = JSON.parse(options.body).resourceMetrics[0].scopeMetrics[0].metrics;
  expect(sent.map((m) => m.name)).toEqual(expect.arrayContaining(['http_requests', 'auth_attempts', 'active_users', 'cpu_usage', 'pizzas_sold', 'pizza_creation_latency']));
  expect(sent.find((m) => m.name === 'http_requests').sum.aggregationTemporality).toBe('AGGREGATION_TEMPORALITY_CUMULATIVE');
});

test('logs grafana failures without throwing', async () => {
  jest.useFakeTimers();
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 401 }).mockRejectedValueOnce(new Error('network down'));

  const timer = metrics.sendMetricsPeriodically(1000);
  await jest.advanceTimersByTimeAsync(2000);
  clearInterval(timer);

  expect(errorLog).toHaveBeenCalledWith('Failed to push metrics to Grafana: HTTP 401');
  expect(errorLog).toHaveBeenCalledWith('Error pushing metrics to Grafana:', 'network down');
});

test('does not send without metrics config', () => {
  const saved = config.metrics;
  config.metrics = undefined;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(metrics.sendMetricsPeriodically(1000)).toBeNull();
  } finally {
    config.metrics = saved;
  }
});
