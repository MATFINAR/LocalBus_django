# Auditoría completa: LocalBus_django

**Fecha**: 2026-11-06
**Modo**: Salud general del repositorio
**Fuente**: rama `master` (103 commits). El árbol de trabajo tenía 4 archivos sin commit, del botón de notificaciones.
**Lenses ejecutados**: 10/10, adaptados a Django. Las lentes originales apuntan a Tauri/Rust/React, así que "Backend" se aplicó a Django y "Frontend" a JavaScript sin framework.
**Lenses omitidos**: ninguno.
**Alcance leído**: `settings.py`, `urls.py`, `permisos.py`, `seguridad.py`, `models.py`, los endpoints de `views.py` (3.021 líneas) y las plantillas, JS y CSS. No leí línea por línea los 5 reportes PDF ni las 34 migraciones.
**Método**: lectura de código, `pyflakes` y `manage.py check --deploy`. No ejecuté la suite de pruebas porque el repo no tiene ninguna.

---

## Veredicto maestro: APROBAR CON CAMBIOS

La base está bien cuidada: aislamiento por empresa, rate limiting de login y códigos, contraseñas con hash, `json_script` para evitar XSS, `.env` fuera de git y sin rastro en el historial.

Pero hay tres problemas que impiden llamarlo listo para producción:
1. La API del conductor acepta peticiones sin token por defecto.
2. No hay ninguna prueba automática en el repo.
3. La configuración HTTPS y de cookies no está lista para producción.

Más abajo hay deuda de mantenimiento: `views.py` es un monolito y la tabla de ubicaciones crece sin límite.

## Veredicto por lente

| # | Lente | Veredicto | Críticos | Recomendaciones |
|---|-------|-----------|----------|-----------------|
| 1 | Design Engineer | Aprobar con cambios | 0 | 4 |
| 2 | UX Engineer | Aprobar con cambios | 1 | 3 |
| 3 | Frontend Engineer | Aprobar con cambios | 0 | 4 |
| 4 | Backend Engineer | Aprobar con cambios | 2 | 5 |
| 5 | Structural Engineer | Aprobar con cambios | 0 | 4 |
| 6 | Repo Maintainer | Aprobar con cambios | 1 | 5 |
| 7 | Production Readiness | Necesita rediseño parcial | 3 | 4 |
| 8 | DX Engineer | Aprobar con cambios | 0 | 3 |
| 9 | Performance Engineer | Aprobar con cambios | 1 | 3 |
| 10 | Accessibility Engineer | Aprobar con cambios | 0 | 4 |

## Todos los problemas críticos (hay que corregirlos)

