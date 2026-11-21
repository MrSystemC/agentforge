# Security policy

## Supported versions

Security fixes are applied to the latest version on `main`.

## Production requirements

- set `NODE_ENV=production`;
- use `AUTH_MODE=required`;
- generate a unique `SESSION_SECRET` with at least 32 characters;
- set a strong `ADMIN_PASSWORD` and keep `.env` outside version control;
- set `COOKIE_SECURE=true` behind HTTPS;
- configure `ALLOWED_ORIGINS` with the exact public origin;
- keep the persistent `data` volume private and back it up;
- place TLS termination and network access control in front of the application.

## Reporting

Do not publish credentials, session cookies, database exports or private Agent Passports in an issue. Report a suspected vulnerability privately to the project owner.
