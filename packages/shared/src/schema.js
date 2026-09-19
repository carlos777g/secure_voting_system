// Wire-format note: field names stay snake_case here, matching what the
// Python voter-client produces. We do not translate to camelCase at this
// boundary — a translation layer is one more place for a typo to silently
// drop a field, and this data is opaque to the ledger anyway. Ledger nodes
// never decrypt or interpret a vote; they only check its shape, store it,
// and hash it as part of a block.
const VOTE_DATA_FIELDS = [
  "ballot_token_hash",
  "encrypted_vote",
  "nonce",
  "encrypted_aes_key",
  "signature",
  "voter_public_key"
];

export function validateVoteData(data) {
  if (!data || typeof data !== "object") {
    return { valid: false, reason: "data is not an object" };
  }
  if (data.type !== "anonymous_vote") {
    return { valid: false, reason: `unexpected type: ${data.type}` };
  }
  for (const field of VOTE_DATA_FIELDS) {
    if (typeof data[field] !== "string" || data[field].length === 0) {
      return { valid: false, reason: `missing or invalid field: ${field}` };
    }
  }
  return { valid: true };
}
