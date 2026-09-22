# Secure Voting (Demo)

Un sistema de votación educativo que separa el secreto del voto de la integridad del libro de registro (*ledger*) a través de procesos independientes.

Esto demuestra por qué un único registro encadenado por hashes no es, por sí solo, una blockchain: el consenso entre múltiples nodos es lo que permite detectar manipulaciones.

## Arquitectura

```
eligibility-authority (Node.js, instancia única)
  - padrón de votantes (SQLite)
  - emite tokens de votación firmados y de un solo uso
  - nunca ve el contenido del voto

voter-client (CLI en Python)
  - genera un par de claves efímero localmente, nunca enviado a ningún servidor
  - cifra (AES-GCM + RSA-OAEP) y firma (RSA-PSS) el voto
  - envía el paquete cifrado a cualquier ledger-node

ledger-node x N (Node.js, un proceso por puerto; un "primary", el resto "replica")
  - primary: verifica la firma del token de votación y que no haya sido
    utilizado, añade el voto como un bloque y lo transmite a cada réplica
  - replica: valida de forma independiente cada bloque transmitido antes de
    añadirlo; nunca confía ciegamente en el primary
  - todos los nodos: /sync compara cadenas entre pares e indica divergencias;
    ningún nodo posee clave alguna capaz de descifrar un voto

tally-authority (Python, servicio independiente)
  - el único poseedor de la clave privada de descifrado de la elección
  - lee la cadena consolidada a través de la API de los ledger-nodes
  - descifra y realiza el recuento tras el cierre de la votación
  - no participa en el consenso del libro de registro

```

## Estructura del repositorio

```
apps/
  eligibility-authority/    Aplicación Express — padrón de votantes y emisión de tokens de votación
  ledger-node/              Aplicación Express — se ejecuta N veces, un puerto por nodo
services/
  tally-authority/          Servicio Python — clave de descifrado de la elección + recuento
tools/
  voter-client/              CLI en Python — emite un voto
packages/
  shared/                    JS: hashing canónico, esquema de bloques, consenso
docs/
  THREAT_MODEL.md            Qué protege este sistema y qué deja explícitamente fuera de alcance

```

## Estado del proyecto

Implementado actualmente:

* `packages/shared` — serialización JSON canónica, hashing de bloques, verificaciones de integridad de la cadena y detección de divergencias por mayoría de hash. La suite de pruebas cubre el escenario de "manipulación sofisticada": una cadena localmente consistente pero que difiere de la red.
* `apps/eligibility-authority` — padrón de votantes (SQLite), credenciales de votación firmadas con Ed25519 y con tiempo limitado, emisión libre de condiciones de carrera (transacción síncrona única) y reemisión idempotente de credenciales no expiradas. Consulta `apps/eligibility-authority/README.md` para conocer la relación de compromiso de `has_voted` al momento de la emisión, su costo operativo y un punto de extensión de administración sugerido (no implementado) para el equipo.
* `apps/ledger-node` — libro de registro replicado primary/replica. El primary acepta votos y propone bloques; cada réplica valida de forma independiente cada bloque transmitido (continuidad de la cadena, corrección del hash, firma) antes de añadirlo. Dos mecanismos complementarios de detección de manipulaciones —autenticación de firma local y comparación por mayoría entre nodos— están documentados y demostrados en vivo en `apps/ledger-node/README.md`, incluyendo un recorrido reproducible con `curl` para escenarios de "réplica comprometida" y "primary comprometido".
* `tools/voter-client` — CLI en Python. Genera un par de claves Ed25519 efímero por voto (solo en memoria, nunca se persiste ni transmite), cifra el voto con AES-GCM, envuelve la clave AES con la clave pública RSA-OAEP de la elección (obtenida de `tally-authority`), firma el paquete y lo envía al primary. Consulta `tools/voter-client/README.md`.
* `services/tally-authority` — único poseedor de la clave de descifrado RSA de la elección. Sirve su clave pública sobre HTTP desde el inicio de la votación (`GET /public-key`, usando `http.server` de la librería estándar, sin frameworks); tras el cierre de la votación, un script CLI independiente obtiene la cadena **en bruto** (*raw*) de cada `ledger-node` configurado de forma independiente, calcula el acuerdo por mayoría bloque por bloque (sin confiar nunca en el `/sync` de ningún nodo) y cuenta únicamente los bloques que alcancen la mayoría. Cualquier bloque que no la alcance es excluido del recuento y reportado explícitamente, nunca descartado en silencio. Consulta `services/tally-authority/README.md`.

Todo lo descrito anteriormente está implementado y cubierto por pruebas.

## Configuración inicial

Instalación por única vez:

```bash
pnpm install
pip install -r tools/voter-client/requirements.txt
pip install -r services/tally-authority/requirements.txt

```

`eligibility-authority` lee su configuración desde variables de entorno (consulta `apps/eligibility-authority/.env.example`); cópialo a `.env` en ese directorio para sobrescribir los valores por defecto localmente. Los servicios de Python no forman parte del workspace de pnpm; cada uno tiene su propio `requirements.txt`, documentado en su propio README.

```bash
pnpm test                               # ejecuta el script de prueba de cada paquete JS del workspace
pytest tools/voter-client services/tally-authority   # suites de prueba de Python

```

## Ejecución del sistema completo

**Iniciar todos los servicios requiere un solo comando:**

```bash
pnpm dev:all

```

