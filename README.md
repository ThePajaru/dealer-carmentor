# CarMentor Dealer

Producto dealer separado del monolito `carmentor.es`, para desplegarlo en su propio
subdominio y su propio proyecto de Vercel. **El proyecto original no se ha tocado**:
esto es una copia, y `/dealer` sigue vivo allí hasta que decidas retirarlo.

Separado el **2026-09-09** desde `CARMENTOR NEW`.

---

## 1. Lo que comparte y lo que no

| | |
|---|---|
| **Supabase** | **El mismo proyecto.** Auth y todas las tablas `dealer_*` ya viven ahí. Duplicarlo partiría los usuarios en dos. |
| **Stripe** | **La misma cuenta.** Solo cambia la URL del endpoint del webhook dealer. |
| **Motor de análisis** | **Se queda en `carmentor.es`.** Esta app lo llama por HTTP; no hay copia del motor aquí. |
| **Código de producto** | Copiado: 136 ficheros (89 propios del dealer + 47 compartidos arrastrados). |

### El motor no está aquí

`/api/dealer/analyze`, `/api/dealer/batch-analyze` y el reintento de leads llaman
por red a `POST /api/analyze` de la app de consumo, pasando el JWT del dealer.
Nunca importaron el motor, y por eso esta separación es barata.

---

## 2. La trampa de `NEXT_PUBLIC_BASE_URL`

En el monolito esa variable significaba **dos cosas a la vez**, porque coincidían:

1. «mi dominio público» — enlaces que el dealer pega fuera (bio de Instagram,
   WhatsApp), redirects de Stripe y CTAs de los correos;
2. «dónde vive el motor de análisis».

Al mover el dealer a un subdominio **dejan de coincidir**. Están separadas:

| Variable | Valor | Quién la usa |
|---|---|---|
| `NEXT_PUBLIC_BASE_URL` | `https://dealer.carmentor.es` | `public-url.ts`, checkout, intake, re-search, notificaciones y pings al cliente |
| `CARMENTOR_ENGINE_URL` | `https://carmentor.es` | solo las tres rutas que llaman a `/api/analyze` |

> Si copias las variables del proyecto viejo tal cual, `CARMENTOR_ENGINE_URL` se
> queda vacía, cae al `localhost:3000` por defecto y **todos los análisis fallan**.
> Es el fallo más probable de esta migración.

---

## 3. Puesta en marcha (lo que solo puedes hacer tú)

### 3.1 Vercel
1. Proyecto nuevo apuntando a este repo. Framework Next.js, ajustes por defecto.
2. Dominio → añade `dealer.carmentor.es`.
3. En tu DNS, el CNAME que te indique Vercel.

### 3.2 Variables de entorno (Production)
Copia [.env.example](./.env.example). `NEXT_PUBLIC_BASE_URL` = el subdominio;
`CARMENTOR_ENGINE_URL` = `https://carmentor.es`.

**Estas 17 no estaban en el `.env.local` del proyecto viejo** — o viven solo en
Vercel, o nunca se configuraron. Verifícalas una a una antes de dar esto por bueno:

```
BREVO_API_KEY                 CRON_SECRET
DEALER_LEADS_EMAIL            GOOGLE_API_KEY
GOOGLE_GENERATIVE_AI_API_KEY  STRIPE_ONEOFF_PRICE_ID
SUPABASE_JWT_SECRET           TALLY_SIGNING_SECRET
STRIPE_DEALER_PRICE_ID        STRIPE_DEALER_ANUAL_PRICE_ID
STRIPE_DEALER_WEBHOOK_SECRET  STRIPE_DEALER_PROFESIONAL_PRICE_ID
STRIPE_DEALER_PROFESIONAL_ANUAL_PRICE_ID
STRIPE_DEALER_PRO_PLUS_PRICE_ID
STRIPE_DEALER_PRO_PLUS_ANUAL_PRICE_ID
STRIPE_DEALER_COMPRAVENTA_PRICE_ID
STRIPE_DEALER_COMPRAVENTA_ANUAL_PRICE_ID
```

Sin `BREVO_API_KEY` no sale **ningún** correo transaccional: ni el aviso de cliente
nuevo al dealer, ni los pings de seguimiento al comprador. Fallan en silencio.

### 3.3 Stripe
El endpoint del webhook dealer pasa de
`https://carmentor.es/api/dealer/webhook` a
`https://dealer.carmentor.es/api/dealer/webhook`.
El secreto de firma cambia: actualiza `STRIPE_DEALER_WEBHOOK_SECRET`.

### 3.4 Enlaces públicos ya repartidos
`/c/[slug]`, `/q`, `/a`, `/runner`, `/seguimiento` y `/pr` se mudan al subdominio.
Cualquier enlace ya pegado en una bio de Instagram apunta al dominio viejo. Deja
redirects en la app de consumo antes de retirar `/dealer` de allí.

---

## 3.5 Trámites: gestor e ingeniero (añadido el 2026-09-09)

Sobre una operación ya guardada se pueden encargar dos servicios que hacemos
nosotros, cobrados **por encargo** (Stripe one-off, no van en la cuota):

