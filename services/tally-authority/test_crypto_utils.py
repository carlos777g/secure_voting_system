import importlib.util
import os

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from crypto_utils import (
    VoteIntegrityError,
    canonical_json,
    decrypt_and_verify_vote,
    generate_election_keypair,
)

# Reproduces voter-client's own encryption exactly (see
# tools/voter-client/crypto_utils.py) so this test exercises the real
# wire format tally-authority must decrypt. Loaded under an alias, via
# importlib, since both projects have their own independent crypto_utils.py
# module and the two must not collide in sys.modules.
_voter_client_crypto_path = os.path.join(
    os.path.dirname(__file__), "..", "..", "tools", "voter-client", "crypto_utils.py"
)
_spec = importlib.util.spec_from_file_location("voter_client_crypto_utils", _voter_client_crypto_path)
_voter_client_crypto = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_voter_client_crypto)
b64e = _voter_client_crypto.b64e


def _encrypt_vote_like_voter_client(vote_content, token, election_public_key):
    plaintext = canonical_json(vote_content)
    aes_key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    encrypted_vote = AESGCM(aes_key).encrypt(nonce, plaintext, None)
    encrypted_aes_key = election_public_key.encrypt(
        aes_key,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    ephemeral_private = ed25519.Ed25519PrivateKey.generate()
    signed_fields = {
        "ballot_token_hash": "deadbeef",
        "encrypted_vote": b64e(encrypted_vote),
        "nonce": b64e(nonce),
        "encrypted_aes_key": b64e(encrypted_aes_key),
    }
    signature = ephemeral_private.sign(canonical_json(signed_fields))
    voter_public_key = ephemeral_private.public_key().public_bytes(
        encoding=serialization.Encoding.PEM, format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return {**signed_fields, "signature": b64e(signature), "voter_public_key": b64e(voter_public_key)}


@pytest.fixture
def election_keypair():
    return generate_election_keypair(key_size=2048)


def test_decrypt_and_verify_vote_round_trips(election_keypair):
    private_key, public_key = election_keypair
    vote_content = {"candidate": "alice", "choice_id": 1}
    vote_data = _encrypt_vote_like_voter_client(vote_content, "some-token", public_key)

    decrypted = decrypt_and_verify_vote(vote_data, private_key)

    assert decrypted == vote_content


def test_decrypt_and_verify_vote_rejects_tampered_signature(election_keypair):
    private_key, public_key = election_keypair
    vote_data = _encrypt_vote_like_voter_client({"candidate": "alice"}, "token", public_key)
    vote_data["encrypted_vote"] = vote_data["encrypted_vote"][:-4] + "AAAA"

    with pytest.raises(Exception):
        decrypt_and_verify_vote(vote_data, private_key)


def test_decrypt_and_verify_vote_rejects_mismatched_signer(election_keypair):
    private_key, public_key = election_keypair
    vote_data = _encrypt_vote_like_voter_client({"candidate": "alice"}, "token", public_key)

    # Swap in a different ephemeral key's public half — signature no longer
    # matches this "voter_public_key", so verification must fail.
    other_private = ed25519.Ed25519PrivateKey.generate()
    other_public_pem = other_private.public_key().public_bytes(
        encoding=serialization.Encoding.PEM, format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    vote_data["voter_public_key"] = b64e(other_public_pem)

    with pytest.raises(VoteIntegrityError):
        decrypt_and_verify_vote(vote_data, private_key)
