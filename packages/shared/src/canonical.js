// Deterministic JSON serialization: identical logical objects must always
// produce identical byte sequences, regardless of key insertion order.
//
// This has to stay behaviorally equivalent to the canonicalization used on
// the Python side (json.dumps with sort_keys=True, separators=(",", ":")),
// wherever the two sides need to agree on a hash or a signed payload. Do not
// add whitespace or change key ordering here without checking the Python
// implementation in tools/voter-client and services/tally-authority.

export function canonicalStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value).sort();
    const result = {};
    for (const key of sortedKeys) {
      result[key] = sortKeysDeep(value[key]);
    }
    return result;
  }
  return value;
}