| # | Problema | Lentes | Archivos | Impacto | Corrección |
|---|----------|--------|----------|---------|------------|
| C1 | El token del conductor no es obligatorio: `CONDUCTOR_TOKEN_OBLIGATORIO` vale `False` por defecto. Con solo un `conductor_id` numérico, cualquiera puede enviar ubicaciones, activar o desactivar el bus de otro conductor. | Backend, Prod | `settings.py`, `permisos.py:conductor_de_la_peticion`, `views.py` (`activar_bus`, `desactivar_bus`, `enviar_ubicacion`, `verificar_estado_ubicacion`) | Los ids son consecutivos y fáciles de adivinar. Se pueden falsificar posiciones en el mapa público. | Cuando la app móvil ya envíe el token, poner `CONDUCTOR_TOKEN_OBLIGATORIO=True` en el `.env` y cambiar el valor por defecto a `True`. Mientras tanto, límite de peticiones por IP en esos endpoints. |
| C2 | El repo no tiene pruebas: `core/tests.py` tiene 3 líneas y no prueba nada. Las pruebas que se hicieron viven en una carpeta temporal fuera del repo. | Repo, Prod, DX | `core/tests.py` | Cualquier cambio en turnos, permisos o login puede romper cosas sin que nadie se entere. Ya pasó: había pruebas viejas que fallaban por cambios hechos sin ellas. | Crear `core/tests/` con al menos: aislamiento entre empresas, login y bloqueo, token del conductor, validación de turnos (cruces), mapa solo con turno vigente. |
| C3 | Configuración de producción incompleta. `manage.py check --deploy` da 4 advertencias: sin `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` ni `SECURE_HSTS_SECONDS`. Tampoco hay `STATIC_ROOT`, `LOGGING` ni `CACHES`. | Prod, Backend | `LocalBus_django/settings.py` | Con `DEBUG=False` los archivos estáticos no se sirven y las cookies de sesión viajan sin cifrar si falta HTTPS. Los límites de intentos de login usan la caché en memoria de cada proceso, así que con varios procesos el contador se reparte y no limita bien. | Bloque de ajustes condicionado a `not DEBUG`; `STATIC_ROOT` (con WhiteNoise o el servidor web); `CACHES` compartida (Redis o base de datos); `LOGGING` a archivo o consola. |
| C4 | No existe `.env.example` ni README, aunque `settings.py` los menciona ("ver .env.example"). Quien clone el repo no sabe qué variables definir (GDAL, PostGIS, correo, Firebase). | Prod, DX, Repo | `.env.example` (ausente), `README.md` (ausente) | La instalación en otra máquina depende de que alguien lo recuerde. Ya se perdió una vez un `.env.example` que se creó. | Crear `.env.example` con todas las variables y un README con pasos de instalación (PostGIS, GDAL, migrar, crear superusuario, simulador). |
| C5 | El mapa carga sin `<meta name="viewport">`: solo `login.html` y `registro.html` lo tienen. Además `base.html` no tiene `<head>`: el `<meta>`, el `<title>` y los `<link>` van sueltos dentro de `<html>`. | UX, Frontend, A11y | `core/templates/core/base.html:3-14` | En celulares, la página se renderiza con ancho de escritorio y se ve diminuta, justo en la pantalla que más usan los pasajeros. El HTML sin `<head>` lo corrige el navegador, pero es inválido. | Agregar `<head>` con `<meta name="viewport" content="width=device-width, initial-scale=1">` en `base.html`. |
| C6 | `UbicacionBus` crece sin límite: cada envío de GPS (y cada ciclo del simulador) inserta una fila y nada las borra. El mapa solo usa el último punto reciente. | Perf, Prod | `core/models.py:122`, `views.py:enviar_ubicacion`, `simular_buses.py` | Con 20 buses enviando cada 3 s se generan unas 576.000 filas al día. La consulta `DISTINCT ON` del mapa se vuelve cada vez más lenta. | Comando de gestión que borre puntos con más de N días (o los resuma) y programarlo; o un índice `(bus, -timestamp)` si se conserva el historial. |

## Preocupaciones transversales

| Preocupación | Señalada por | Causa raíz | Corrección unificada |
|--------------|--------------|------------|----------------------|
| Falta de configuración y documentación para producción | Prod, DX, Repo, Backend | Todo se hizo para desarrollo local en Windows | C3 + C4: un bloque de producción en settings y un README con el despliegue |
| Cero pruebas automáticas | Repo, Prod, Backend, DX | `tests.py` quedó vacío | C2; pruebas de regresión por cada área (seguridad, turnos, mapa) |
| `views.py` es un monolito de 3.021 líneas, 110 funciones y clases | Structural, Repo, DX | Todo el backend se fue acumulando en un solo archivo | Dividir en un paquete `views/` (auth, rutas, buses, conductores, turnos, api, reportes, simulacion) sin cambiar las URLs |
| Endpoints públicos sin límite de peticiones ni reglas uniformes | Backend, Perf, Prod | Solo login y códigos tienen límite | Aplicar `seguridad.consulta_permitida` a `api_*`, `registrar_token`, `crearAlerta` |
| Front con mucho código inline y repetido | Frontend, Design, A11y, Repo | 14 plantillas con `<script>` inline, 11 con `onclick=`, `:root` repetido en 5 CSS | Mover scripts a archivos, usar `addEventListener`, unificar variables en `base.css` |

## Todas las recomendaciones

