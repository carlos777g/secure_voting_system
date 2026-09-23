"""Interfaz de resultados para secure_voting_system.

DONDE COLOCAR ESTE ARCHIVO:
    secure_voting_system/tools/results-interface/app.py

(Crea esa carpeta nueva "results-interface" dentro de "tools",
al mismo nivel que voter-client y voter-interface)

QUE HACE:
    Corre tally.py (el script que descifra y cuenta los votos) cada vez
    que recargas la pagina, y muestra los resultados en una tabla.

    OJO: esto solo tiene sentido en un ambiente de practica/demo como
    este, donde tu mismo tienes la llave privada en tu maquina. En una
    eleccion real, tally.py se corre una sola vez, manualmente, DESPUES
    de cerrar la votacion (no en cada recarga de pagina) - asi lo aclara
    el propio README del proyecto.

COMO CORRERLO:
    Con el sistema principal corriendo (pnpm dev:all) en otra terminal:
    cd tools/results-interface
    python3 app.py

    Luego abre en tu navegador: http://localhost:5002
"""

import json
import os
import subprocess
import sys

from flask import Flask, render_template_string

app = Flask(__name__)

# Ruta al tally.py real, sin importar desde donde se corra este archivo
TALLY_SCRIPT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "services", "tally-authority", "tally.py")
)

LEDGER_URLS = "http://localhost:4001,http://localhost:4002,http://localhost:4003"

PAGE = """
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Resultados - IPN</title>
  <style>
    :root { --guinda: #7a1e3a; --guinda-oscuro: #591530; --gris: #4a4a4a; }
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
      max-width: 520px;
      width: 90%;
      margin-top: 40px;
      padding: 32px;
      border-radius: 10px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    }
    .row { margin-bottom: 18px; }
    .row .label { display: flex; justify-content: space-between; font-weight: bold; color: var(--gris); margin-bottom: 4px; }
    .bar-bg { background: #eee; border-radius: 6px; overflow: hidden; height: 22px; }
    .bar-fill { background: var(--guinda); height: 100%; transition: width 0.3s; }

    .total { margin-top: 20px; font-weight: bold; color: var(--gris); text-align: center; }
    .warning { margin-top: 20px; padding: 14px; border-radius: 6px; background: #fff3cd; color: #856404; border: 1px solid #ffe08a; }
    .error { margin-top: 20px; padding: 14px; border-radius: 6px; background: #f8d7da; color: #721c24; border: 1px solid #f1b6bc; }

    a.refresh {
      display: inline-block;
      margin-top: 24px;
      background: var(--guinda);
      color: white;
      padding: 10px 18px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: bold;
    }
    a.refresh:hover { background: var(--guinda-oscuro); }

    .logo-izq { position: absolute; top: 50%; left: 20px; transform: translateY(-50%); height: 74px; }
    .logo-der { position: absolute; top: 50%; right: 20px; transform: translateY(-50%); height: 74px; }
  </style>
</head>
<body>
  <header>
    <img class="logo-izq" src="/static/logo_upiita.png" alt="UPIITA">
    <h1>Resultados de la Votacion</h1>
    <p>Instituto Politecnico Nacional &mdash; UPIITA</p>
    <img class="logo-der" src="/static/logo_ipn.png" alt="IPN">
  </header>

  <div class="card">
    {% if error %}
      <div class="error">{{ error }}</div>
    {% else %}
      {% for r in results %}
        <div class="row">
          <div class="label">
            <span>{{ r.label }}</span>
            <span>{{ r.count }} voto(s)</span>
          </div>
          <div class="bar-bg">
            <div class="bar-fill" style="width: {{ r.percent }}%;"></div>
          </div>
        </div>
      {% else %}
        <p>Todavia no hay votos registrados.</p>
      {% endfor %}

      <div class="total">Total de votos contados: {{ total }}</div>

      {% if warning %}
        <div class="warning">{{ warning }}</div>
      {% endif %}
    {% endif %}

    <div style="text-align:center;">
      <a class="refresh" href="/">Actualizar resultados</a>
    </div>
  </div>
</body>
</html>
"""


def label_for_vote(vote_dict):
    """Convierte el objeto de voto decodificado (ej. {'candidate': 'alice'})
    en un texto legible para mostrar."""
    if isinstance(vote_dict, dict) and "candidate" in vote_dict:
        return str(vote_dict["candidate"])
    return json.dumps(vote_dict, ensure_ascii=False)


@app.route("/")
def index():
    try:
        completed = subprocess.run(
            [sys.executable, TALLY_SCRIPT, "--ledger-urls", LEDGER_URLS],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except FileNotFoundError:
        return render_template_string(
            PAGE, error="No se encontro tally.py. Revisa la ruta configurada en TALLY_SCRIPT.",
            results=[], total=0, warning=None,
        )

    if completed.returncode not in (0, 2):
        return render_template_string(
            PAGE,
            error="No se pudo calcular el conteo. Verifica que los ledger-node esten corriendo "
                  f"(pnpm dev:all). Detalle: {completed.stderr.strip()}",
            results=[], total=0, warning=None,
        )

    try:
        report = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return render_template_string(
            PAGE, error="La respuesta de tally.py no se pudo interpretar.",
            results=[], total=0, warning=None,
        )

    total = report.get("total_counted_votes", 0)
    raw_tally = report.get("tally", [])

    results = []
    for entry in raw_tally:
        count = entry.get("count", 0)
        label = label_for_vote(entry.get("vote"))
        percent = round((count / total) * 100) if total else 0
        results.append({"label": label, "count": count, "percent": percent})

    results.sort(key=lambda r: r["count"], reverse=True)

    warning = None
    excluded = report.get("excluded_divergent_blocks") or []
    failures = report.get("integrity_failures") or []
    if excluded or failures:
        warning = (
            f"Atencion: {len(excluded)} bloque(s) divergente(s) y {len(failures)} "
            "fallo(s) de integridad fueron excluidos del conteo. Revisa el sistema antes de certificar."
        )

    return render_template_string(PAGE, error=None, results=results, total=total, warning=warning)


if __name__ == "__main__":
    app.run(debug=True, port=5002)
