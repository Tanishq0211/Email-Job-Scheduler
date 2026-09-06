/**
 * Distributed send-slot acquisition for a sender, enforced atomically in
 * Redis so it is safe across any number of workers/API instances.
 *
 * Two independent controls are checked in one atomic Lua script:
 *  1. Hourly limit — a counter per (sender, UTC hour window).
 *  2. Minimum delay — a gate key storing the timestamp of the last
 *     send-start; a send may start only once minDelay has elapsed.
 *
 * KEYS[1] = hourly counter key   (email-rate:{senderId}:{window})
 * KEYS[2] = send gate key        (email-send-gate:{senderId})
 * ARGV[1] = hourly limit
 * ARGV[2] = min delay between sends (ms)
 * ARGV[3] = now (epoch ms)
 * ARGV[4] = ms until the next UTC hour boundary
 *
 * Returns { acquired(0|1), reason, retryInMs }.
 */
export const ACQUIRE_SEND_SLOT_LUA = `
local counter = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
local minDelay = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local nextHourIn = tonumber(ARGV[4])

if counter >= limit then
  return {0, 'hourly', nextHourIn}
end

local last = tonumber(redis.call('GET', KEYS[2]) or '0')
local wait = last + minDelay - now
if wait > 0 then
  return {0, 'delay', wait}
end

redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 7200)
redis.call('SET', KEYS[2], now, 'PX', 3600000)
return {1, 'ok', 0}
`;

/** Release an hourly slot after a failed SMTP attempt (floor at 0). */
export const RELEASE_SEND_SLOT_LUA = `
local counter = tonumber(redis.call('GET', KEYS[1]) or '0')
if counter > 0 then
  redis.call('DECR', KEYS[1])
end
return 1
`;