| # | Recomendación | Lente | Archivos | Corrección |
|---|---------------|-------|----------|------------|
| R1 | `registrar_token_notificaciones` es público, con `csrf_exempt`, y hace `update_or_create` por token: cualquiera puede registrar tokens arbitrarios o cambiar el tipo (`name`) de uno existente. | Backend | `views.py:2980` | Límite por IP; no cambiar `name` si el dispositivo ya existe; validar longitud y formato del token. |
| R2 | `api_tiempo_llegada` no usa `_buses_publicos()`, a diferencia de `api_tiempo_llegada_usuario`. Responde por buses inhabilitados o de empresas inactivas. | Backend | `views.py:2594` | Filtrar con `_buses_publicos()` igual que el otro endpoint. |
| R3 | `/api/alertas/` es pública y devuelve el `nickName` de quien creó la alerta. | Backend, Prod | `views.py:2284` | Quitar `usuario` del JSON público o mostrar solo un identificador anónimo. |
| R4 | `crearAlerta` no tiene límite de creación: un pasajero con sesión puede llenar la tabla y disparar push masivos. | Backend | `views.py:525` | Limitar, por ejemplo, 5 alertas por usuario cada 10 minutos con `core/seguridad.py`. |
| R5 | `LANGUAGE_CODE = 'en-us'` mientras toda la interfaz está en español: los mensajes de Django (admin, validadores de contraseña, formularios) salen en inglés. | Backend, UX | `settings.py` | `LANGUAGE_CODE = 'es-co'`. |
| R6 | Validación de contraseña del conductor incoherente: la valida con `len < 8` en vez de pasar por `error_contrasena` como los pasajeros. | Backend | `views.py:861` | Usar `seguridad.error_contrasena` también en conductores. |
| R7 | Endpoints de turnos usan `eliminarTurno` mientras el resto del proyecto inhabilita; revisar que no se pierda historial. | Backend, Structural | `urls.py`, `views.py` | Confirmar la decisión y documentarla. |
| R8 | Import innecesarios y duplicados (pyflakes): `urls.py` (`Path`, `settings`, `static`), `views.py` (`send_mail`, `datetime` redefinido), `reportes.py` (`letter`, `mm`, `PageBreak`), `tests.py`. | Repo | los indicados | Eliminarlos. |
| R9 | Nombres de URL y vistas inconsistentes: `crearRuta`, `CrearConductor`, `CrearBus`, `EditarBus`, `editarRuta/<id_ruta>/` (sin `int`) mezclan camelCase, PascalCase y snake_case; hay una URL con sangría de más. | Repo, DX | `urls.py` | Unificar a snake_case en minúsculas con redirecciones; usar `<int:...>` en todas. |
| R10 | Falta un archivo de dependencias de desarrollo y versiones fijas de herramientas (pyflakes, black/ruff) y un `pyproject` o config de linter. | Repo, DX | raíz | Agregar `requirements-dev.txt` y configuración de `ruff`. |
| R11 | Sin `LOGGING` configurado: los `logger.exception` solo salen por consola. Hay 4 `print(` y 21 `except Exception` en `core/`. | Prod, DX | `settings.py`, `views.py` | Configurar `LOGGING`; reemplazar los `print` por `logger`; acotar los `except Exception`. |
| R12 | Sondeos periódicos: mapa cada 5 s, panel de simulación cada 5 s y notificaciones cada 20 s, desde cada pestaña abierta. | Perf | `home.js:793`, `panel_simulacion.js:159`, `notificaciones.js:132` | Pausar cuando la pestaña está oculta (`document.hidden`); en producción valorar SSE o WebSocket. |
| R13 | `home.js` tiene 12 `console.log` y hay otros en `rutas.js`, `registro.js`, `buses.js`, `conductores.js`, `base.js`. | Frontend, Repo | `static/core/js/` | Quitarlos o dejarlos tras un indicador de depuración. |
| R14 | 30 usos de `innerHTML` en 7 archivos JS. Los datos de usuario se escapan con `escaparHtml` en `home.js`, pero no hay una garantía general. | Frontend | `rutas.js` (9), `home.js` (8), `buses.js`, `conductores.js`, `registro.js` | Revisar uno por uno y preferir `textContent` o plantillas con `createElement`. |
| R15 | Cada CSS vuelve a declarar `:root` con sus propias variables (`alertas`, `base`, `home`, `login`, `registro`) y con nombres distintos (`--blue` vs `--azul`). Hay unas 8.000 líneas de CSS. | Design, Repo | `static/core/css/` | Un solo conjunto de variables en `base.css`. |
| R16 | `<img class="avatar"></img>` sin `src` ni `alt` en tres tarjetas de "Acerca de". | A11y, Design | `acerca_de.html:121-133` | Agregar imagen y `alt`, o convertirlo en un `<div>` con iniciales. |
| R17 | Los modales no tienen `role="dialog"` ni `aria-modal`, ni gestión de foco; solo hay 12 atributos `aria-*` o `role` en toda la app. El panel de rutas del mapa y los chips de filtro tampoco anuncian su estado (`aria-pressed`). | A11y | `buses.html`, `conductores.html`, `rutas.html`, `turnos.html`, `alertas.html`, `home.html` | `role="dialog" aria-modal="true" aria-labelledby`, devolver el foco al cerrar, `aria-pressed` en filtros. |
| R18 | Las alertas nuevas aparecen en un contenedor `aria-live` solo en JS; el contador de la campana ("3") del encabezado es fijo y no refleja alertas reales. | UX, A11y | `base.html` (`alertaBadge`), `notificaciones.js` | Alimentar el contador con datos reales o quitarlo. |
| R19 | Estilos inline: 42 atributos `style=` y muchos `onclick=`. | Design, Frontend | `base.html` (17+11), `buses.html`, `conductores.html`, `rutas.html` | Clases CSS y `addEventListener`. |
| R20 | Estados de la interfaz no cubiertos: estados vacíos/errores de red en el mapa, sin indicador de carga al pedir la ubicación en "Cercanas a mí" más allá del mensaje de texto. | UX | `home.js` | Mensaje persistente de "sin conexión" cuando falla el sondeo. |
| R21 | Sin documentación de arquitectura: el modelo multiempresa, los turnos, el simulador y los permisos solo están en el código. | DX, Structural | repo | Sección "Arquitectura" en el README. |
| R22 | `Bus.ruta_actual` usa la primera ruta habilitada cuando no hay turno, lo que contradice la regla "sin turno no hay bus en el mapa". Revisar quién lo sigue usando. | Structural | `models.py:205` | Quitar el respaldo o limitarlo al simulador. |
| R23 | Lógica de turnos (cálculo de ventanas, cruces, edición por alcance) repartida entre `models.py` y `views.py` (`_reemplazar_con_formulario`, `editarTurno`). | Structural | `views.py:1400-1560` | Mover las reglas a un módulo `core/turnos.py` con pruebas. |
| R24 | `core/utils/reportes.py` y las vistas de reportes ejecutan consultas completas y generan el PDF en la petición, sin límite de filas salvo alertas (100). | Perf | `views.py:2300-2440` | Límite razonable o generación en segundo plano si crece. |
| R25 | Firebase: si falta el archivo de credenciales el proyecto arranca y solo avisa en el log, sin ninguna indicación en la interfaz de que las push no funcionan. | Prod, DX | `settings.py` | Mensaje claro al arrancar y en el panel de administración. |
| R26 | `FCMDevice` por token sin asociar a usuario ni expiración; con `DELETE_INACTIVE_DEVICES` activo ayuda, pero sin política de limpieza propia. | Prod | `views.py:3007` | Asociar el dispositivo a un usuario si hay sesión, o aceptar el riesgo y documentarlo. |

