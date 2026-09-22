# ledger-node

Un libro de registro (*ledger*) replicado y encadenado por hashes para paquetes de votos cifrados y opacos. Se ejecuta como un clúster pequeño: un `primary` y N `replica`s.

## Por qué un solo escritor (*single-writer*) y no totalmente descentralizado

Una versión anterior de este diseño permitía que cualquier nodo aceptara un voto de forma independiente. Esto no converge: tres nodos, cada uno añadiendo cualquier voto que casualmente les llegara, producen tres cadenas genuinamente diferentes incluso sin un solo comportamiento malicioso, porque no hay nada que ordene las escrituras. "Comparar hashes, gana la mayoría" carece de sentido si los nodos honestos difieren de forma rutinaria por defecto.

La solución: solo el `primary` acepta envíos de votos (`POST /votes`) y propone bloques. Este transmite cada nuevo bloque a cada par (*peer*) configurado (`POST /peer/blocks`). Cada réplica **valida de forma independiente** el bloque entrante antes de añadirlo; no confía en la palabra del primary, verifica lo siguiente:

1. que el bloque extienda el extremo actual de su propia cadena (`previousHash` coincide),
2. que el `hash` del bloque esté derivado correctamente de su propio contenido,
3. que la firma (`signature`) del bloque se verifique contra la clave pública conocida del primary,
4. que el `ballot_token_hash` del bloque no se haya visto previamente de forma local.

Si cualquiera de estas comprobaciones falla, la réplica rechaza el bloque y no lo añade. Consulta `src/replication.js`.

## Dos mecanismos de detección de manipulaciones, y por qué se necesitan ambos

**Mecanismo 1 — Autenticación de firma local.** Todo bloque que no sea el bloque génesis (*genesis block*) debe estar firmado por la clave privada del primary. Un atacante que comprometa una **réplica** obtiene el proceso de esa réplica y su propia clave Ed25519, nada más. Si reescribe la cadena local de la réplica, puede volver a calcular los hashes correctamente, pero no puede generar una firma que la clave pública del primary acepte, ya que no posee la clave privada del primary. Esto se detecta *localmente*, por el propio nodo alterado o por cualquiera que lea el resultado de su `/sync`, sin requerir comparación contra otros nodos.
Consulta `packages/shared/src/block.js` → `isChainAuthenticallySigned`.

**Mecanismo 2 — Comparación por mayoría entre nodos.** El Mecanismo 1 no puede detectar que el primary se comprometa *a sí mismo*: el primary posee su propia clave privada real, por lo que puede reescribir su propio historial y volver a firmarlo válidamente. Una autocomprobación contra su propia firma seguirá pasando. Lo único que detecta esto es comparar la cadena del primary contra las copias independientes que poseen las réplicas: si dos réplicas aún conservan el bloque original y el primary ahora contiene algo diferente, el acuerdo de hash por mayoría señalará al primary como el nodo divergente. Consulta `packages/shared/src/consensus.js` → `detectDivergence`, invocado desde `src/sync.js`.

Verificado en vivo, no solo en pruebas unitarias; consulta los dos escenarios a continuación.

## Ejecución del clúster de demostración

```bash
# Desde la raíz del repositorio, con eligibility-authority ejecutándose en el puerto :4000
pnpm --filter @secure-voting/ledger-node dev
# Inicia node-a (primary, :4001), node-b y node-c (replicas, :4002/:4003)

```

## Reproducción manual de ambos escenarios de alteración

```bash
# 1. Emitir un voto real a través del primary (consulta el README principal para el flujo completo
#    identify -> credential -> vote) y luego:

# Escenario A — Comprometer una RÉPLICA directamente
curl -X POST http://localhost:4002/admin/tamper \
  -H "Content-Type: application/json" \
  -d '{"blockIndex":1,"dataPatch":{"ballot_token_hash":"FORGED"}}'

curl -X POST http://localhost:4002/sync
# -> selfAuthenticallySigned: false — detectado localmente de forma instantánea

# Escenario B — Comprometer el propio PRIMARY
curl -X POST http://localhost:4001/admin/tamper \
  -H "Content-Type: application/json" \
  -d '{"blockIndex":1,"dataPatch":{"ballot_token_hash":"REWRITTEN"}}'

curl -X POST http://localhost:4001/sync
# -> selfAuthenticallySigned: true  (posee su propia clave real — ¡pasa la prueba!)
# -> divergentNodeIds incluye el nodeId del propio primary de todas formas,
#    porque las réplicas no alteradas aún conservan el bloque original

```

`POST /admin/tamper` es **exclusivo para demostración**. Existe para hacer que los escenarios de alteración anteriores sean reproducibles bajo demanda; nunca debe exponerse fuera de un entorno educativo local y no cuenta con autenticación: cualquiera que pueda alcanzar el puerto HTTP de un nodo puede reescribir su historial local a través de él.

## Variables de entorno

Consulta `.env.example`. Una convención importante a destacar: en una **réplica**, la primera entrada de `PEERS` debe ser la URL del primary, ya que cumple la doble función de ser el destino de redirección para llamadas `POST /votes` extraviadas y el lugar desde donde la réplica obtiene la clave pública del primary durante el inicio. En el **primary**, `PEERS` debe listar sus réplicas, que es a quienes transmite los nuevos bloques. Configurar esto al revés (el primary configurado sin pares) no produce ningún error: `broadcastFailures` simplemente regresa vacío al no haber a quién transmitir, aparentando un resultado exitoso. Este error exacto ocurrió durante la construcción del servicio; `dev-cluster.js` ahora lo configura correctamente, pero tenlo en cuenta si reconfiguras los pares manualmente.

## Aspectos no implementados aquí

* Selección de líder (*leader election*) o conmutación por error del primary (*primary failover*): si el primary se cae, no ocurre ninguna promoción automática. Un despliegue en producción requeriría esto; está fuera del alcance del objetivo educativo (demostrar la detección de alteraciones).
* Recuperación automática de un nodo divergente (por ejemplo, que un nodo marcado se resincronice a sí mismo desde la mayoría): `/sync` solo reporta, no ejecuta acciones. Construir un endpoint de recuperación automática es una extensión razonable dejada para el equipo.
