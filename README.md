
<div align="right">
  <details>
    <summary >🌐 Language</summary>
    <div>
      <div align="center">
        <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=en">English</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=zh-CN">简体中文</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=zh-TW">繁體中文</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=ja">日本語</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=ko">한국어</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=hi">हिन्दी</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=th">ไทย</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=fr">Français</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=de">Deutsch</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=es">Español</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=it">Itapano</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=ru">Русский</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=pt">Português</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=nl">Nederlands</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=pl">Polski</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=ar">العربية</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=fa">فارسی</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=tr">Türkçe</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=vi">Tiếng Việt</a>
        | <a href="https://openaitx.github.io/view.html?user=Uaghazade1&project=kanba&lang=id">Bahasa Indonesia</a>
      </div>
    </div>
  </details>
</div>

<div align="center">
  <br />
<br />
<a href="https://kanba.co">
  <img alt="Kanba" src="https://www.kanba.co/dark-hero.png" style=" width: 800px " />
</a>
    <br />
<br />
</div>

<div align="center">
  <br />
<br />
<a href="https://vercel.com/oss">
  <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge.svg" />
</a>
    <br />
<br />
</div>
# Open-source, lightweight Trello alternative designed for makers and indie hackers.

Focus on simplicity, speed, and scalability.
Built with modern stack: Tailwind CSS, shadcn/ui, Postgres, Stripe integration.
Supports unlimited projects, team collaboration, dark/light mode, and seamless user experience.
Perfect for solo devs and small teams who want full control without unnecessary complexity.

## 🌟 If you find this project useful, consider giving it a star! It helps others discover it too.

# Self-hosting

> [!NOTE]
> This is a fork of [Kanba](https://github.com/Kanba-co/kanba) that runs without Supabase. Everything lives in one Postgres database that you host. There is no outside service to sign up for.

## Run it with Docker

```bash
git clone https://github.com/cristianlanderos/kanba.git
cd kanba
cp .env.example .env    # then set POSTGRES_PASSWORD
docker compose up -d --build
```

The board is at http://localhost:3000. Open `/signup` to make the first account. The first start creates the database schema, and every later start brings it up to date.

| Setting | Does |
| --- | --- |
| `POSTGRES_PASSWORD` | The password of the database that Docker starts. Required |
| `KANBA_ALLOW_SIGNUP` | `true` lets anyone who opens the site make an account. Set it to `false` once your people have theirs |
| `KANBA_DEFAULT_PLAN` | `pro` (the default) gives new accounts unlimited projects. `free` keeps the limit of one, for a site that sells the upgrade through Stripe |
| `KANBA_PORT` | The port on your machine. The default is 3000 |
| `KANBA_DATA` | A folder for the database files. Without it, Docker keeps them in a volume |
| `KANBA_UPLOADS_DIR` | A folder for the images on tasks. Without it, Docker keeps them in a volume |

Back up the database with `docker exec kanba-db pg_dump -U kanba kanba > kanba.sql`.

## Run it for development

You need Node 20 and a Postgres 14 or newer whose user owns the database.

```bash
npm install
export DATABASE_URL=postgresql://kanba:password@localhost:5432/kanba
npm run db:migrate
npm run dev
```

## What replaced Supabase

The screens still import a client named `supabase` from `lib/supabase.ts`, with the same methods, so they did not change. What stands behind it did:

| Supabase did | Now |
| --- | --- |
| Data API (PostgREST) | `app/api/db` and `lib/server/query.ts` turn each query into SQL, with every name checked against the database catalog and every value sent as a parameter |
| Row level security | Unchanged. Each query runs as the signed-in user, and the policies in `supabase/migrations` decide what that user sees |
| Auth | `app/api/auth` and `lib/server/auth.ts`: email and password, scrypt hashes, and an HttpOnly session cookie |
| Realtime | The notification bell asks again every 15 seconds |
| Database | The same migrations, replayed by `scripts/migrate.js` after `db/000_base.sql` gives a plain Postgres the roles and the `auth` schema they expect |

Three things differ from the original:

- **No Google or GitHub sign-in.** Accounts use email and password.
- **No email.** The server sends none, so a new account is not confirmed by email. For a forgotten password, run `docker exec -it kanba node scripts/set-password.js ana@example.com` on the server.
- **Images on tasks.** Open a task with Edit, then add pictures by button, paste or drop. The first one is the card's cover. The files stay on the server's disk, and only people who may see the task can load them.
- **A shared board link** is read by the server for its token (`app/api/share`). Without signing in, nobody reads anything else.

## Stripe (optional)

Billing is off until you set `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`. Point the Stripe webhook at `/api/stripe/webhook`.
