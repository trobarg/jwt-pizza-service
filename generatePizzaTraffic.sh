#!/bin/bash
# Simulates traffic against the pizza service so every Grafana metric has nonzero data.
# Assumes the database was populated with generatePizzaData.sh (d@jwt.com, f@jwt.com, franchise 1, store 1, menu item 1).

if [ -z "$1" ]; then
  echo "Usage: $0 <host>"
  echo "Example: $0 http://localhost:3000"
  exit 1
fi
host=$1

cleanup() {
  echo "Terminating background processes..."
  kill $(jobs -p) 2>/dev/null
  exit 0
}
trap cleanup SIGINT

# Prints only the HTTP status code of a request.
status() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

login() {
  curl -s -X PUT "$host/api/auth" -H 'Content-Type: application/json' -d "{\"email\":\"$1\", \"password\":\"$2\"}" | jq -r '.token'
}

logout() {
  status -X DELETE "$host/api/auth" -H "Authorization: Bearer $1"
}

order() {
  status -X POST "$host/api/order" -H 'Content-Type: application/json' -H "Authorization: Bearer $1" -d "{\"franchiseId\": 1, \"storeId\": 1, \"items\": [$2]}"
}

veggie='{ "menuId": 1, "description": "Veggie", "price": 0.05 }'

# Browse the menu every 3 seconds (GET)
while true; do
  echo "Requesting menu..." $(status "$host/api/order/menu")
  sleep 3
done &

# Fail to log in every 25 seconds (failed auth)
while true; do
  echo "Logging in with invalid credentials..." $(status -X PUT "$host/api/auth" -H 'Content-Type: application/json' -d '{"email":"unknown@jwt.com", "password":"bad"}')
  sleep 25
done &

# A franchisee stays logged in for two minutes (active users)
while true; do
  token=$(login "f@jwt.com" "franchisee")
  echo "Login franchisee..." $([ "$token" != "null" ] && echo true || echo false)
  sleep 110
  echo "Logging out franchisee..." $(logout "$token")
  sleep 10
done &

# A diner buys a pizza every 50 seconds (pizzas sold, revenue, creation latency)
while true; do
  token=$(login "d@jwt.com" "diner")
  echo "Login diner..." $([ "$token" != "null" ] && echo true || echo false)
  echo "Bought a pizza..." $(order "$token" "$veggie")
  sleep 20
  echo "Logging out diner..." $(logout "$token")
  sleep 30
done &

# A hungry diner orders too many pizzas every 5 minutes (creation failures)
while true; do
  token=$(login "d@jwt.com" "diner")
  echo "Login hungry diner..." $([ "$token" != "null" ] && echo true || echo false)
  items="$veggie"
  for ((i = 0; i < 21; i++)); do
    items+=", $veggie"
  done
  echo "Bought too many pizzas..." $(order "$token" "$items")
  sleep 5
  echo "Logging out hungry diner..." $(logout "$token")
  sleep 295
done &

wait
