# Recipe Rhythm — TODO

## Security

- [ ] **Decide whether to rotate the exposed Supabase anon key** (AUDIT C2, 2026-04-18)
  - Exposure: the real `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` were committed to `.env.example` at `a161f16` (initial scaffold) and `064c5a0` (update), so they remain in git history. `.env.example` has now been scrubbed to placeholders, but history rewriting is only worthwhile if combined with rotation.
  - Anon key guidance: a Supabase anon key is safe to publish **only if** Row-Level Security (RLS) is correctly configured on every table and storage bucket (`meals`, `vault`, `meal_plans`, `recipe_images`). Per AUDIT C3 this is unverified.
  - Decision tree:
    1. Audit RLS in the Supabase dashboard (or via `supabase db dump`) for each table/bucket.
    2. If any policy is missing or permissive → **rotate the anon key** (Supabase → Project Settings → API → "Reset anon key"), then update the real `.env` locally and in every deployment target (Vercel/Netlify/etc.), and redeploy.
    3. If RLS is fully locked down → no rotation needed; document the policies in-repo (addresses AUDIT H3) and close this item.
  - Note: rewriting git history to purge the old key is optional — with RLS in place the value is public-safe by design. Only bother if rotation happens and you also want the old value off GitHub.
- [ ] **Fix high-severity Vite vulnerability** (reported 2026-04-18 by `npm audit`)
  - Package: `vite` 8.0.0 – 8.0.4 (currently installed)
  - Advisories:
    - [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) — Path traversal in optimized deps `.map` handling
    - [GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r) — `server.fs.deny` bypassed with queries
    - [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583) — Arbitrary file read via dev-server WebSocket
  - Fix: `npm audit fix` (upgrades Vite past 8.0.4). Re-run `npm run test:unit -- --run` and `npm run build` afterward to confirm nothing regressed.
  - Impact: dev-server only — no production exposure, but still worth patching.