| Servicio | Quién | Qué entrega |
|---|---|---|
| Impuestos de matriculación | gestor | Modelo 576 (IEDMT) e IVTM presentados y pagados |
| Ficha técnica reducida | ingeniero | Ficha firmada con las fotos del checklist del runner |

- Pipeline: fase nueva **Trámites** (`stage = 'tramites'`, entre `transito` y
  `entregado`). Una operación entra ahí sola cuando el webhook confirma el pago.
- El expediente de la ficha **no es una lista aparte**: sale de las fotos
  marcadas `ficha: true` en `src/lib/dealer/inspection-master.ts`, que el runner
  ya saca en su pasada normal.
- El **precio nunca está escrito en el código**: se lee del price de Stripe en
  `/api/dealer/services` y se cachea 10 min. Sin price configurado, la UI enseña
  el servicio sin botón de pago (no revienta).
- El 576 que se muestra antes de encargar es una **estimación** (`src/lib/iedmt.ts`);
  el importe real lo fija Hacienda. El IVTM depende de la ordenanza municipal y
  lo calcula el gestor — aquí solo se recogen municipio y CVF.

Para ponerlo en marcha hacen falta **dos price nuevos en Stripe** (pago único) y
sus variables: `STRIPE_SERVICE_IMPUESTOS_PRICE_ID` y `STRIPE_SERVICE_FICHA_PRICE_ID`.
El aviso interno al gestor/ingeniero sale por Brevo a `DEALER_LEADS_EMAIL`: sin
`BREVO_API_KEY` un trámite se paga y **nadie se entera**.

Esquema (aplicado ya en Supabase, y en `supabase/migrations/`): tabla
`dealer_service_orders` + el CHECK de `dealer_client_requests.stage` ampliado con
`'tramites'`.

## 3.6 Panel de colaborador (`/admin/tramites`)

Donde el gestor y el ingeniero resuelven los encargos. Mismo tema oscuro que la
app del dealer, sin sidebar ni paywall: aquí no hay perfil de dealer.

- **Acceso**: lista blanca por correo en `ADMIN_EMAILS` (separados por comas).
  No hay tabla de roles. **Variable vacía = nadie entra**: un despiste de
  configuración cierra el panel, nunca lo abre.
- **Qué hace**: cola de trámites pagados de todos los dealers, con lo que el
  dealer aportó (para impuestos: comunidad, municipio, CVF, valoración, CO2,
  576 estimado; para la ficha: las fotos del runner). Estados a mano:
  `en_tramite`, `completado`, `cancelado` — `pagado` solo lo pone Stripe.
- **Documentos**: se suben a `dealer-tramites`, un bucket **privado** (los otros
  tres del proyecto son públicos a propósito). En la base solo se guarda la ruta;
  la API entrega URLs firmadas de 1 h. Justificantes y fichas llevan datos
  fiscales y del titular.
- Al **completar**, el dealer recibe un correo con la nota y ve los documentos en
  su operación.

### `/login` (creado el 2026-09-09)

Al separar el dealer, `/login` se quedó en el monolito, pero la app del dealer,
el onboarding y este panel redirigen ahí: **el proyecto no tenía puerta**. Ahora
existe, con correo y contraseña (`useAuth.signIn` / `signUp`). Sin recuperación
de contraseña todavía.

## 4. Decisiones tomadas al separar

- **Las rutas siguen siendo `/dealer/*`.** `dealer.carmentor.es/dealer/operaciones`
  es feo, pero renombrarlas tocaría cada `href` y cada `router.push` del producto.
  La raíz `/` redirige a `/dealer`. Acortar las URLs es una segunda fase, ya en verde.
- **Layout propio, más pequeño.** No se copió el de consumo: arrastraba el chatbot,
  el píxel de Facebook, el banner de cookies y el `ReferralTracker`. Aquí solo hay
  `ErrorBoundary` + `AuthProvider`.
- **`robots: noindex`.** Ni el panel ni los enlaces tokenizados deben indexarse.
- **Cron.** El `vercel.json` de consumo tenía crons que aquí no existen. Se dejó
  solo `/api/dealer/re-search`, semanal.
- **Sin Playwright.** Los e2e del monolito prueban el flujo de consumo.

---

## 5. Lo que sigue pendiente (heredado, no lo introduce esta separación)

- **Deriva de código.** Los 47 ficheros compartidos son ahora dos copias. Ya pasó
  una vez en este producto con los dos formularios de captación. Si esto vive, el
  siguiente paso es extraerlos a un paquete común.
- **Deriva de esquema.** `dealer_clients` y `dealer_client_requests` no tienen
  migración de creación: la base viva está bien, pero una reconstrucción desde cero
  falla. Ver `docs/DEALER.md §3` en el proyecto original.
- **El cambio del checklist del runner** (fotos de la ficha técnica reducida) está
  **sin commitear en el proyecto viejo**. Si lo quieres aquí, hay que traerlo.

## Comandos

```bash
npm run dev     # puerto 3001, para no chocar con el monolito
npm run build
npm run lint
```
