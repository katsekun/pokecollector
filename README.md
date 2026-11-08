# Pokecollector

Pokédex personal de cartas Pokémon TCG. Angular 22, componentes standalone, Signals, SCSS/BEM y temas claro/oscuro. Funciona localmente y ofrece sincronización opcional mediante Firebase Authentication y Cloud Firestore.

## Licencia y terceros

El código original y los marcadores neutrales propios se ofrecen bajo [PolyForm Noncommercial 1.0.0](LICENSE). Es código fuente disponible para los usos no comerciales permitidos por esa licencia, con sus excepciones y condiciones; no es una licencia open source aprobada por la OSI.

Required Notice: Copyright (c) 2026 katsekun

Las dependencias, fuentes, datos e imágenes de terceros conservan sus propios derechos y condiciones. La licencia del proyecto no los sustituye ni concede permisos sobre ilustraciones o marcas Pokémon. Consulta [los avisos de terceros](THIRD_PARTY_NOTICES.md) antes de redistribuir o desplegar. La atribución, la gratuidad y el aviso de no afiliación no sustituyen los permisos necesarios.

## Arranque

Requiere Node `^22.22.3`, `^24.15.0` o `>=26.0.0`, y npm. Desde esta carpeta:

```sh
npm ci
npm start
```

Si tu Node global no es compatible, puedes arrancar con Node 22.22.3 aislado, sin modificarlo:

```sh
npm run start:compatible -- --port 4200
```

Dirección local: http://127.0.0.1:4200. Si ese puerto está ocupado, utiliza otro con `--port`.

Para reinstalar dependencias con Node aislado en Windows PowerShell:

```powershell
npm exec --yes --package=node@22.22.3 -- node (Join-Path (Split-Path (Get-Command npm.cmd).Source) 'node_modules/npm/bin/npm-cli.js') ci
```

## Colección

- 1.545 entradas para 1.025 especies nacionales: todas las formas registradas en la revisión de PokéAPI, excepto Gigamax. Las formas regionales, megas, primigenias, alternativas y cosméticas tienen entradas independientes aunque compartan número nacional. Se incluyen aunque todavía no tengan una carta TCG identificable.
- Una carta favorita por entrada/forma. Los estados «quiero» y «tengo» son excluyentes; solo «tengo» con forma confirmada cuenta para el progreso. La generación de las variantes es la de su introducción; las principales conservan la generación de la especie.
- Sustituir una selección requiere confirmación y no conserva el estado ni los importes de la anterior.
- Las cartas se consultan automáticamente en TCGdex al abrir cada Pokémon. No se distribuye ningún catálogo ni imagen de cartas de muestra; no se inventan datos para completar la cobertura.
- Full Art, Illustration Rare y Special Illustration Rare son categorías distintas. El número de especies no depende de la cobertura del catálogo de cartas.
- Álbumes con referencias a selecciones. Eliminar un álbum o quitar uno de sus miembros no elimina cartas de la colección. Eliminar una selección sí limpia sus referencias.
- Precio pagado y valoración manual en EUR, almacenados en céntimos. La valoración no es una cotización de mercado; un valor desconocido no equivale a cero.

La colección empieza vacía. La Pokédex muestra tus cartas elegidas; las formas sin selección permanecen pendientes. No se descargan cartas para todas las entradas al abrir la rejilla. Se puede filtrar por formas principales, regionales, megas y otras formas. El número mostrado y buscado es siempre el nacional, no el identificador interno.

«Todas las formas» significa las registradas por PokéAPI: no genera una entrada por shiny, acabado de carta, ni por cada patrón procedural de Spinda. La exclusión Gigamax está aislada en el generador para poder cambiarla más adelante; la forma Eternamax de Eternatus no es una Gigamax y se conserva.

## Catálogo TCGdex

