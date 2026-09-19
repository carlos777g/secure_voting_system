"""Crypto primitives for tally-authority: the only piece of this system
holding a key capable of decrypting a vote. Everything here operates on
the same wire format voter-client produces (see tools/voter-client/crypto_utils.py).
"""

import base64
import json

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SIGNED_FIELDS = ("ballot_token_hash", "encrypted_vote", "nonce", "encrypted_aes_key")


def b64d(data: str) -> bytes:
    return base64.urlsafe_b64decode(data.encode("ascii"))


def canonical_json(obj) -> bytes:
    # Must byte-match packages/shared/src/canonical.js's canonicalStringify
    # and tools/voter-client/crypto_utils.py's canonical_json.
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def generate_election_keypair(key_size: int = 3072):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
    return private_key, private_key.public_key()


def private_key_to_pem(private_key) -> bytes:
    return private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


def public_key_to_pem(public_key) -> bytes:
    return public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def load_private_key(pem: bytes):
    return serialization.load_pem_private_key(pem, password=None)


class VoteIntegrityError(Exception):
    """The decrypted vote's signature does not verify against its claimed
    voter_public_key — the package was altered after it was signed."""


def decrypt_and_verify_vote(vote_data: dict, private_key) -> dict:
    aes_key = private_key.decrypt(
        b64d(vote_data["encrypted_aes_key"]),
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    plaintext = AESGCM(aes_key).decrypt(b64d(vote_data["nonce"]), b64d(vote_data["encrypted_vote"]), None)

    signed_fields = {field: vote_data[field] for field in SIGNED_FIELDS}
    voter_public_key = serialization.load_pem_public_key(b64d(vote_data["voter_public_key"]))
    try:
        voter_public_key.verify(b64d(vote_data["signature"]), canonical_json(signed_fields))
    except Exception as err:
        raise VoteIntegrityError(f"signature verification failed: {err}") from err

    return json.loads(plaintext.decode("utf-8"))
