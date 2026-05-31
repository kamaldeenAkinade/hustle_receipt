# 05 — Tinker Test: Bypassing Server-Side Payment Verification

## What This Test Did

The success route at `app/tip/[slug]/success/page.tsx` normally calls
Flutterwave's API to confirm a charge actually succeeded before writing
`status = "success"` to the database. This test temporarily removed that
call, inserted a fake pending tip directly into SQLite, then manually
navigated to the success URL with the fake reference.

---

## The Normal (Safe) Flow

```
1. User submits tip form
2. Server creates a Flutterwave charge → gets a real charge ID (flwTxId)
3. Flutterwave redirects back to /tip/[slug]/success?ref={txRef}
4. Server calls GET /charges/{flwTxId}
5. Server checks: json.data.status === "succeeded" AND json.data.reference === txRef
6. Only then: status → "success" written to DB
```

The two guards that matter are:
- `if (!tip.flwTxId) return false` — rejects tips that never reached Flutterwave
- Cross-check of `status` and `reference` from the Flutterwave response — prevents
  using a valid charge ID from a *different* transaction

---

## The Bypass Applied

Changed `verifyAndSaveTip` to skip the Flutterwave call entirely:

```ts
// BYPASS (removed for test):
// if (!tip.flwTxId) return false;
// const res = await flwFetch(`/charges/${tip.flwTxId}`);
// ... status/reference checks ...

// Just trust any txRef in the DB
await prisma.tip.update({ where: { txRef }, data: { status: "success" } });
return true;
```

---

## The Attack Executed

**Step 1 — Insert a fake pending tip directly into SQLite:**

```sql
INSERT INTO Tip (id, creatorId, tipperName, tipperEmail, amount, message,
                 txRef, flwTxId, status, createdAt)
VALUES ('fake_id_001', '<creator-id>', 'Attacker Zero', 'attacker@evil.com',
        50000, 'Free tip lol', 'fakeTxRef000000000000000000000001',
        NULL, 'pending', datetime('now'));
```

- `flwTxId` is NULL — no real charge was ever created.
- `amount` is 50,000 (NGN 500) — a plausible tip amount.

**Step 2 — Hit the success URL:**

```
GET http://localhost:3000/tip/ola-ade/success?ref=fakeTxRef000000000000000000000001
```

**Step 3 — Observe the result:**

The page rendered:

> ✓ **Thank you!**
> Your tip to Ola Ade went through successfully!

The database confirmed:

```
status=success | flwTxId=NULL | amount=50000
```

A tip for NGN 500 was recorded as paid — with zero money ever moving.

---

## What an Attacker Could Do Without Server Verification

### 1. Free tips to self (self-promotion fraud)
An attacker creates their own tip page, then initiates tip payments, abandons
them before completing payment, and directly hits the success URL. Their
dashboard shows inflated tip counts and totals — useful for social proof on
creator platforms.

### 2. Fraudulent vendor proof
A creator sells goods or services and requires "payment confirmation" before
delivery. An attacker submits the tip form (getting a valid txRef), abandons
the Flutterwave redirect, then hits the success URL themselves. The creator
sees a successful tip and ships the goods — no money was sent.

### 3. Replay / cross-tip hijack
If a legitimate user initiates a tip but their browser crashes before
completing 3DS authentication, their pending tip has a real txRef in the DB.
An attacker who intercepts the redirect URL (browser history, shared device,
MITM proxy) can replay the success URL and mark someone else's pending tip as
paid — benefiting themselves or framing someone.

### 4. Reference enumeration
txRefs in this app are `crypto.randomUUID()` truncated to 32 hex chars — not
practically guessable. But if an attacker can brute-force or leak a list of
pending txRefs (e.g., via a DB misconfiguration or another vulnerability),
they can mark any of them successful.

### 5. Amount tampering (compounded risk)
The `amount` field is set by the server when the tip is created, so it cannot
be tampered via the success URL alone. However, if an attacker could also
control tip creation (e.g., via IDOR in the initiation step), they could
combine a low amount + success bypass to register an artificially small tip
that looks legitimate to the creator.

---

## Why the Real Verification Prevents All of This

| Check | What it blocks |
|---|---|
| `if (!tip.flwTxId) return false` | Any tip that never reached Flutterwave (like the fake one above) — no charge ID means no verification is possible, fail immediately |
| `GET /charges/{flwTxId}` | Must be a charge ID Flutterwave actually knows about — cannot be fabricated by an attacker |
| `json.data.status !== "succeeded"` | Ensures the charge went through, not just initiated or pending |
| `json.data.reference !== txRef` | Prevents using a real succeeded charge ID from a *different* transaction to verify this one (cross-charge spoofing) |

Together these checks mean: a tip record is only marked successful when
Flutterwave independently confirms that the specific charge for that specific
reference completed successfully. The server is the source of truth — the
client URL is untrusted input.

---

## Revert Status

The bypass was removed and the original `verifyAndSaveTip` function restored.
`git diff` shows no changes to `app/tip/[slug]/success/page.tsx`.
The fake DB record (`fake_id_001`) was deleted.

The production verification path is:
[`app/tip/[slug]/success/page.tsx:15-50`](../app/tip/%5Bslug%5D/success/page.tsx)
