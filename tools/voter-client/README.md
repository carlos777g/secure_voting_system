# voter-client

Una CLI en Python que emite un voto: toma una credencial de votación desde `eligibility-authority`, cifra un voto de modo que solo `tally-authority` pueda leerlo, firma el paquete cifrado y lo envía al `ledger-node` primario.

El par de claves de firma se genera desde cero en memoria para cada voto y se descarta inmediatamente después; nunca toca el disco ni se envía a ninguna parte. La propiedad `voter_public_key` en el paquete enviado existe para que quien descifre el voto más adelante pueda verificar que no fue alterado en tránsito. Dado que la clave se genera de forma nueva por cada voto, no porta ninguna identidad del votante.

## Configuración inicial

```bash
pip install -r requirements.txt

```

## Uso

```bash
echo '{"candidate":"alice"}' | python voter_client.py \
  --primary-url http://localhost:4001 \
  --tally-authority-url http://localhost:5000 \
  --credential-file credential.json

```

* `--primary-url` — URL base del `ledger-node` primario.
* `--tally-authority-url` — URL base de `tally-authority`, utilizada únicamente para obtener su clave pública (`GET /public-key`) para cifrar el voto; nunca ve el texto en plano.
* `--credential-file` — ruta a un archivo JSON con `{token, issued_at, expires_at, signature}`, tal como lo retorna el endpoint `POST /identify` de `eligibility-authority`.
* El voto en sí (cualquier objeto JSON) se lee desde la entrada estándar (**stdin**).

En caso de éxito, imprime el bloque añadido (JSON) en `stdout` y finaliza con código `0`. En caso de falla, imprime una línea en `stderr` con el formato `[ErrorType] (code): message` y finaliza con código `1`. Tipos de errores: `CredentialFileError`, `VoteInputError`, `ElectionKeyFetchError`, `NetworkError`, `VoteRejectedError`.

## Reproducción manual de un voto de extremo a extremo

```bash
# Desde la raíz del repositorio, con eligibility-authority (:4000), el clúster de
# desarrollo de ledger-node (:4001-4003) y el servidor de claves de tally-authority (:5000)
# ya en ejecución (consulta services/tally-authority/README.md para la configuración inicial)

# 1. Obtener una credencial real
curl -s -X POST http://localhost:4000/identify \
  -H "Content-Type: application/json" \
  -d '{"voter_id":"VOTANTE001"}' \
  | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['credential']))" \
  > credential.json

# 2. Emitir el voto a través del primary
echo '{"candidate":"alice","choice_id":1}' | python voter_client.py \
  --primary-url http://localhost:4001 \
  --tally-authority-url http://localhost:5000 \
  --credential-file credential.json

# 3. Confirmar que se replicó
curl -s http://localhost:4002/chain | python3 -m json.tool
curl -s http://localhost:4003/chain | python3 -m json.tool

# 4. Volver a votar con la misma credencial es rechazado
echo '{"candidate":"bob"}' | python voter_client.py \
  --primary-url http://localhost:4001 \
  --tally-authority-url http://localhost:5000 \
  --credential-file credential.json
# -> [VoteRejectedError] (400): this ballot token has already been used

```

## Pruebas (*Tests*)

```bash
pytest

```

Cubre el ciclo completo de cifrado y firma AES-GCM/RSA-OAEP/Ed25519 en `crypto_utils.py` y verifica que `canonical_json` coincida byte por byte con `canonicalStringify` de `packages/shared/src/canonical.js` utilizando accesorios (*fixtures*) generados a partir de la implementación en JS (sin dependencia de Node durante la ejecución de las pruebas; consulta el comentario sobre accesorios en `test_crypto_utils.py` para saber cómo regenerarlos si `canonical.js` cambia).

## Por qué la clave de la elección proviene de tally-authority y no de ledger-node

`voter-client` obtiene la clave pública RSA-OAEP de la elección directamente del endpoint `GET /public-key` de `tally-authority`, siguiendo el mismo patrón que `eligibility-authority` y cada `ledger-node` ya utilizan para publicar sus propias claves públicas. `ledger-node` nunca sirve esta clave: no la custodia, y hacer que "respalde" una clave perteneciente a un servicio diferente e independiente sería exactamente el tipo de acoplamiento de API o sistema de archivos entre servicios que este proyecto evita en otros puntos. Consulta `services/tally-authority/README.md` para conocer cómo se genera y sirve el par de claves.
