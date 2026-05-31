# Payment Integration Principles — Mapped to This Codebase

This document takes five foundational principles of payment engineering and shows exactly where each one lives in this project — which file, which line, and what would break if you ignored it.

The goal is not just to describe what the code does. It is to explain *why* these patterns exist, what real attack or failure they prevent, and how to recognise them in any payment integration you work on in the future.

---

## Principle 1 — Trust Boundaries Between Client and Server

### What the principle says

Every system that processes payments has two zones: code that runs in the user's browser, and code that runs on your server. These zones have fundamentally different levels of trust.

**The browser is not your machine.** You deploy code there, but you do not control it. A user can open DevTools, pause execution, modify variables, and replay network requests with altered payloads. A sophisticated user can do all of this without you knowing.

**Your server is your machine.** Code that runs there is only accessible to people you authorise. Users interact with its *outputs*, never its *internals*.

The principle is: **sensitive logic and secret values must only ever exist on the server side of this boundary.** If it would hurt you for a user to read it, modify it, or replay it — it does not belong in the browser.

### Where this lives in the code

**The boundary is declared explicitly at the top of every file.**

```ts
// app/tip/[slug]/TipForm.tsx
"use client";
```

This directive tells Next.js: this file runs in the browser. The user can see every function, every value, every import. Treat it as public.

```ts
// app/actions/tip.ts
"use server";
```

This directive tells Next.js: this file runs on the server. The user's browser never receives this code. It is never bundled into the JavaScript sent to the browser. It does not exist from the browser's perspective.

**The encryption key sits on the server side of the boundary.**

```ts
// app/actions/tip.ts
const encKey = process.env.FLW_ENCRYPTION_KEY;
```

`process.env` is a Node.js object. It only exists on the server. `FLW_ENCRYPTION_KEY` is a secret that Flutterwave uses to decrypt card details. If a user could read it, they could decrypt every card number you've ever processed. It never crosses into `TipForm.tsx`, never appears in a response, never touches the browser.

**The card number is encrypted before anything leaves your server.**

```ts
// app/actions/tip.ts
[encCardNum, encExpMonth, encExpYear, encCvv] = await Promise.all([
  encryptCardField(cardNumber, encKey, nonce),
  ...
]);
```

The raw card number arrives from the browser in a form submission. That form submission travels from the browser to your server over HTTPS — encrypted in transit, but briefly plaintext at arrival on your server. The *moment* it arrives, before it is sent anywhere else, you encrypt it again with AES-GCM. What you send to Flutterwave is ciphertext. The raw card number never leaves your server.

**The success page is a Server Component.**

```ts
// app/tip/[slug]/success/page.tsx
export default async function SuccessPage({ params, searchParams }: Props) {
```

There is no `"use client"` directive. This function runs on the server. The verification logic inside it — the database lookup, the Flutterwave API call — is not accessible to the browser. The user cannot intercept it, modify it, or bypass it. They can only receive the HTML it produces.

### What breaks if you ignore it

If you put your `FLW_ENCRYPTION_KEY` in a client component, it gets bundled into your JavaScript and sent to every visitor's browser. It would be visible in the browser's Sources tab within seconds. Anyone who found it could decrypt card data.

If you put payment verification logic in a client component, users could modify the JavaScript to always return `true` from the verification check and mark tips as successful without paying.

---

## Principle 2 — Server-Side Verification as the Only Source of Truth

### What the principle says

When a payment provider redirects the user back to your site, it typically passes some information in the URL — a status, a transaction ID, a reference. This information travelled through the user's browser to get to you. **It cannot be trusted.**

The only trustworthy answer to "did this payment succeed?" is a response from the payment provider's API, fetched directly from your server, using your private credentials. That call never passes through the user's browser. It cannot be intercepted or forged.

This is not a minor security detail. It is the central axiom of payment integration: **your server must independently confirm every payment, every time, from the source.**

### Where this lives in the code

**The URL only carries a reference — never a status.**

```ts
// app/actions/tip.ts
redirect_url: `${baseUrl}/tip/${slug}/success?ref=${txRef}`,
```

When Flutterwave redirects the user back to your site, the URL contains `?ref={txRef}` — nothing else you set. Just your own reference number.

Compare this to what you *could* do:

```ts
// What you must NOT trust
redirect_url: `${baseUrl}/tip/${slug}/success?status=succeeded&ref=${txRef}`,
```

Even if Flutterwave puts `?status=succeeded` in the URL, that URL passed through the user's browser. The user could have typed it themselves. Your app must not act on it.

**The reference alone proves nothing — it must be looked up and verified.**