Abrir una ficha carga automáticamente las cartas del Pokémon en español y muestra el catálogo desplegado. Cambiar de idioma inicia una nueva consulta. Si aún no tienes carta elegida, se previsualiza la primera carta de forma verificada sin guardarla; una selección existente se conserva. Las consultas se hacen por número nacional, en páginas de 48 resultados, y se filtran por los nombres localizados de cada forma. Hay un máximo de tres peticiones simultáneas de detalles. «Cargar más» amplía los resultados; las ilustraciones especiales verificadas aparecen primero entre las cartas cargadas, no en todo el catálogo remoto.

TCGdex no identifica siempre las formas explícitamente: una carta «M Charizard EX», un Unown sin letra o un Alcremie sin descripción no bastan para decidir qué entrada representan. Los resultados sin correspondencia inequívoca están ocultos por defecto bajo «Mostrar cartas sin forma verificada»; seleccionarlos requiere confirmar manualmente la forma. Las cartas VMAX también requieren revisión y no se usan como prueba automática de una forma. Una página sin coincidencias no significa que no haya cartas en páginas posteriores.

Según la [FAQ oficial](https://tcgdex.dev/faq), la API es gratuita, no requiere clave y no publica límites rígidos de peticiones. Esto no implica disponibilidad ilimitada ni garantiza que las condiciones no cambien. No se ha contratado ningún servicio. Las respuestas se cachean en memoria durante diez minutos, incluidas las consultas simultáneas idénticas; no se descarga toda la base ni se guarda esta caché en tu colección.

Se ofrecen los diez idiomas publicados por el proveedor, con distinta cobertura. Pocket se excluye silenciosamente por los identificadores de sus expansiones o por la ruta de imagen `tcgp`, sin aumentar el contador de resultados omitidos. La lista de expansiones procede de la serie `tcgp` de TCGdex y debe revisarse cuando se publiquen nuevos sets. Solo los resultados sin correspondencia nacional o de forma se contabilizan como omitidos. Las cartas físicas sin imagen válida se conservan y se pueden seleccionar. Primero se busca el mismo ID en inglés y francés de TCGdex, verificando expansión, número y especie; se conserva el idioma y la procedencia de la carta original. Cada consulta opcional tiene un timeout de cinco segundos y los detalles se cachean diez minutos. Si todavía no hay imagen, «Usar imágenes de TCGplayer» permite utilizar un ID de producto válido facilitado por TCGdex. Esta opción está activada por defecto; se puede desmarcar durante la sesión y vuelve a estar marcada al recargar la aplicación. Las imágenes de referencia indican proveedor y, cuando se conoce, idioma; una imagen de TCGplayer puede tener otro idioma. Sin imagen se muestra el marcador geométrico propio y la carta queda al final de los resultados cargados. Si falla la carga de una imagen también se utiliza el marcador. El respaldo conserva `imageProvider` e `imageLanguage` cuando están disponibles, o `image: null` si no hay imagen; nunca guarda el marcador como ilustración real. Las antiguas URLs de TCGplayer solo se cargan con la opción activada y sus datos permanecen intactos al desactivarla. Las rarezas originales se conservan; solo se normalizan categorías reconocidas. «Ultra Rare» solo se interpreta como Full Art en las expansiones Scarlet & Violet, no de forma universal.

Si una URL de imagen existe pero falla al cargar, también se continúa con las alternativas en inglés/francés y, con la opción activada, TCGplayer. Las URLs que ya fallaron no se repiten durante esa recuperación; si se agotan las alternativas se conserva el marcador. La recuperación se comparte entre vistas mediante caché, respeta el límite de tres consultas simultáneas de detalles e ignora respuestas tardías al cambiar de carta o desactivar el proveedor. Durante la búsqueda puede aparecer temporalmente el marcador. Si también falla el marcador, se muestra «Imagen no disponible» sin iniciar más reintentos.

Consultar o previsualizar una carta no modifica la colección. Sus identificadores incluyen proveedor e idioma (`tcgdex:es:sv03.5-166`). Cada selección guarda el identificador de entrada y su número nacional. Recuperar una imagen solo cambia su presentación, no sobrescribe la carta elegida ni sus importes. Un error de red no borra cartas ni precios y permite reintentar. Las imágenes usan su URL de origen y necesitan conexión.

## Referencia de precios

La ficha muestra, cuando TCGdex los proporciona, la tendencia y el precio medio general de Cardmarket en EUR, además de las medias de 24 horas, 7 días y 30 días y la fecha de actualización del proveedor. La media de 24 horas no es necesariamente la última venta. TCGdex no desglosa estos valores por idioma y la correspondencia con el acabado o la edición concreta no está verificada; pueden no coincidir con una carta española, inglesa, japonesa o china en particular. Los valores ausentes, no válidos o cero se muestran como no disponibles, sin inventar una cotización.

La consulta usa el detalle TCGdex de la carta seleccionada y su caché de diez minutos, no una API independiente de Cardmarket. No se asigna un precio de otra carta ni se calcula un total automático de colección. Las referencias son temporales y no modifican el precio pagado, la valoración manual, los respaldos ni Firestore. Una selección guardada se consulta de nuevo al abrir su ficha; si falla la petición, se puede reintentar sin afectar a la colección.

«Buscar en Cardmarket» abre el buscador externo con el nombre del Pokémon y el número de la carta. Puede mostrar varias ediciones o no encontrar una equivalencia, especialmente para cartas asiáticas; comprueba el producto antes de usarlo. No es un enlace directo a una ficha: TCGdex proporciona un ID de producto, pero no la ruta de Cardmarket. Los filtros de idioma y país no se conservan al entrar en un producto desde los resultados, por lo que deben seleccionarse en Cardmarket.

Documentación de TCGdex: [integración de mercados y ejemplos](https://tcgdex.dev/markets-prices), [campos de precios de carta](https://tcgdex.dev/reference/card#pricing) y [preguntas frecuentes sobre precios y correspondencias](https://tcgdex.dev/faq). El acceso gratuito no garantiza disponibilidad ni otorga permisos adicionales sobre datos de terceros; revisa las condiciones de Cardmarket y TCGdex antes de una publicación pública.

## Guardado y respaldos

La aplicación siempre conserva una copia local en `localStorage`, clave `pokecollector.collection.v1`. Sin iniciar sesión, funciona íntegramente en local. Al iniciar sesión con Google se fusionan la copia local y la nube: se conservan entradas únicas de ambas, la selección local prevalece si ambas tienen una entrada para la misma forma y los miembros de álbumes se unen. La colección resultante se escribe primero en local y después se sincroniza automáticamente con Firestore. Un error o unas reglas todavía cerradas no bloquean la colección local. Al cerrar sesión, el modo local continúa disponible.

La integración Firebase está configurada para el proyecto `pokecollector-8c894`; su `apiKey` es configuración pública de cliente, no una credencial administrativa. Firebase Auth y Firestore se cargan de forma diferida. No se incluyen claves de servicio ni un backend propio. Se presupone el plan Spark sin facturación. El SDK de producción fija `@grpc/grpc-js` en una versión corregida mediante `overrides`.

## Activar sincronización Firebase

1. En Firebase Authentication, habilita Google y autoriza `localhost`, `127.0.0.1` y `katsekun.github.io`.
2. Crea Firestore en Standard, modo producción. Mantén inicialmente el acceso denegado.
3. Ejecuta la aplicación y pulsa «Entrar con Google». Inicia sesión con tu cuenta personal. La colección local permanece disponible; Firestore mostrará un error de permiso mientras el UID de propietario siga sin configurar.
4. Comprueba que el UID mostrado al iniciar sesión coincide con el propietario configurado en `firestore.rules`. Publica el contenido completo de ese archivo en Firebase Console → Firestore Database → Rules → Publish. La regla local no se aplica automáticamente a Firebase.
5. Vuelve a la aplicación y pulsa «Reintentar nube». Si hay datos locales, confirma la fusión antes de subirlos; puedes cancelarla y seguir en local. En una misma forma se conserva la selección local y se combinan los álbumes. Después, los cambios se guardan primero en local y se suben automáticamente.

Las reglas deniegan el acceso salvo cuando el UID autenticado coincide tanto con el UID de la ruta como con el propietario configurado. No cambies la regla por una condición genérica de «usuario autenticado». Prueba desde una segunda cuenta que no pueda leer ni escribir. El login de Google por sí solo no da acceso a Firestore.

Al cerrar sesión solo se desactiva la sincronización: no se borra la copia local ni la colección remota. Conserva los respaldos JSON; el plan Spark no incluye backups automáticos de Firestore. La ubicación elegida para Firestore es permanente para esa base.

Exportación JSON versionada con selecciones, metadatos de carta, precios y álbumes. La importación restaura toda la colección, no mezcla datos: valida tamaño (5 MB), versión, especies, unicidad, importes, fechas, URLs HTTPS y referencias antes de pedir confirmación y guardar.

El formato actual es `schemaVersion: 2`, compatible con respaldos v1. Se mantiene la misma clave de almacenamiento para recuperar los datos existentes. La migración remapea una carta regional reconocida y sus referencias de álbum conservando estado e importes. Una carta antigua ambigua se conserva marcada para revisar y no completa una forma automáticamente. Reasignar esa misma carta a una forma confirmada conserva sus importes y álbumes. La lectura no sobrescribe el original: la siguiente modificación o exportación usa la versión 2.

En los modelos, `id` es el identificador interno de entrada y `nationalId` el número nacional. Las formas principales mantienen sus IDs antiguos; las alternativas usan `100000 + id de forma de PokéAPI`. Los campos históricos `speciesId` y `speciesIds` de cartas/álbumes referencian estos IDs de entrada en v2, no necesariamente números nacionales. No utilizar un ID interno como `dexId` de TCGdex.

Un archivo inválido o un fallo de escritura mantiene el estado anterior. Si el guardado existente está dañado, se conserva sin sobrescribir y se bloquean las modificaciones hasta restaurar explícitamente un respaldo válido. No se garantiza recuperación de datos que el navegador haya borrado.

## Arquitectura

- `src/app/core/collection.ts`: modelos y reglas de colección/respaldo.
- `src/app/core/repositories.ts`: contratos y adaptadores de catálogo estático y almacenamiento local.
- `src/app/core/collection-store.ts`: estado reactivo y operaciones persistidas antes de publicarse.
- `src/app/core/firebase-auth.ts`: inicio/cierre de sesión Google y restauración diferida de Auth.
- `src/app/core/firebase-collection.ts`: lecturas, escrituras por documento y fusión local/remota.
- `src/app/core/firebase-cloud-sync.ts`: sincronización de sesión y reintentos, manteniendo local primero.
- `firestore.rules`: acceso denegado salvo el UID personal configurado explícitamente.
- `src/app/core/catalog-query.ts`: búsqueda, filtros y ordenación.
- `src/app/core/pokemon-forms.ts`: número nacional y reconocimiento conservador de formas.
- `src/app/core/tcgdex-catalog.ts`: adaptador REST TCGdex, validación, paginación y caché de sesión.
- `src/app/features/card-detail/tcgdex-browser.ts`: carga automática por especie e idioma y descarte de respuestas anteriores.
- `src/app/features/`: Pokédex, deseos, ficha y álbumes con rutas diferidas.
- `public/data/`: snapshot completo de formas sin Gigamax y procedencia fijada por revisión.
- `scripts/prepare-placeholders.mjs`: generador de los recursos geométricos originales, sin arte Pokémon.
- `e2e/card-fixture.png`: imagen neutral original usada por las pruebas.

La Pokédex inicial carga datos estáticos de especies. Abrir una ficha o cambiar de idioma consulta `api.tcgdex.net`; sus imágenes se sirven desde `assets.tcgdex.net`. No se envían tu inventario, precios ni álbumes al proveedor. No hay claves ni secretos en el cliente. No se ha implementado PWA ni se garantiza funcionamiento sin conexión.

## Comprobaciones

```sh
npm run build
npm run lint
npm test -- --watch=false
npx playwright install chromium
npm run test:e2e
npm audit
```

Con Node aislado, estos son los equivalentes para compilación y pruebas:

```sh
npm exec --yes --package=node@22.22.3 -- node node_modules/@angular/cli/bin/ng.js build
npm exec --yes --package=node@22.22.3 -- node scripts/prepare-licenses.mjs
npm exec --yes --package=node@22.22.3 -- node node_modules/@angular/cli/bin/ng.js test --watch=false
npm exec --yes --package=node@22.22.3 -- node node_modules/playwright/cli.js test
```

Playwright usa escritorio 1440×900 y móvil 390×844; comprueba imágenes, desbordamientos, temas, selección, precios, recarga, ampliación, sustitución, álbumes y respaldo. Los casos TCGdex interceptan las peticiones para comprobar paginación, caché, idiomas, errores y respuestas tardías de forma determinista; no dependen de Internet ni consumen la API real. Genera capturas en `test-results/`. Puede reutilizar el servidor local del puerto 4200 o iniciarlo automáticamente.

El override de `minimatch` fija la familia 11 corregida para las herramientas de lint. Las reglas permiten alias de inputs para mantener los Signals internos con prefijo `_` y nombres de binding públicos legibles.

`npm run build` incluye la licencia, los avisos del proyecto y los textos completos de las dependencias en `dist/pokecollector/browser`. Si ejecutas `ng build` directamente, debes ejecutar también `node scripts/prepare-licenses.mjs`. Conserva estos avisos al desplegar o redistribuir la compilación.

Los marcadores ya están incluidos. Para regenerarlos, con Chromium de Playwright instalado, ejecuta `npm run assets:prepare`; no necesita conexión a proveedores de imágenes.

## Fuentes

Los datos incluidos ya están preparados. Regeneración opcional de especies/formas, con conexión a Internet y revisión fijada; no descarga muestras de cartas:

```sh
npm run data:prepare
```

Especies: [PokéAPI](https://github.com/PokeAPI/pokeapi), revisión y fecha en `public/data/provenance.json`; condiciones conservadas en `public/licenses/pokeapi.txt`.

No se incluyen ilustraciones de cartas ni el reverso oficial en la versión actual. La imagen de prueba y el marcador local son diseños geométricos originales generados por el proyecto. Cada carta guardada conserva su URL de procedencia original. Sustituir estos archivos no los elimina de commits, capturas o versiones anteriores: el historial Git no se ha reescrito y su distribución debe revisarse aparte.

Catálogo remoto: [TCGdex](https://tcgdex.dev/), [FAQ y condiciones de acceso](https://tcgdex.dev/faq), [estado de idiomas](https://tcgdex.dev/status) y [formato de imágenes](https://tcgdex.dev/assets), revisados el 5 de noviembre de 2026. Su repositorio de datos declara MIT; se conserva el aviso en [public/licenses/tcgdex.txt](public/licenses/tcgdex.txt). Cada selección conserva la URL de su ficha JSON de origen. El acceso gratuito y esa licencia no transfieren derechos sobre las ilustraciones: su visualización externa sigue sujeta a permisos y condiciones aplicables, que deben confirmarse antes de publicar.

El fallback de imágenes de TCGplayer es opcional y utiliza directamente su CDN, no la API autenticada. No se contrata otra API ni se utilizan claves. No se ha establecido autorización para ese uso del CDN; activar la opción no concede permisos sobre sus imágenes. Confirmar las condiciones con el proveedor antes de publicar una demo que habilite esa integración. La licencia PolyForm del código no sustituye esos permisos.

Las ilustraciones, nombres y marcas pertenecen a sus titulares. Proyecto personal no afiliado ni respaldado por Pokémon, Nintendo, Creatures o GAME FREAK. La disponibilidad pública de los archivos no concede derechos comerciales sobre el arte; revisar permisos antes de publicar o redistribuir.

## Pendiente

Login y sincronización Firebase están implementados, pero la nube seguirá bloqueada hasta publicar `firestore.rules` en Firebase Console. Faltan pruebas contra Firebase Emulator Suite y completar la publicación en GitHub Pages. Precios automáticos, PWA, CSV y múltiples cartas/copias por forma quedan fuera de esta versión. Los filtros de idioma, expansión e ilustración de la Pokédex actúan sobre tus cartas elegidas, no sobre una indexación completa del catálogo TCGdex.