---

# Informes por lente

---

## 1. Design Engineer

**Veredicto**: APROBAR CON CAMBIOS

**Archivos revisados**: `base.css`, `home.css`, `alertas.css`, `login.css`, `registro.css`, `turnos.css`, plantillas principales.

**Lo que está bien**
- Paleta coherente (azul `#1D3557`, rojo `#E63946`) en todas las pantallas.
- Los componentes de las listas (tarjetas de ruta, chips, badges de estado) se ven uniformes.

**Problemas**
- Variables CSS duplicadas con nombres distintos entre archivos (R15). Cambiar un color obliga a tocar 5 archivos.
- Mucho estilo inline (R19), que impide cambiar el tema desde el CSS.
- `home.css` coloca el botón de ubicación con `left: 420px` fijo para esquivar el panel de rutas, sin adaptarse a pantallas pequeñas (el panel usa `max-width: 25vw`).
- Modo oscuro: no existe, y no es un requisito.

**Cobertura de estados visuales**

| Componente | Normal | Hover | Foco | Deshabilitado | Vacío | Error |
|---|---|---|---|---|---|---|
| Botones del mapa | ✓ | ✓ | no declarado | ✓ | n/a | n/a |
| Tarjeta de ruta | ✓ | ✓ | no declarado | n/a | ✓ ("No hay rutas") | n/a |
| Formularios | ✓ | ✓ | parcial | parcial | n/a | ✓ |
| Modales | ✓ | n/a | no declarado | n/a | n/a | ✓ |

**Detalle**: fidelidad de tokens media (R15); estados de foco poco definidos; animaciones sobrias; consistencia buena en tarjetas, mejorable en botones.

---

