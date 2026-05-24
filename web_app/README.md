# Voter Management SaaS (Vercel + Neon)

Next.js App Router app deployable to Vercel, backed by Neon Postgres via Prisma.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (Neon connection string with `sslmode=require`), `NEXTAUTH_SECRET`, and `STAFF_PASSWORD_HASH` (bcrypt hash).
   - Generate hash: `node -e "console.log(require('bcryptjs').hashSync('your-password', 10))"`
3. `npx prisma db push` — provision the `Voter` table on Neon.
4. From `../etl_pipeline`, run `python neon_etl.py --input voters.json` with `DATABASE_URL` set to load voters.
5. `npm run dev` — log in at `/login` with `STAFF_USERNAME` and the password matching the hash.

## Pages

- `/` — Family tree dashboard with power search and sentiment filter.
- `/duty-staff` — Upload XLSX, flag matching voters.
- `/exports` — PDF and XLSX exports.

## Notes

- Place `JameelNooriNastaleeq.ttf` in `public/fonts/` to enable the custom Urdu font; the app falls back to Noto Nastaliq Urdu and system fonts otherwise.
- `middleware.ts` protects every page except `/login` and the NextAuth API routes.
