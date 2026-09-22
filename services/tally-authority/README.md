# tally-authority

La única pieza de este sistema que posee una clave capaz de descifrar un voto. Se compone de dos partes independientes que se ejecutan en momentos distintos:

* **`server.py`** — un servidor persistente de clave pública. Se ejecuta desde antes de que abra la votación, sirve `GET /public-key` (usando `http.server` de la librería estándar, sin frameworks; es una respuesta estática única) y no realiza ninguna tarea relacionada con descifrado. `voter-client` obtiene la clave directamente desde aquí.
* **`tally.py`** — un script CLI activado manualmente, ejecutado una sola vez por un administrador tras el cierre de la votación. Aquí es donde realmente ocurre el descifrado.

## Por qué el par de claves de la elección se genera de forma distinta a cualquier otra clave

Cada una de las demás claves de este sistema (`ensureEd25519KeyPair` en `packages/shared`) sigue el patrón "generar en silencio si no existe". Esto es adecuado para ellas al ser claves de identidad de servicio: si un nodo de registro pierde su clave y se genera una nueva, es un evento recuperable. La clave de la elección no funciona así. Si se vuelve a generar en algún momento, cada voto cifrado previamente contra la clave pública anterior se vuelve permanentemente imposible de descifrar, causando una pérdida irreversible de datos y no una simple inconveniencia operativa.

Por lo tanto: `scripts/generate-election-keys.py` es un paso de configuración explícito, independiente y de una sola vez, que **se rehúsa a sobrescribir** un par de claves existente en lugar de regenerarlo en silencio. Tanto `server.py` como `tally.py` fallan de forma estricta al inicio si los archivos de clave no están presentes; ninguno de los dos generará jamás una clave por sí mismo.

```bash
python scripts/generate-election-keys.py
# Escribe keys/election_private.pem y keys/election_public.pem
# (keys/ está incluido en .gitignore; realiza una copia de respaldo de la clave privada en un lugar seguro)

```

## Ejecución del servidor de clave pública

```bash
python server.py             # GET /public-key en el puerto :5000 (usar la variable de entorno PORT para cambiarlo)

```

## Ejecución del recuento (*tally*)

```bash
python tally.py --ledger-urls http://localhost:4001,http://localhost:4002,http://localhost:4003

```

Secuencia de ejecución en orden:

1. Obtiene el `GET /chain` **en bruto** (*raw*) de cada URL proporcionada; nunca utiliza el resultado del `/sync` propio de un nodo, ni únicamente la copia de un solo nodo.
2. Calcula de forma autónoma el acuerdo por mayoría, índice de bloque por índice de bloque (con 3 nodos: al menos 2 de 3 deben reportar el mismo hash en dicho índice). Esta derivación ocurre completamente dentro de `tally.py`/`majority.py`; no se confía en la afirmación de consenso de ningún nodo.
3. Para cada bloque que alcance la mayoría: lo descifra (RSA-OAEP desenvuelve la clave AES, AES-GCM descifra el voto y se verifica la firma Ed25519 efímera) y lo añade al recuento.
4. Para cada bloque que **no** alcance la mayoría: queda excluido del recuento y se lista explícitamente en `excluded_divergent_blocks` con el desglose completo de hashes por nodo, sin descartarse en silencio jamás.
5. Imprime un informe en JSON y finaliza con código `0` si todo estuvo correcto, o con código `2` si algún bloque fue excluido o falló la verificación de integridad (imprime el recuento de todas formas; el código `2` significa "revisar antes de certificar").

### Aspecto del informe cuando un nodo ha sido alterado

Utilizando el endpoint exclusivo de demostración `POST /admin/tamper` de `apps/ledger-node` (consulta su README):

* **Un nodo alterado, los otros dos coinciden:** el nodo alterado es simplemente superado en votación; el recuento no se ve afectado y ni siquiera aparece en `excluded_divergent_blocks` debido a que *sí* se alcanzó una mayoría (la cual no incluyó la copia de ese nodo).
* **Dos nodos alterados de forma distinta (división genuina de 3 vías, sin mayoría en ningún lado):** el bloque afectado y todos los bloques posteriores (la alteración se propaga hacia adelante a través de `previousHash`) quedan excluidos. `tally.py` finaliza con código `2` y el informe muestra exactamente qué nodo contenía qué hash en cada índice divergente.

## Pruebas (*Tests*)

```bash
pytest

```

Cubre la lógica de acuerdo de `majority.py` (unánime, 2 de 3, división de 3 vías, cadenas cortas o faltantes) y la ruta de descifrado y verificación de `crypto_utils.py` contra el formato de transmisión real producido por `tools/voter-client`.
