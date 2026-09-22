# Modelo de amenazas (*Threat Model*)

Este documento existe para que nadie tenga que aceptar afirmaciones comerciales como "seguro" o "anónimo" al pie de la letra. Establece contra qué protege este sistema, contra qué no y por qué se aceptó cada simplificación dentro de un alcance educativo.

## Contra qué protege este sistema

* **Que un operador de `ledger-node` lea el contenido de un voto.** Los nodos del libro de registro únicamente poseen el paquete de voto cifrado e opaco. La clave AES está cifrada con la clave pública de la elección y solo `tally-authority` posee la clave privada correspondiente.
* **Que un operador de `ledger-node` suplante a un votante.** Los pares de claves del votante se generan dentro de `voter-client`, en la máquina/proceso del propio votante, y nunca se transmiten. Ningún proceso del lado del servidor llega a poseer la clave privada de un votante. (El prototipo anterior violaba esto: derivaba y almacenaba las claves de los votantes en el servidor, lo que hacía falsa la afirmación de "anonimato". Esta reescritura existe específicamente para corregir eso).
* **Que un único `ledger-node` reescriba el historial en silencio.** Un nodo con acceso de escritura local puede alterar su propia copia y recalcular correctamente cada hash tras la edición; la validez interna de la cadena no puede detectar esto por sí sola. Lo que lo detecta es `detectDivergence` en `packages/shared`: comparar la cadena de un nodo contra las cadenas de sus pares (*peers*) e indicar divergencias. Consulta `packages/shared/src/consensus.test.js` para ver el escenario exacto para el que fue diseñado.
* **Doble voto mediante un token de votación duplicado.** Los nodos del libro de registro rechazan un voto cuyo `ballot_token_hash` ya aparezca en la cadena.
* **Doble voto mediante un token de elegibilidad duplicado.** `eligibility-authority` no emitirá un segundo token a un votante que ya posea uno, comprobado dentro de una transacción explícita para cerrar la condición de carrera (*race condition*) presente en el prototipo anterior.

## Contra qué NO protege este sistema, y por qué

* **Que `eligibility-authority` correlacione la identidad con el voto mediante patrones temporales.** `eligibility-authority` necesariamente sabe qué `voter_id` recibió qué token en el momento de la emisión. Si registrara esa asociación con una marca de tiempo y más tarde la correlacionara con el momento en que el voto de ese token apareció en la cadena, podría inferir, con cierto grado de certeza, quién votó por qué, a pesar de no ver nunca el contenido del voto directamente. La solución criptográficamente completa para esto es un esquema de firmas ciegas (*blind signatures*, donde la autoridad firma un token sin ver su forma final y utilizable). Esto está **explícitamente fuera del alcance** de este proyecto educativo: representa un incremento sustancial en la complejidad respecto a los objetivos de enseñanza del proyecto (consenso y evidencia de alteración) y se señala aquí abiertamente en lugar de ocultarse. Cualquiera que extienda este proyecto hacia un uso en el mundo real debe resolver esto primero.
* **Que la mayoría de los nodos del libro de registro coludan.** `detectDivergence` implementa "acuerdo de hash por mayoría", no tolerancia a fallos bizantinos (BFT) con prueba criptográfica de mal comportamiento. Una mayoría coordinada puede superar en votación a una minoría de nodos honestos sin que nadie sea marcado.
* **Ataques a nivel de red.** Los nodos del libro de registro se comunican mediante HTTP plano en `localhost` para esta demostración, sin TLS ni autenticación mutua entre pares. Esto es aceptable para una simulación educativa local; no lo sería para un despliegue real.
* **Compromiso de `tally-authority`.** Existe una única clave de descifrado para la elección (sin esquema de umbral / *non-threshold*). Cualquiera que comprometa `tally-authority` antes del recuento puede descifrar todos los votos. El descifrado por umbral (*threshold decryption*, que divide la clave entre múltiples custodios) resolvería esto y es una extensión razonable, no implementada aquí.
* **Coacción o compra de votos.** Ningún control técnico en este sistema impide que un votante demuestre su voto a un tercero (por ejemplo, conservando su clave privada efímera y el recibo). La ausencia de recibos (*receipt-freeness*) es una propiedad independiente y más compleja que los sistemas de voto electrónico reales abordan explícitamente y que este proyecto no intenta cubrir.

## Decisiones de diseño que este sistema mantiene deliberadamente simples

* El consenso es por acuerdo de hash por mayoría, no PoW, PBFT ni Raft.
* Los nodos del libro de registro se ejecutan como procesos locales en diferentes puertos, no en contenedores (consulta la nota de despliegue en el README principal para una ruta de migración a Docker).
* Una sola clave para la elección, no generación distribuida ni por umbral de claves.
