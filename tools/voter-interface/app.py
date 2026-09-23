"""Interfaz web para votar en secure_voting_system.

DONDE COLOCAR ESTE ARCHIVO:
    secure_voting_system/tools/voter-interface/app.py
    (reemplaza el que ya tenias ahi)

ADEMAS necesitas crear una carpeta "static" junto a este archivo:
    secure_voting_system/tools/voter-interface/static/logo_ipn.png
    secure_voting_system/tools/voter-interface/static/logo_upiita.png

    Descarga el logo oficial del IPN y de UPIITA (por ejemplo desde
    ipn.mx y upiita.ipn.mx) y guardalos ahi con esos nombres exactos.
    Si usas otro formato (.svg, .jpg) cambia la extension en las
    lineas que dicen logo_ipn.png / logo_upiita.png mas abajo.

COMO CORRERLO:
    Con el sistema principal corriendo (pnpm dev:all) en OTRA terminal:
    cd tools/voter-interface
    python3 app.py

    Luego abre en tu navegador: http://localhost:5001
"""

import os
import sys

import requests
from flask import Flask, request, render_template_string

# Le decimos a Python donde encontrar crypto_utils.py, que vive en la
# carpeta hermana tools/voter-client (no queremos copiar ese codigo,
# solo reutilizarlo).
VOTER_CLIENT_DIR = os.path.join(os.path.dirname(__file__), "..", "voter-client")
sys.path.insert(0, os.path.abspath(VOTER_CLIENT_DIR))

from crypto_utils import build_encrypted_vote, load_rsa_public_key  # noqa: E402

app = Flask(__name__)

ELIGIBILITY_URL = "http://localhost:4000"
TALLY_URL = "http://localhost:5000"
PRIMARY_URL = "http://localhost:4001"

# Cambia estos por los candidatos reales de tu proyecto
CANDIDATES = ["alice", "bob"]

PAGE = """
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Sistema de Votacion - IPN</title>
  <style>
    :root {
      --guinda: #7a1e3a;
      --guinda-oscuro: #591530;
      --gris: #4a4a4a;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #f4f1f2;
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    header {
      background: var(--guinda);
      color: white;
      width: 100%;
      padding: 28px 130px;
      text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      position: relative;
      min-height: 90px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    header h1 { margin: 0; font-size: 1.5rem; }
    header p { margin: 6px 0 0; opacity: 0.9; font-size: 0.95rem; }

    .card {
      background: white;
      max-width: 420px;
      width: 90%;
      margin-top: 40px;
      padding: 32px;
      border-radius: 10px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    }
    label { display: block; margin-top: 16px; font-weight: bold; color: var(--gris); }
    input, select, button {
      width: 100%;
      padding: 10px;
      margin-top: 6px;
      font-size: 16px;
      border-radius: 6px;
      border: 1px solid #ccc;
    }
    button {
      margin-top: 24px;
      cursor: pointer;
      background: var(--guinda);
      color: white;
      border: none;
      font-weight: bold;
      transition: background 0.2s;
    }
    button:hover { background: var(--guinda-oscuro); }

    .msg { margin-top: 20px; padding: 14px; border-radius: 6px; font-weight: 500; }
    .ok { background: #d4edda; color: #155724; border: 1px solid #b7dfc0; }
    .error { background: #f8d7da; color: #721c24; border: 1px solid #f1b6bc; }

    .logo-izq {
      position: absolute;
      top: 50%;
      left: 20px;
      transform: translateY(-50%);
      height: 74px;
    }
    .logo-der {
      position: absolute;
      top: 50%;
      right: 20px;
      transform: translateY(-50%);
      height: 74px;
    }
  </style>
</head>
<body>
  <header>
    <img class="logo-izq" src="/static/logo_upiita.png" alt="UPIITA">
    <h1>Sistema de Votacion para el Instituto Politecnico Nacional</h1>
    <p>UPIITA &mdash; Proyecto de Criptografia</p>
    <img class="logo-der" src="/static/logo_ipn.png" alt="IPN">
  </header>

  <div class="card">
    <form method="post">
      <label>ID de votante</label>
      <input type="text" name="voter_id" placeholder="VOTANTE001" required>

      <label>Candidato</label>
      <select name="candidate">
        {% for c in candidates %}
          <option value="{{ c }}">{{ c }}</option>
        {% endfor %}
      </select>

      <button type="submit">Votar</button>
    </form>

    {% if message %}
      <div class="msg {{ 'ok' if ok else 'error' }}">{{ message }}</div>
    {% endif %}
  </div>
</body>
</html>
"""


def friendly_error_message(status_code, raw_text):
    """Convierte los errores tecnicos del backend en mensajes claros."""
    text_lower = (raw_text or "").lower()

    if "already been used" in text_lower or "has_voted" in text_lower:
        return "Este usuario ya emitio su voto anteriormente."
    if status_code == 403:
        return "Este ID de votante no es valido o no esta autorizado para votar."
    if status_code == 404:
        return "El votante no fue encontrado."
    return "No se pudo registrar tu voto. Intenta de nuevo o contacta al equipo tecnico."


@app.route("/", methods=["GET", "POST"])
def index():
    message = None
    ok = False

    if request.method == "POST":
        voter_id = request.form.get("voter_id", "").strip()
        candidate = request.form.get("candidate")

        try:
            # 1. Pedir la credencial (el "boleto") a eligibility-authority
            resp = requests.post(
                f"{ELIGIBILITY_URL}/identify",
                json={"voter_id": voter_id},
                timeout=10,
            )
            if resp.status_code != 200:
                message = friendly_error_message(resp.status_code, resp.text)
                return render_template_string(PAGE, candidates=CANDIDATES, message=message, ok=False)

            credential = resp.json()["credential"]

            # 2. Pedir la llave publica de la eleccion a tally-authority
            key_resp = requests.get(f"{TALLY_URL}/public-key", timeout=10)
            if key_resp.status_code != 200:
                message = "No se pudo conectar con el servicio de conteo. Verifica que este corriendo."
                return render_template_string(PAGE, candidates=CANDIDATES, message=message, ok=False)
            election_public_key = load_rsa_public_key(key_resp.content)

            # 3. Cifrar el voto (misma logica que usa voter_client.py)
            vote_content = {"candidate": candidate}
            vote = {
                "type": "anonymous_vote",
                **build_encrypted_vote(vote_content, credential["token"], election_public_key),
            }

            # 4. Enviar el voto cifrado + la credencial al primary de ledger-node
            vote_resp = requests.post(
                f"{PRIMARY_URL}/votes",
                json={"credential": credential, "vote": vote},
                timeout=10,
            )
            if vote_resp.status_code != 201:
                try:
                    raw_text = vote_resp.json().get("error", vote_resp.text)
                except ValueError:
                    raw_text = vote_resp.text
                message = friendly_error_message(vote_resp.status_code, raw_text)
                ok = False
            else:
                message = "Tu voto ha sido registrado correctamente."
                ok = True

        except requests.RequestException:
            message = "No se pudo conectar con el sistema de votacion. Verifica que este corriendo (pnpm dev:all)."
            ok = False
        except Exception as err:  # noqa: BLE001 - ultimo respaldo
            message = f"Ocurrio un error inesperado: {err}"
            ok = False

    return render_template_string(PAGE, candidates=CANDIDATES, message=message, ok=ok)


if __name__ == "__main__":
    app.run(debug=True, port=5001)
