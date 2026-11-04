# Pokecollector

Pokédex personal de cartas Pokémon TCG. Angular 22, componentes standalone, Signals, SCSS/BEM y temas claro/oscuro. Aplicación independiente, sin backend ni servicios de pago.

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

Se ofrecen los diez idiomas publicados por el proveedor, con distinta cobertura. Pocket se excluye silenciosamente por los identificadores de sus expansiones o por la ruta de imagen `tcgp`, sin aumentar el contador de resultados omitidos. La lista de expansiones procede de la serie `tcgp` de TCGdex y debe revisarse cuando se publiquen nuevos sets. Solo los resultados sin correspondencia nacional o de forma se contabilizan como omitidos. Las cartas físicas sin imagen válida se conservan y se pueden seleccionar: se utiliza la imagen de TCGplayer si TCGdex facilita un identificador de producto válido, aunque su idioma puede variar. Si no existe ninguna imagen válida o falla su carga, se muestra el reverso local de una carta. Sin imagen conocida, el respaldo guarda `image: null`, no la URL del reverso. Las rarezas originales se conservan; solo se normalizan categorías reconocidas. «Ultra Rare» solo se interpreta como Full Art en las expansiones Scarlet & Violet, no de forma universal.

Consultar o previsualizar una carta no modifica la colección. Sus identificadores incluyen proveedor e idioma (`tcgdex:es:sv03.5-166`). Cada selección guarda el identificador de entrada y su número nacional. Un error de red no borra cartas ni precios y permite reintentar. Las imágenes usan su URL de origen y necesitan conexión.

Los precios continúan siendo manuales. Esta integración no convierte los datos de cotización de TCGdex en valoraciones de tu colección.

## Guardado y respaldos

Los datos se guardan en `localStorage`, clave `pokecollector.collection.v1`. No hay cuentas ni sincronización entre navegadores, dispositivos, puertos u orígenes. Borrar los datos del sitio puede eliminar la colección.

Exportación JSON versionada con selecciones, metadatos de carta, precios y álbumes. La importación restaura toda la colección, no mezcla datos: valida tamaño (5 MB), versión, especies, unicidad, importes, fechas, URLs HTTPS y referencias antes de pedir confirmación y guardar.

El formato actual es `schemaVersion: 2`, compatible con respaldos v1. Se mantiene la misma clave de almacenamiento para recuperar los datos existentes. La migración remapea una carta regional reconocida y sus referencias de álbum conservando estado e importes. Una carta antigua ambigua se conserva marcada para revisar y no completa una forma automáticamente. Reasignar esa misma carta a una forma confirmada conserva sus importes y álbumes. La lectura no sobrescribe el original: la siguiente modificación o exportación usa la versión 2.

En los modelos, `id` es el identificador interno de entrada y `nationalId` el número nacional. Las formas principales mantienen sus IDs antiguos; las alternativas usan `100000 + id de forma de PokéAPI`. Los campos históricos `speciesId` y `speciesIds` de cartas/álbumes referencian estos IDs de entrada en v2, no necesariamente números nacionales. No utilizar un ID interno como `dexId` de TCGdex.

Un archivo inválido o un fallo de escritura mantiene el estado anterior. Si el guardado existente está dañado, se conserva sin sobrescribir y se bloquean las modificaciones hasta restaurar explícitamente un respaldo válido. No se garantiza recuperación de datos que el navegador haya borrado.

## Arquitectura

- `src/app/core/collection.ts`: modelos y reglas de colección/respaldo.
- `src/app/core/repositories.ts`: contratos y adaptadores de catálogo estático y almacenamiento local.
- `src/app/core/collection-store.ts`: estado reactivo y operaciones persistidas antes de publicarse.
- `src/app/core/catalog-query.ts`: búsqueda, filtros y ordenación.
- `src/app/core/pokemon-forms.ts`: número nacional y reconocimiento conservador de formas.
- `src/app/core/tcgdex-catalog.ts`: adaptador REST TCGdex, validación, paginación y caché de sesión.
- `src/app/features/card-detail/tcgdex-browser.ts`: carga automática por especie e idioma y descarte de respuestas anteriores.
- `src/app/features/`: Pokédex, deseos, ficha y álbumes con rutas diferidas.
- `public/data/`: snapshot completo de formas sin Gigamax y procedencia fijada por revisión.
- `e2e/card-fixture.png`: imagen usada exclusivamente por las pruebas, fuera de los archivos públicos.

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
npm exec --yes --package=node@22.22.3 -- node node_modules/@angular/cli/bin/ng.js test --watch=false
npm exec --yes --package=node@22.22.3 -- node node_modules/playwright/cli.js test
```

Playwright usa escritorio 1440×900 y móvil 390×844; comprueba imágenes, desbordamientos, temas, selección, precios, recarga, ampliación, sustitución, álbumes y respaldo. Los casos TCGdex interceptan las peticiones para comprobar paginación, caché, idiomas, errores y respuestas tardías de forma determinista; no dependen de Internet ni consumen la API real. Genera capturas en `test-results/`. Puede reutilizar el servidor local del puerto 4200 o iniciarlo automáticamente.

El override de `minimatch` fija la familia 11 corregida para las herramientas de lint. Las reglas permiten alias de inputs para mantener los Signals internos con prefijo `_` y nombres de binding públicos legibles.

## Fuentes

Los datos incluidos ya están preparados. Regeneración opcional de especies/formas, con conexión a Internet y revisión fijada; no descarga muestras de cartas:

```sh
npm run data:prepare
```

Especies: [PokéAPI](https://github.com/PokeAPI/pokeapi), revisión y fecha en `public/data/provenance.json`; condiciones conservadas en `public/licenses/pokeapi.txt`.

La antigua muestra de cartas e imágenes de Pokémon TCG Data ya no se incluye en la aplicación. La imagen de prueba procede de Bulbasaur #166 de 151, de esa muestra histórica, y no se publica como asset de la app. Cada carta guardada conserva su URL de procedencia original.

Catálogo remoto: [TCGdex](https://tcgdex.dev/), [FAQ y condiciones de acceso](https://tcgdex.dev/faq), [estado de idiomas](https://tcgdex.dev/status) y [formato de imágenes](https://tcgdex.dev/assets), consultados el 4 de noviembre de 2026. Cada selección conserva la URL de su ficha JSON de origen. El acceso gratuito a los datos no transfiere derechos sobre las ilustraciones.

El reverso local `public/cards/pokemon-card-back.jpg` procede del [sitio oficial de Pokémon TCG](https://tcg.pokemon.com/assets/img/global/tcg-card-back-2x.jpg), descargado el 4 de noviembre de 2026, y solo representa una imagen no disponible. Las imágenes alternativas se sirven desde `tcgplayer-cdn.tcgplayer.com`; no se contrata otra API ni se utilizan claves.

Las ilustraciones, nombres y marcas pertenecen a sus titulares. Proyecto personal no afiliado ni respaldado por Pokémon, Nintendo, Creatures o GAME FREAK. La disponibilidad pública de los archivos no concede derechos comerciales sobre el arte; revisar permisos antes de publicar o redistribuir.

## Pendiente

Elegir BBDD y alojamiento con plan gratuito. Login, sincronización, precios automáticos, PWA, CSV y múltiples cartas/copias por forma quedan fuera de esta versión. Los filtros de idioma, expansión e ilustración de la Pokédex actúan sobre tus cartas elegidas, no sobre una indexación completa del catálogo TCGdex.
