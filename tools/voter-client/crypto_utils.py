"""Crypto primitives for voter-client: AES-GCM vote encryption, RSA-OAEP
key wrapping for the election's decryption key, and ephemeral Ed25519
signing. The signing keypair is generated fresh per vote, in memory, and
discarded — nothing here ever writes a voter-identifying key to disk.
"""

import base64
import hashlib
import json
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii")


def b64d(data: str) -> bytes:
    return base64.urlsafe_b64decode(data.encode("ascii"))


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(obj) -> bytes:
    # Must byte-match packages/shared/src/canonical.js's canonicalStringify:
    # keys sorted at every level, no extraneous whitespace, no ASCII escaping.
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def load_rsa_public_key(pem: bytes) -> RSAPublicKey:
    return serialization.load_pem_public_key(pem)


def build_encrypted_vote(vote: dict, token: str, election_public_key: RSAPublicKey) -> dict:
    """Encrypts `vote` under the election's RSA-OAEP public key and signs
    the encrypted package with a fresh, ephemeral Ed25519 keypair.

    Returns every field ledger-node's validateVoteData requires except
    `type`, which the caller adds.
    """
    plaintext = canonical_json(vote)

    aes_key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    encrypted_vote = AESGCM(aes_key).encrypt(nonce, plaintext, None)

    encrypted_aes_key = election_public_key.encrypt(
        aes_key,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )

    ephemeral_private = ed25519.Ed25519PrivateKey.generate()
    ephemeral_public = ephemeral_private.public_key()

    signed_fields = {
        "ballot_token_hash": sha256_hex(token.encode("utf-8")),
        "encrypted_vote": b64e(encrypted_vote),
        "nonce": b64e(nonce),
        "encrypted_aes_key": b64e(encrypted_aes_key),
    }
    signature = ephemeral_private.sign(canonical_json(signed_fields))

    voter_public_key = ephemeral_public.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    return {
        **signed_fields,
        "signature": b64e(signature),
        "voter_public_key": b64e(voter_public_key),
    }