Esto inicia `eligibility-authority` (:4000), el clúster de 3 nodos de `ledger-node` (:4001–4003, un primary + dos réplicas) y el servidor de clave pública de `tally-authority` (:5000): cinco procesos en un solo comando. Es seguro volver a ejecutarlo: la generación del par de claves de la elección está incluida pero es idempotente (el generador se rehúsa a sobrescribir un par de claves existente, por lo que nunca regenerará una en silencio; consulta `services/tally-authority/README.md` para entender por qué esa clave específica se trata de forma distinta a cualquier otra clave del sistema).

**Emitir un voto y realizar el recuento permanecen como comandos deliberadamente separados**; esto no es una limitación, es el propósito: una elección real cuenta con múltiples votantes independientes actuando a lo largo del tiempo, y un único paso de recuento que solo ocurre tras el cierre de la votación. Colapsar ambos en el comando de inicio distorsionaría lo que el sistema realmente demuestra.

```bash
# 1. Obtener una credencial de votación real para un votante (existen tres votantes de demostración:
#    VOTANTE001, VOTANTE002, VOTANTE003)
curl -s -X POST http://localhost:4000/identify \
  -H "Content-Type: application/json" \
  -d '{"voter_id":"VOTANTE001"}' \
  | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['credential']))" \
  > credential.json

# 2. Emitir el voto (cualquier objeto JSON) a través del primary
echo '{"candidate":"alice"}' | python tools/voter-client/voter_client.py \
  --primary-url http://localhost:4001 \
  --tally-authority-url http://localhost:5000 \
  --credential-file credential.json

# Repetir los pasos 1 y 2 para VOTANTE002, VOTANTE003, ... para tantos votantes como desees

# 3. Tras el cierre de la votación, realizar el recuento (consulta cada ledger-node de forma independiente)
python services/tally-authority/tally.py \
  --ledger-urls http://localhost:4001,http://localhost:4002,http://localhost:4003

```

La salida del recuento informa tanto los totales de votos como cualquier bloque que no haya alcanzado el acuerdo por mayoría entre los nodos. Consulta `services/tally-authority/README.md` para ver cómo se visualiza cuando un nodo ha sido alterado, y `apps/ledger-node/README.md` para conocer el endpoint de demostración `POST /admin/tamper` utilizado para simularlo (uso local/educativo únicamente; no tiene autenticación, nunca debe exponerse en otro entorno).

## Reiniciar todos los servicios

Utiliza estos comandos o elimina los archivos manualmente:

```bash
rm -rf apps/eligibility-authority/data apps/eligibility-authority/keys
rm -rf apps/ledger-node/data apps/ledger-node/keys
rm -rf services/tally-authority/keys

```

## Puntos de extensión: delimitación de la demo para una ejecución real

Tres aspectos se encuentran deliberadamente sin delimitar en este momento; esto es adecuado para una demostración, pero vale la pena tenerlo en cuenta antes de ejecutarlo con un grupo real:

* **El padrón de votantes es una lista blanca definida en código (*hardcoded*).** `apps/eligibility-authority/src/db.js` inserta únicamente a `VOTANTE001`–`VOTANTE003` (el arreglo `DEMO_VOTERS`) la primera vez que su base de datos está vacía. No es un rango, por lo que `VOTANTE010` simplemente no es elegible (`POST /identify` retorna `403`). Para admitir un padrón propio: edita `DEMO_VOTERS` directamente o añade una ruta de importación real (un endpoint `POST /admin/import-voters` o un script de inicialización que lea un CSV), siguiendo el mismo patrón de acción administrativa auditada que ya se utiliza para el endpoint de reinicio de `has_voted` sugerido (no implementado) en `apps/eligibility-authority/README.md`. Actualmente no existe una forma integrada de autoasignar IDs de votante; esa lógica también residiría aquí.
* **Los dos parámetros de URL en `voter-client` son independientes y ambos son críticos.** `--primary-url` es donde se *envía* el voto (cualquier `ledger-node` configurado con `ROLE=primary`); `--tally-authority-url` solo se utiliza para *obtener la clave de descifrado* antes de realizar el envío. Apuntar cualquiera de los dos al lugar equivocado fallará en una etapa distinta (`ElectionKeyFetchError` frente a `NetworkError`/`VoteRejectedError`); consulta `tools/voter-client/README.md`.
* **La carga útil (*payload*) del voto es un JSON sin restricciones.** Nada en `ledger-node` ni en `tally-authority` valida su contenido contra una lista de candidatos. Por diseño, ninguno de los dos componentes inspecciona el contenido del voto antes de que `tally-authority` lo descifre tras el cierre. La estructura clave/valor que se le pase a `voter-client` por entrada estándar (*stdin*) será exactamente lo que se cuente, de forma literal. Para restringir la votación a una lista fija de candidatos, añade dicha validación en el lado del cliente, en `tools/voter-client/voter_client.py`, antes del cifrado. Validar más adelante en `ledger-node` o `tally-authority` implicaría que alguno de ellos deba entender el contenido del voto, rompiendo la opacidad sobre la cual están construidos ambos componentes.

## Nota de despliegue para el equipo

Los nodos del libro de registro se ejecutan actualmente como procesos estándar de Node en `localhost`, en puertos diferentes y sin contenedorización. Esta fue una simplificación deliberada para mantener el enfoque educativo en la lógica de consenso en lugar de la red entre contenedores. Si se desea migrar esto a Docker (un contenedor por nodo de registro, una red de Docker en lugar de puertos en `localhost`), es un paso siguiente razonable que no requiere cambios en `packages/shared`, sino únicamente en la forma en que se inicia cada proceso de `ledger-node` y cómo se comunican los pares (*peers*).