## 2. UX Engineer

**Veredicto**: APROBAR CON CAMBIOS

**Mapa del recorrido del usuario**

| Paso | Pasajero | Administrador de empresa |
|---|---|---|
| Entrada | Mapa vacío; elige ruta en la lista | Login de empresa, luego `/turnos/` |
| Tarea principal | Ver buses de una ruta, filtro "Cercanas a mí" | Crear y editar turnos, rutas, buses y conductores |
| Salida | Cerrar sesión | Salir de la empresa |

**Lo que está bien**
- El mapa arranca limpio y solo muestra lo que el usuario elige.
- "Cercanas a mí" explica qué pasó (permiso, cuántas rutas, distancia en cada tarjeta).
- Los turnos preguntan el alcance de una edición ("solo este día / en adelante").
- En lugar de eliminar se inhabilita, con mensajes que explican cómo recuperar.

**Problemas**
- **Crítico (C5)**: sin `viewport` en la mayoría de pantallas, la experiencia en celular es mala.
- La campana del encabezado muestra un "3" fijo (R18).
- El botón de notificaciones del navegador quedó junto a "Mi Ubicación", pero solo funciona mientras haya una pestaña abierta; el texto no lo aclara.
- Las pruebas de uso están pendientes: no hay evidencia en el repo de pruebas con usuarios (solo una encuesta en `documentacion`).

**Consistencia de interacciones**: el patrón "tarjeta + modal" se repite en rutas, buses, conductores y turnos, y es coherente. Los nombres de acción varían ("Crear", "Nuevo", "Agregar").

---

## 3. Frontend Engineer

**Veredicto**: APROBAR CON CAMBIOS

**Resumen**: JavaScript sin framework, unas 5.400 líneas repartidas en 12 archivos. `rutas.js` (1.265) y `home.js` (820) son los más grandes.

**Lo que está bien**
- Los datos del servidor pasan por `json_script`, no por plantillas JS concatenadas.
- `escaparHtml` en las zonas con `innerHTML` de `home.js`.
- Versionado de archivos estáticos con `?v=`, para evitar cachés viejas.

**Problemas**
- 30 `innerHTML` (R14); 12 `console.log` en `home.js` (R13).
- Variables globales en `home.js` (`map`, `rutaSeleccionada`, `userLocation`...), sin módulos.
- Un `setInterval` por funcionalidad, sin pausa en pestañas ocultas (R12).
- Sin lint ni formato: el estilo varía entre archivos.
- El versionado `?v=` es manual; es fácil olvidarlo.

**Análisis del camino de render**: el mapa consulta los buses cada 5 s. No revisé si reutiliza los marcadores o los recrea; con cientos de buses conviene comprobarlo.

**Tipos**: no aplica (JS plano). `// @ts-check` o JSDoc ayudaría a `home.js`.

---

## 4. Backend Engineer (Django)

**Veredicto**: APROBAR CON CAMBIOS

**Lo que está bien**
- Aislamiento de empresas con `admin_empresa_required` y `request.empresa`.
- Contraseñas con `make_password`; códigos con `secrets` y `compare_digest`; límites de intentos.
- Restricciones en base de datos: únicos sin distinguir mayúsculas, `CheckConstraint` en turnos, `PROTECT` en claves foráneas.
- `_respuesta_error` no filtra detalles internos al cliente.
- `transaction.atomic` en las ediciones de turnos que reemplazan filas.

**Problemas críticos**
- **C1**: token del conductor opcional.
- **C6**: `UbicacionBus` sin purga.

**Problemas importantes**: R1–R6 (token FCM público, `api_tiempo_llegada` sin filtro, nickname público, `crearAlerta` sin límite, idioma, validación de contraseña del conductor).

**Análisis de rutas de error**: las APIs envuelven todo en `try/except Exception` y devuelven 500 genérico, con el detalle en el log; correcto, aunque 21 `except Exception` en total ocultan errores de programación. `crearAlerta` redirige sin dar aviso si el usuario no está autenticado.

**Auditoría del ciclo de vida de recursos**

| Recurso | Quién lo crea | Quién lo limpia | Estado |
|---|---|---|---|
| `UbicacionBus` | cada envío / ciclo del simulador | nadie | **Crece sin límite** |
| Sesiones (`django_session`) | login | `clearsessions` (no programado) | Riesgo bajo |
| `FCMDevice` | registro de token | `DELETE_INACTIVE_DEVICES` | Parcial |
| Códigos de recuperación | `solicitar_recuperacion` | expiran a 15 min; se sobrescriben | Correcto; se guardan en claro (6 dígitos, vida corta) |
| Caché de límites | `seguridad.contar` | expira sola | Correcto en un proceso; no compartido |

