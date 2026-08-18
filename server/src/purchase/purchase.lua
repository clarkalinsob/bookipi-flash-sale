-- Atomically checks "already purchased" and "in stock", then commits both
-- the stock decrement and the purchased-user marker in one round-trip.
-- This single EVAL is what prevents the oversell / double-purchase race:
-- there is no window between checking and mutating state for another
-- concurrent request to interleave in.
--
-- KEYS[1] = stock counter key
-- KEYS[2] = purchased-users set key
-- ARGV[1] = userId (never string-interpolated — always passed as ARGV)

if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
  return 'ALREADY_PURCHASED'
end

local stock = tonumber(redis.call('GET', KEYS[1]))
if not stock or stock <= 0 then
  return 'SOLD_OUT'
end

redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[2], ARGV[1])
return 'SUCCESS'