```ts
// app/tip/[slug]/success/page.tsx
const txRef = sp.ref as string | undefined;
const verified = await verifyAndSaveTip(txRef);
```

The `txRef` value from the URL is passed to a server function. What happens inside that function is the principle in action.

**Step one: confirm the reference exists in your own database.**

```ts
const tip = await prisma.tip.findUnique({ where: { txRef } });
if (!tip) return false;
```

If someone typed a random reference into the URL, it won't exist in your database. They cannot invent a `txRef` that your server will accept, because the `txRef` was generated by your server and stored before the charge was created.

**Step two: confirm the charge ID was saved.**

```ts
if (!tip.flwTxId) return false;
```

When the charge was created, your server saved Flutterwave's charge ID into the database row. If that field is empty, the charge never completed on your server's side. The payment never reached Flutterwave.

**Step three: ask Flutterwave directly.**

```ts
const res = await flwFetch(`/charges/${tip.flwTxId}`);
json = await res.json();
```

This is a server-to-server HTTP request, authenticated with your OAuth token. The user's browser is not involved. Flutterwave's response comes directly to your server.

**Step four: check two things, not one.**

```ts
if (
  json.data?.status !== "succeeded" ||
  json.data?.reference !== txRef
) {
  await prisma.tip.update({ where: { txRef }, data: { status: "failed" } });
  return false;
}
```

Both conditions must pass:

- `status === "succeeded"`: Flutterwave confirms money moved.
- `reference === txRef`: the charge Flutterwave describes is the *same charge* your server created for this specific tip.

The second check closes a subtle attack. Imagine a malicious user who previously made a real payment with charge ID `chg_aaa`. They navigate to your success page and tamper with something to supply `chg_aaa` for a new tip where they never paid. The status would be "succeeded" — because `chg_aaa` really did succeed, once, for something else. But the reference on that charge (`some_old_txRef`) won't match the new `txRef`. The check fails. The tip is not credited.

**Step five: only then write success to the database.**

```ts
await prisma.tip.update({
  where: { txRef },
  data: { status: "success" },
});
return true;
```

The database record changes to "success" exactly once, after Flutterwave confirms it. This is the authoritative record. The dashboard and the API route read from this status.

### What breaks if you ignore it

The simplest attack: a user navigates to `/tip/ada-okonkwo/success?ref=abc123` without ever paying. If your success page trusts the URL and marks the tip as successful, the creator sees a fake tip in their dashboard. For real money platforms, this means crediting accounts with money that never arrived.

---

## Principle 3 — Idempotency for Repeated Callback Hits

### What the principle says

The internet is unreliable. Networks drop. Browsers refresh. Users double-click. Payment providers retry webhooks. Any callback or redirect endpoint can be hit more than once for the same transaction.

**Idempotency** means: running the same operation more than once produces the same result as running it once. An idempotent function is safe to call repeatedly. An operation that charges a card, creates a database record, or credits an account must be idempotent. Without this, a network retry becomes a double charge.

### Where this lives in the code

**The transaction reference is unique at the database level.**

```prisma
// prisma/schema.prisma
model Tip {
  txRef  String  @unique
  ...
}
```

`@unique` creates a database constraint. If your code ever tries to insert two Tip rows with the same `txRef`, the database rejects the second one with an error. This is a hard guarantee — it does not depend on your application logic being correct. Even if a bug caused you to call `prisma.tip.create` twice for the same transaction, only one row would exist.

**The verification function checks the current status before doing work.**

```ts
// app/tip/[slug]/success/page.tsx
if (tip.status === "success") return true;
```

This is the explicit idempotency guard. If the success page is loaded twice — because the user refreshed, or because the redirect happened twice, or because a webhook was retried — the second call hits this line. The tip is already marked as success. Return true immediately. Do not call Flutterwave again. Do not update the database again. The result is the same as if it were called once.

Without this guard, every refresh would make a fresh API call to Flutterwave and attempt a fresh database write. Not catastrophic here, but expensive and fragile — and in a webhook context where the payment provider charges per verification API call, it could become costly.

**The tip is written to the database as "pending" before the charge.**

```ts
// app/actions/tip.ts
await prisma.tip.create({
  data: {
    ...
    txRef,
    status: "pending",
  },
});
```

The tip record exists in the database before the charge is created. This means if the charge creation fails, or the server crashes, or the redirect never happens — there is a record of the attempt. You can query for pending tips older than a threshold and reconcile them against Flutterwave. You are not flying blind.

**The `txRef` is generated once per transaction, at the start.**

```ts
const txRef = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
```

This runs once, before any API calls. The same reference is passed to the charge creation and stored in the database. It is the thread that ties together your record, Flutterwave's charge, and the verification check. Because it is unique (enforced by the database constraint above), two requests can never share a reference.