---

## 5. Structural Engineer

**Veredicto**: APROBAR CON CAMBIOS

**Mapa de dependencias**: un único módulo `core` con `models.py` (571 líneas), `views.py` (3.021), `seguridad.py`, `permisos.py`, `context_processors.py`, `utils/reportes.py` y el comando `simular_buses`. Las vistas importan modelos, seguridad y permisos; no hay ciclos.

**Problemas**
- `views.py` mezcla autenticación, CRUD de cuatro entidades, turnos, API móvil, simulación y reportes (R23 y la preocupación transversal).
- La lógica de negocio de turnos está dividida entre el modelo y la vista (R23).
- Los pasajeros usan sesión propia (`request.session['usuario_id']`) y los administradores el sistema de usuarios de Django: dos mecanismos de autenticación conviven, lo que funciona pero duplica reglas (`BackendConBloqueo` solo cubre los segundos).
- `Bus.ruta_actual` conserva un respaldo que contradice la regla actual del mapa (R22).

**Análisis de cruces de frontera**: la API móvil (`/api/...`) y las vistas web comparten el mismo módulo y la misma sesión de cookies; la app móvil depende del formato JSON actual, sin versionado de la API (`/api/v1/`).

**Recomendación**: dividir `views.py` en paquete y crear `api/` aparte, con versión.

---

## 6. Repo Maintainer

**Veredicto**: APROBAR CON CAMBIOS

**Lista de convenciones**

| Convención | Estado |
|---|---|
| `.gitignore` cubre `.env`, credenciales, `__pycache__` | ✓ |
| Secretos fuera del repo e historial | ✓ (`.env` nunca se subió) |
| Dependencias fijadas en `requirements.txt` | ✓ |
| README / `.env.example` | ✗ (C4) |
| Pruebas | ✗ (C2) |
| Linter / formateador | ✗ (R10) |
| Imports sin usar | ✗ (R8) |
| Nombres de URL y vistas consistentes | ✗ (R9) |
| Mensajes de commit descriptivos | ✓ en general |
| Migraciones ordenadas (34) | ✓ |

**Oportunidades de reutilización**: las validaciones de conductor, bus y ruta repiten el patrón "buscar duplicado, armar mensaje con pista de inhabilitado"; hay endpoints `verificar_*` casi idénticos (teléfono, email, nickname, cédula, placa).

**Higiene**: la carpeta `reviews/` es nueva; conviene decidir si se versiona.

---

## 7. Production Readiness

**Veredicto**: NECESITA REDISEÑO PARCIAL (configuración y operación)

**Análisis de modos de fallo**

| Fallo | Qué pasa hoy | Mitigación |
|---|---|---|
| Se reinicia el servidor | Los límites de intentos se pierden (caché local) | Caché compartida |
| Falla el correo (Gmail SMTP) | Se registra el error, el usuario no recibe código | Aviso al usuario y reintento |
| Falta Firebase | Arranca sin push, solo avisa en el log | R25 |
| Cae PostGIS | 500 genérico | Monitoreo y alertas |
| Se llena la tabla de ubicaciones | Mapa cada vez más lento | C6 |
| Un conductor falsifica ubicaciones | Se aceptan sin token | C1 |
| El simulador corre en producción | Mueve buses con datos de prueba | Separar o desactivar el comando por entorno |

**Lista de entorno**

| Elemento | Estado |
|---|---|
| `DEBUG` seguro por defecto | ✓ |
| `SECRET_KEY` obligatoria con `DEBUG=False` | ✓ |
| `ALLOWED_HOSTS` desde el entorno | ✓ |
| HTTPS, HSTS, cookies seguras | ✗ (C3) |
| `STATIC_ROOT` | ✗ |
| `LOGGING` | ✗ |
| `CACHES` compartida | ✗ |
| Gmail SMTP con contraseña de aplicación en `.env` | ✓ |
| Copias de seguridad de la base | Manual (el respaldo previo se hizo a mano) |
| `clearsessions` programado | ✗ |

---

## 8. DX Engineer

**Veredicto**: APROBAR CON CAMBIOS

