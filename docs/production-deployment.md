# Production Deployment Guide

## 1. Required environment variables

Create a production `.env` file next to `docker-compose.yml` with values like:

```env
POSTGRES_USER=atlas
POSTGRES_PASSWORD=replace-with-strong-password
POSTGRES_DB=api_platform

JWT_SECRET=replace-with-long-random-secret

APP_URL=https://your-domain.com
FRONTEND_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=/api/v1

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## 2. Build and run

```bash
docker compose up -d --build
```

The stack starts:

- `postgres`
- `redis`
- `backend`
- `frontend`
- `nginx`

## 3. Stripe webhook setup

In the Stripe dashboard:

1. Create a webhook endpoint.
2. Point it to:

```text
https://your-domain.com/api/v1/recharge/webhooks/stripe
```

3. Subscribe at least to:

```text
checkout.session.completed
```

4. Copy the webhook signing secret into:

```text
STRIPE_WEBHOOK_SECRET
```

## 4. Local Stripe testing

If you use Stripe CLI locally:

```bash
stripe listen --forward-to localhost:3001/api/v1/recharge/webhooks/stripe
```

Then copy the CLI-provided webhook secret into `backend/.env`.

## 5. Nginx and TLS

The included `nginx.conf` is ready for reverse proxy on port `80`.
For production, terminate TLS in one of these ways:

- Put Cloudflare in front and proxy traffic to the server.
- Add a certbot or Caddy layer for `443`.
- Use a cloud load balancer with TLS termination.

## 6. New Singapore server checklist

1. Provision Ubuntu or Debian.
2. Install Docker and Docker Compose plugin.
3. Open ports `80` and `443`.
4. Upload the project.
5. Create the production `.env`.
6. Run `docker compose up -d --build`.
7. Attach the Stripe webhook.
8. Test:
   - `/`
   - `/chat`
   - `/dashboard`
   - `/pricing`
   - `/privacy`
   - `/terms`
   - Stripe checkout

## 7. Remaining production tasks

Before public launch, still plan to add:

- TLS termination on `443`
- automated database backups
- log shipping and alerting
- legal review for policy pages
- real manual-payment integrations if you want Alipay or WeChat Pay