### What breaks if you ignore it

Without the `@unique` constraint on `txRef`, a double-click on the Submit button could create two charge attempts, two database rows, and two credits to the creator — for one payment.

Without the early return on `status === "success"`, a user who refreshes the success page multiple times would cause multiple Flutterwave API calls. If you had post-payment logic like sending confirmation emails, it would fire on every refresh.

Without saving the `flwTxId` before redirecting, a server restart between the charge creation and the callback would mean the success page has no charge ID to verify against, and the tip would be permanently stuck as "pending."

---

## Principle 4 — Separation of Test and Production Keys

### What the principle says

Payment providers give you two sets of credentials: a sandbox set for testing and a production set for real money. These are not interchangeable. Sandbox credentials do not charge real cards. Production credentials charge real cards immediately.

The separation must be enforced at every level:

- Different credential values
- Different API base URLs
- A switch that is explicit and visible — not implicit based on a Node.js flag like `NODE_ENV`

The reason it must be explicit: `NODE_ENV=production` is set by deployment platforms like Vercel on every deploy, including deploys where you are still testing. If your code routes to the live API based on `NODE_ENV`, your test credentials will be sent to the live payment API the moment you deploy — and in this project, that caused a 403 Forbidden error until it was caught and fixed.

### Where this lives in the code

**Two base URLs, never mixed.**

```ts
// lib/flutterwave.ts
const SANDBOX_BASE = "https://developersandbox-api.flutterwave.com";
const PROD_BASE    = "https://f4bexperience.flutterwave.com";
```

These are different domains. Flutterwave runs completely separate infrastructure for sandbox and production. A credential for one will not work on the other. Keeping the constants named and separated makes it easy to audit which one you are using.

**The switch is controlled by `FLW_ENV`, not `NODE_ENV`.**

```ts
// lib/flutterwave.ts
export const FLW_BASE =
  process.env.FLW_ENV === "production" ? PROD_BASE : SANDBOX_BASE;
```

`FLW_ENV` is a variable you set yourself. It defaults to sandbox unless you explicitly set it to `"production"`. You can deploy to Vercel with `NODE_ENV=production` (which you cannot avoid — Next.js requires it for production builds) while keeping `FLW_ENV=sandbox` during testing.

In `.env.local`:
```
FLW_ENV=sandbox
```

In Vercel production environment variables:
```
FLW_ENV=sandbox   ← during testing
FLW_ENV=production ← only when you have real Flutterwave production credentials
```

**The credentials are separate environment variables.**

```
FLW_CLIENT_ID=...
FLW_CLIENT_SECRET=...
FLW_ENCRYPTION_KEY=...
```

When you eventually get real production Flutterwave credentials, they will have different values. You set `FLW_ENV=production` in Vercel and replace these three values with the live ones. The code does not change. The switch is purely configuration.

**The sandbox test card hint in the form.**

```tsx
// app/tip/[slug]/TipForm.tsx
<div className="mt-3 rounded-lg bg-zinc-800/60 ...">
  <span>Sandbox test card:</span>
  5531 8866 5214 2950 &nbsp;·&nbsp; 09 / 32 &nbsp;·&nbsp; CVV: 564
</div>
```

Test card numbers are published by Flutterwave. They work only against the sandbox API. They are not real card numbers. Showing them in the UI during development makes testing fast. When you go live, you remove this hint — it would confuse real users and real cards work against the real API anyway.

### What breaks if you ignore it

This is the failure mode that actually occurred in this project. The original code was:

```ts
// The bug
export const FLW_BASE =
  process.env.NODE_ENV === "production" ? PROD_BASE : SANDBOX_BASE;
```

When deployed to Vercel, `NODE_ENV` is always `"production"`. The app routed sandbox credentials (`FLW_CLIENT_ID`, `FLW_CLIENT_SECRET`) to Flutterwave's production API. Flutterwave's production API rejected them with `HTTP 403 Forbidden`. No payment could be processed on the deployed app.

The fix was one line — replacing `NODE_ENV` with a purpose-built `FLW_ENV` variable. But the lesson is larger: **never use a platform flag to control which payment environment you are in.** Use a variable whose only job is that decision.

---

## Principle 5 — Never Logging or Exposing Secret Keys

### What the principle says

Secret keys — API credentials, encryption keys, session secrets — must never appear in:

- Log output (application logs, server logs, error tracking services)
- Error messages returned to the browser
- Source control (git history)
- Client-side JavaScript bundles

This principle is not about being careless. It is about recognising that logs, error responses, and git repositories travel to many places you do not fully control. Logs get aggregated to third-party services. Error messages get copied into bug reports. Git history lives forever — even after you delete a file, the secret can be recovered from the commit history.

