const os = require('os');
const config = require('./config.js');

// A user counts as active if they logged in or made an authenticated request within this window.
const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000;

// All counters are cumulative since process start. Grafana derives per-minute rates with rate().
const requests = { GET: 0, PUT: 0, POST: 0, DELETE: 0 };
const requestLatency = { GET: 0, PUT: 0, POST: 0, DELETE: 0 };
const authAttempts = { success: 0, failure: 0 };
const activeUsers = new Map();
const pizza = { sold: 0, failures: 0, revenue: 0, orders: 0, latency: 0 };

// Express middleware that records request counts, latency, auth attempts, and user activity.
function requestTracker(req, res, next) {
  const start = performance.now();
  const method = req.method;
  // originalUrl is the only path that nested routers don't rewrite.
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');

  res.on('finish', () => {
    requests[method] = (requests[method] ?? 0) + 1;
    requestLatency[method] = (requestLatency[method] ?? 0) + (performance.now() - start);

    const succeeded = res.statusCode < 400;
    if (path === '/api/auth') {
      if (method === 'PUT') {
        authAttempts[succeeded ? 'success' : 'failure']++;
      }
      if (succeeded && (method === 'PUT' || method === 'POST')) {
        activeUsers.set(req.body.email, Date.now());
      } else if (succeeded && method === 'DELETE') {
        activeUsers.delete(req.user.email);
        return;
      }
    }
    if (req.user) {
      activeUsers.set(req.user.email, Date.now());
    }
  });

  next();
}

// Called once per order sent to the pizza factory.
function pizzaPurchase(success, latencyMs, order) {
  pizza.orders++;
  pizza.latency += latencyMs;
  if (success) {
    pizza.sold += order.items.length;
    pizza.revenue += order.items.reduce((sum, item) => sum + item.price, 0);
  } else {
    pizza.failures++;
  }
}

function getCpuUsagePercentage() {
  return (os.loadavg()[0] / os.cpus().length) * 100;
}

function getMemoryUsagePercentage() {
  return ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
}

function countActiveUsers() {
  const cutoff = Date.now() - ACTIVE_USER_WINDOW_MS;
  for (const [user, lastSeen] of activeUsers) {
    if (lastSeen < cutoff) {
      activeUsers.delete(user);
    }
  }
  return activeUsers.size;
}

// Builds a single OTLP metric. Sums are cumulative and monotonic; everything else is a gauge.
// The instance label keeps overlapping containers (e.g. during a deploy) from overwriting each other's counters.
function createMetric(name, value, unit, type, attributes = {}) {
  attributes = { ...attributes, source: config.metrics.source, instance: os.hostname() };
  const metric = {
    name,
    unit,
    [type]: {
      dataPoints: [
        {
          [Number.isInteger(value) ? 'asInt' : 'asDouble']: value,
          timeUnixNano: Date.now() * 1000000,
          attributes: Object.entries(attributes).map(([key, v]) => ({ key, value: { stringValue: v } })),
        },
      ],
    },
  };
  if (type === 'sum') {
    metric.sum.aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric.sum.isMonotonic = true;
  }
  return metric;
}

function buildMetrics() {
  const metrics = [];
  for (const method of Object.keys(requests)) {
    metrics.push(createMetric('http_requests', requests[method], '1', 'sum', { method }));
    metrics.push(createMetric('http_request_latency', requestLatency[method], 'ms', 'sum', { method }));
  }
  for (const status of Object.keys(authAttempts)) {
    metrics.push(createMetric('auth_attempts', authAttempts[status], '1', 'sum', { status }));
  }
  // An empty unit keeps Grafana from renaming the gauge to active_users_ratio.
  metrics.push(createMetric('active_users', countActiveUsers(), '', 'gauge'));
  metrics.push(createMetric('cpu_usage', getCpuUsagePercentage(), '%', 'gauge'));
  metrics.push(createMetric('memory_usage', getMemoryUsagePercentage(), '%', 'gauge'));
  metrics.push(createMetric('pizzas_sold', pizza.sold, '1', 'sum'));
  metrics.push(createMetric('pizza_creation_failures', pizza.failures, '1', 'sum'));
  metrics.push(createMetric('pizza_revenue', pizza.revenue, '1', 'sum'));
  metrics.push(createMetric('pizza_orders', pizza.orders, '1', 'sum'));
  metrics.push(createMetric('pizza_creation_latency', pizza.latency, 'ms', 'sum'));
  return metrics;
}

async function sendMetricsToGrafana(metrics) {
  const { endpointUrl, accountId, apiKey } = config.metrics;
  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      body: JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics }] }] }),
      headers: { Authorization: `Bearer ${accountId}:${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.error(`Failed to push metrics to Grafana: HTTP ${res.status}`);
    }
  } catch (error) {
    console.error('Error pushing metrics to Grafana:', error.message);
  }
}

// Started from index.js rather than on require so tests don't leave a timer running.
function sendMetricsPeriodically(period) {
  if (!config.metrics) {
    console.warn('No metrics config found; metrics will not be sent to Grafana.');
    return null;
  }
  const timer = setInterval(() => sendMetricsToGrafana(buildMetrics()), period);
  timer.unref();
  return timer;
}

module.exports = { requestTracker, pizzaPurchase, buildMetrics, sendMetricsPeriodically };
