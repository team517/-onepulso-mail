# onepulso · mail

Plataforma de cold email independiente. SMTP + IMAP, sin tracking de terceros.

## Qué incluye

- **Cuentas** (`/connect-accounts`): conecta cuentas vía SMTP/IMAP, bulk CSV (esquema Evadan), bulk IONOS, tags
- **Campañas** (`/email-campaigns`): secuencias multi-step con variantes A/B, spintax `{a|b|c}`, variables `{{first_name}}`, CSV de leads, schedule (días + franja + timezone), opciones estilo Instantly
- **Worker** de envíos: 1 email/cuenta cada 6-9 min (random), sticky sender, rotación round-robin/random, respeta schedule + daily limit + blocklist
- **Unibox** (`/bandejas`): bandeja unificada IMAP de todas las cuentas, filtra warmup + bounces, threading, responder (con APPEND a Sent), programar follow-up condicional ("solo si no responden"), bloquear remitente (quita el lead de TODAS las campañas), registro de enviados, eliminar (mueve a Papelera IMAP)

## Tech

- Next.js 16 (app router) · React 19
- TypeScript
- nodemailer + imapflow + mailparser
- Postgres (via `DATABASE_URL`) o filesystem en dev
- Sin Tailwind — todo inline styles consistentes con el design system del landing

## Variables de entorno

```bash
DATABASE_URL=postgres://...        # Postgres en prod (Railway lo provee)
AUTH_EMAIL=tu@email.com            # login admin
AUTH_PASSWORD=tu-password
AUTH_SECRET=<<random-32-chars>>    # cookie secret
```

## Local

```bash
npm install
npm run dev
# http://localhost:3000
```

## Deploy (Railway)

1. Conecta el repo `team517/onepulso-mail` a Railway
2. Añade un servicio **Postgres**
3. Variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}` + las de arriba
4. Generate Domain → listo

Railway detecta el `Dockerfile` automáticamente.