### Where this lives in the code

**Secrets are in `.env.local`, which is gitignored.**

```
// .gitignore
.env
.env.local
.env*.local
```

`.env.local` contains every secret in the project:

```
SESSION_SECRET=...
FLW_CLIENT_ID=...
FLW_CLIENT_SECRET=...
FLW_ENCRYPTION_KEY=...
DATABASE_AUTH_TOKEN=...
```

None of these will ever be committed to the git repository. The `.gitignore` entry is a permanent guarantee. If you clone this repo fresh on another machine, there is no `.env.local`. You must create it. This is intentional — it forces anyone setting up the project to provision their own credentials, and it means no credentials ever travel through git.

**Secrets are only read inside server-side code.**

```ts
// app/actions/tip.ts — "use server" file
const encKey = process.env.FLW_ENCRYPTION_KEY;
const clientId = process.env.FLW_CLIENT_ID;
const clientSecret = process.env.FLW_CLIENT_SECRET;
```

These are read inside a `"use server"` file. Next.js strips all server-side code from the browser bundle. Even if you accidentally `console.log(encKey)` here, the log goes to the server's stdout — visible in Vercel's function logs, not in the user's browser console.

In `"use client"` components like `TipForm.tsx`, `process.env` is still accessible but only for `NEXT_PUBLIC_` prefixed variables. If you wrote `process.env.FLW_ENCRYPTION_KEY` in a client component, Next.js would substitute it with `undefined` at build time and emit a warning — because it refuses to bake secrets into the browser bundle.

**Error messages expose Flutterwave errors, not your credentials.**

```ts
// app/actions/tip.ts
return {
  message: `Customer creation failed (HTTP ${customerRes.status}): ${apiMsg}`,
};
```

When an API call fails, the error message shown to the user contains:
- The HTTP status code (public information)
- Flutterwave's error message (already in the Flutterwave API response — not your secret)

It does not contain:
- `FLW_CLIENT_ID`
- `FLW_CLIENT_SECRET`
- `FLW_ENCRYPTION_KEY`
- The OAuth access token
- The raw card number
- The database URL or auth token

**The CVV field uses `type="password"`.**

```tsx
// app/tip/[slug]/TipForm.tsx
<input
  id="cvv"
  name="cvv"
  type="password"
  ...
/>
```

`type="password"` masks the input in the browser. This prevents shoulder-surfing (someone physically looking at the screen), and it tells the browser not to autocomplete or save this value to its autofill database. CVV codes are not meant to be stored — Flutterwave requires them for the transaction but they should not persist anywhere after use.

**The OAuth access token is cached in server memory only.**

```ts
// lib/flutterwave.ts
let _cachedToken = "";
let _tokenExpiresAt = 0;
```

The OAuth token obtained from Flutterwave's identity server is held in a module-level variable. This exists only in the Node.js process running on Vercel's servers. It is never written to the database, never sent to the browser, never logged. It lives in memory for the duration of the process and is discarded when the serverless function instance is recycled.

### What breaks if you ignore it

**Committing a secret to git is permanent.** Git stores the entire history of every file. Deleting the file in a new commit does not remove the secret from the old commit. Anyone who clones the repo — now or in ten years — can run `git log -p` and find it. Services like GitHub scan public repositories for known credential patterns and notify providers like Flutterwave, who will immediately revoke the key. If your project was public for even a few minutes with a live production key, assume it was found.

**Logging a secret is nearly as bad.** Application logs for production services are typically aggregated to third-party platforms (Datadog, Sentry, Papertrail). Your credential would be stored on a third-party server, potentially indexed, potentially visible to their support staff. Credentials in logs are one of the most common sources of account compromise.

**Returning a secret in an error message** means the user's browser receives it. The browser caches responses. The user might screenshot the error. The secret is now on their device.

---

## How the five principles interlock

These principles are not independent rules. They form a system.

**Trust boundaries** define which code can access secrets — only server-side code.

**No logging of secrets** enforces that even in server-side code, secrets do not leak out through side channels.

**Separation of test and production keys** ensures that testing never affects real money, and the switch between them is always a deliberate choice.

**Server-side verification as the only source of truth** closes the gap that trust boundaries leave open — even though the server controls verification, the user still supplies the transaction reference, so the verification must be independent and authoritative.

**Idempotency** makes all of the above safe to run in an unreliable network — the guarantees hold whether a callback arrives once or ten times.

A payment integration that implements all five is one that handles adversarial users, unreliable networks, deployment environments, and human error in configuration. One that skips any of them is one incident away from a serious failure.