**Auditoría de mensajes de error**

| Situación | Mensaje | Valoración |
|---|---|---|
| Falta `SECRET_KEY` con `DEBUG=False` | "Falta DJANGO_SECRET_KEY en el .env…" | Claro |
| Falta Firebase | "sin notificación push: falta el archivo de credenciales" | Claro, pero solo en el log |
| Validaciones de formularios | Con pista de cómo corregir ("vuelve a habilitarlo") | Muy bueno |
| Faltan GDAL/GEOS | Error propio de Django | Falta guía |

**Recorrido del desarrollador nuevo**: clonar, ¿qué sigue? No hay README ni `.env.example` (C4). Hay que saber instalar PostGIS y GDAL, crear la base `LocalBus_DB`, migrar, crear un superusuario con empresa y correr `simular_buses`. Nada de eso está escrito.

**Recomendaciones**: README y `.env.example` (C4); un comando que cargue datos de demostración (el script de 20 registros hoy vive en una carpeta temporal fuera del repo); documentar el flujo de turnos y el simulador.

---

## 9. Performance Engineer

**Veredicto**: APROBAR CON CAMBIOS

**Presupuesto de recursos**

| Recurso | Frecuencia | Costo | Riesgo |
|---|---|---|---|
| `/api/ubicaciones/` | cada 5 s por pestaña | 2 consultas (último punto + turnos) | Medio: sube con visitantes y con la tabla sin purgar |
| `/api/alertas/` | cada 20 s por pestaña | 1 consulta | Bajo |
| `/api/estado-simulacion/` | cada 5 s en el panel | varias consultas por bus | Bajo (solo admin) |
| `enviar_ubicacion` | cada ping del conductor | 1 `INSERT` + 1 `UPDATE` del bus | Bajo por petición; acumula (C6) |
| Reportes PDF | bajo demanda | consulta completa | Bajo hoy |

**Análisis de ruta caliente**: el mapa usa `DISTINCT ON` con `select_related`, bien resuelto. Las listas de administración usan `_turnos_vigentes_por` para evitar una consulta por fila, bien resuelto. Está bien evitado el N+1 en las páginas revisadas.

**Problemas**: crecimiento de `UbicacionBus` (C6); sondeos que no se pausan al ocultar la pestaña (R12); sin caché de corta duración para `/api/ubicaciones/`, donde un cache de 2–3 s absorbería a muchos visitantes.

---

## 10. Accessibility Engineer

**Veredicto**: APROBAR CON CAMBIOS

**Recorrido con teclado (por lo revisado en el código)**
- Los controles principales son `<button>` y `<a>`, así que reciben foco.
- Los modales se cierran con Escape (hay manejo en 7 archivos JS), pero no atrapan el foco ni lo devuelven al abrir y cerrar.
- Las tarjetas de ruta del mapa son `div` con `click`: no se pueden elegir con teclado.

**Lista ARIA**

| Elemento | Estado |
|---|---|
| `lang="es"` en `<html>` | ✓ |
| Etiquetas `<label>` en formularios | ✓ (más de 90) |
| Modales con `role="dialog"` / `aria-modal` | ✗ |
| Chips de filtro con `aria-pressed` | ✗ |
| Mensaje de filtro con `role="status"` | ✓ (`filtroMensaje`) |
| Avisos de alertas con `aria-live` | ✓ |
| Imágenes con `alt` | ✗ (R16) |
| Mapa con alternativa textual | Parcial: existe la lista de rutas |

**Contraste**: el texto claro sobre el azul oscuro es suficiente; el gris de ayuda (`#ADB5BD` sobre blanco, en subtítulos) probablemente no cumple 4,5:1 y conviene medirlo.

**Recomendaciones**: R16, R17, hacer las tarjetas de ruta focalizables (`tabindex="0"`, `role="button"`, tecla Enter/Espacio) y respetar `prefers-reduced-motion` en el marquee de alertas del mapa.

---

## Notas finales

- No encontré secretos en el repositorio ni en su historial. El `.env` real existe solo en la máquina local.
- Lo que el repo hace bien en seguridad (límites de login, respuestas uniformes en recuperación, hashes) no depende de configuración externa, salvo la caché compartida (C3).
- Lo que no verifiqué: el comportamiento real de la app móvil con el token (C1 depende de ella), la carga con varios buses reales, ni las migraciones 0001–0027 en detalle.
