# Cross-Check — Completing a Tip Without Paying

**Question:** *How could an attacker complete a tip on the dashboard without actually paying?*

This document re-examines the payment flow from the attacker's perspective. It assumes the attacker controls their own browser (can modify form data, URL parameters, and network requests) but does not control the server or the Flutterwave API.

---

## Attack Surface Overview

The payment flow has three code paths that write `status: "success"` to the database:

| Path | Trigger | Independent Verification? |
|------|---------|--------------------------|
| **A** | `chargeData.status === "succeeded"` (charge creation response) | **No** — skipped by idempotency guard |
| **B** | `pinData?.status === "succeeded"` (PIN authorization response) | **No** — skipped by idempotency guard |
| **C** | `verifyAndSaveTip` (success page, after 3DS redirect) | **Yes** — makes GET /charges from server |

The existing audit (`docs/03-audit.md`) focused on path **C** — the 3DS redirect path — and correctly concluded that `verifyAndSaveTip` independently confirms the charge. But paths **A** and **B** were not examined as attack surfaces. They are the subject of this cross-check.

---

## Attack 1 — Race the immediate-success path before settlement reversal

### How it works

Path **B** marks the tip as "success" based on a single `PUT /charges/{id}` (PIN) response:

```ts
// app/actions/tip.ts — lines 243–248
if (pinData?.status === "succeeded") {
  await prisma.tip.update({
    where: { txRef },
    data: { status: "success" },        // ← marks success immediately
  });
  redirect(`/tip/${slug}/success?ref=${txRef}`);
}
```

When the success page loads, the idempotency guard in `verifyAndSaveTip` returns `true` without calling Flutterwave again:

```ts
// app/tip/[slug]/success/page.tsx — line 20
if (tip.status === "success") return true;   // ← never calls GET /charges/{id}
```

Path **A** has the same structure — `chargeData.status === "succeeded"` writes `"success"` and redirects, and the success page never re-verifies.

### What the attacker needs

A card that Flutterwave's charge API initially classifies as `"succeeded"` but which later reverses at settlement. Examples of real cards that behave this way:

- **Prepaid cards with insufficient balance** — the issuer authorises the transaction (card scheme says "succeeded") but later rejects the capture request during settlement.
- **Corporate cards with daily limits** — the authorisation passes within the limit window, but the transaction settles after the limit resets or has been consumed by other transactions.
- **Cards flagged by post-authorisation fraud screening** — the issuer's fraud system approves at authorisation time but flags the transaction during the post-auth review, triggering a reversal.

### Why the platform never catches the reversal

Flutterwave would send a webhook notification for the reversal. **This project has no webhook handler.** The payment confirmation relies entirely on the synchronous redirect + `verifyAndSaveTip` pattern. There is no endpoint that processes `charge.failed` or `charge.reversed` webhook events.

The tip remains `"success"` in the database permanently. The creator's dashboard shows the tip. The entire ₦ amount is counted. No mechanism ever downgrades it.

### Detection difficulty

The attacker does not need to intercept any request or modify any code. They submit a legitimate tip form. The charge processes normally. The reversal happens hours or days later — long after the attacker has left. The initial charge creation, PIN authorization, redirect, and success page rendering all succeed with valid HTTP exchanges. No log entry looks suspicious.

---

## Attack 2 — Reuse a charge ID across two tips (flwTxId collision)

### The structural weakness

The `flwTxId` field on the Tip model has **no unique constraint**:

```prisma
// prisma/schema.prisma — lines 30–33
model Tip {
  txRef       String   @unique     // ← unique
  flwTxId     String?              // ← NOT unique
  status      String   @default("pending")
}
```

Two different `txRef` values can reference the same `flwTxId`. This is the seed of the attack.

### The race

The `txRef` is generated server-side and each charge on Flutterwave gets a new unique ID. The attacker cannot control the `flwTxId` value directly. But there is a 2-step write pattern in `initiateTipAction`:

```ts
// Step 1 — save pending tip (line 162)
await prisma.tip.create({ data: { ... txRef, status: "pending" } });

// ...charge is created on Flutterwave...

// Step 2 — save charge ID (line 208)
await prisma.tip.update({ where: { txRef }, data: { flwTxId: chargeId } });
```

If the server crashes between Step 1 and Step 2, the pending tip has `flwTxId: null`. The charge was created on Flutterwave but no local tip references it. A future reconciliation job that re-attaches orphaned charge IDs to pending tips — without enforcing uniqueness — would make this attack practical.

### Current exploitability

**Low** — the attacker cannot inject a custom `flwTxId` through the current code. But the absence of the unique constraint means any future code change that allows manual `flwTxId` assignment (admin panel, reconciliation script, database migration) opens the door.

---

## Attack 3 — Cross-creator tip verification (no slug-to-creator binding)

### What the code does

The success page's `verifyAndSaveTip` function looks up the tip by `txRef` and verifies the charge. It never checks that the tip's `creatorId` matches the `slug` in the URL:

```ts
// app/tip/[slug]/success/page.tsx
const { slug } = await params;     // from URL path
const txRef = sp.ref as string;    // from ?ref= query param

const verified = await verifyAndSaveTip(txRef);
// Inside verifyAndSaveTip — lines 16–17:
const tip = await prisma.tip.findUnique({ where: { txRef } });
// No check:  tip.creatorId != the creator of `slug`
```

The creator is fetched separately and only used for display:

```ts
const creator = await prisma.user.findUnique({ where: { slug } });
// creator.name is shown in the ResultPage — but the tip credit goes
// to whoever was set as creatorId when the tip was created
```

### Is this exploitable alone?

**No** — the display shows the wrong creator's name, but the financial credit (dashboard tip count, total amount) goes to the correct original creator. The attacker cannot redirect credit by changing the URL slug.

### Why it matters as a force multiplier

Combine this with Attack 1 or 2. If an attacker has a method to create a "success" tip for creator A, they can verify it from any slug's success page without being detected by creator B (who would see a success page hit for their page but no corresponding tip in their dashboard). This complicates forensic analysis of how the fake tip was created.

---

## Attack 4 — Race verifyAndSaveTip against itself

### The window

The existing audit (Question 2 in `03-audit.md`) identified a race condition in `verifyAndSaveTip`:

```
Request A: reads tip.status → "pending"
Request B: reads tip.status → "pending"   (before A wrote "success")
Request A: GET /charges → "succeeded" → writes "success"
Request B: GET /charges → "succeeded" → writes "success"
```

The audit concluded this was safe because the database write is idempotent and no side effects exist yet. That is correct **today**.

### The escalation

If a future developer adds post-payment logic (email notification, analytics event, external webhook) after the `prisma.tip.update` call, both requests would fire the side effect. The fix — atomic conditional write — was documented but not implemented:

```ts
// The fix that was NOT applied (from docs/03-audit.md lines 91–97)
const updated = await prisma.tip.updateMany({
  where: { txRef, status: "pending" },
  data: { status: "success" },
});
if (updated.count === 0) return true;
```

This is a **latent vulnerability** — a single future commit can turn it into a live exploit.

---

## Attack 5 — No CAPTCHA or rate limiting on tip submission

Existing Finding C from `03-audit.md`. Relevant here because:

- An attacker can script the tip form submission to create hundreds of pending tips.
- If combined with Attack 1 (a card that initially succeeds but later reverses), the attacker can batch-create fake successful tips.
- With no rate limiting, there is no speed bump. The attacker can submit 100 tips in seconds.
- Each tip creates 3 Flutterwave API calls (customer, payment method, charge) — the attacker can also exhaust API quota as a denial-of-service vector, hiding the fraudulent tips among error responses.

---

## Summary Table

| Attack | Precondition | Bypasses Payment? | Current Verdict |
|--------|-------------|-------------------|-----------------|
| 1. Race settlement reversal (PIN/charge immediate-success path) | A card that initially "succeeds" then reverses | **Yes** — tip stays "success" after reversal | **GAP** — no webhook, no reconciliation |
| 2. Reuse flwTxId across two tips | Future code path that sets flwTxId manually | **Conditional** — requires a code change | **GAP** — no unique constraint on flwTxId |
| 3. Cross-creator txRef verification | A valid txRef from any creator | **No** — display only, credit unchanged | **PARTIAL** — information disclosure |
| 4. Race verifyAndSaveTip with side effects | Future code adding post-payment logic | **Latent** — not exploitable today | **PARTIAL** — fix not applied |
| 5. No rate limiting + Attack 1 | A card that initially succeeds then reverses | **Multiplier** — scales Attack 1 | **GAP** — no rate limiting |

---

## Recommended Fixes

### Fix 1 — Always call GET /charges for independent verification (critical)

Remove the early return from `verifyAndSaveTip` when status is `"success"`:

```ts
// Current code — skips independent verification if already "success"
if (tip.status === "success") return true;
```

Instead, always call the Flutterwave verification API before returning `true`. The idempotency guard should only prevent duplicate writes, not suppress verification:

```ts
async function verifyAndSaveTip(txRef: string): Promise<boolean> {
  const tip = await prisma.tip.findUnique({ where: { txRef } });
  if (!tip) return false;

  // Still verify even if status is "success" — the charge may have reversed
  if (!tip.flwTxId) return tip.status === "success";

  try {
    const res = await flwFetch(`/charges/${tip.flwTxId}`);
    const json = await res.json() as Record<string, unknown>;

    if (json.data?.status === "succeeded" && json.data?.reference === txRef) {
      if (tip.status !== "success") {
        await prisma.tip.update({
          where: { txRef },
          data: { status: "success" },
        });
      }
      return true;
    }

    // Flutterwave says this charge is no longer succeeded — downgrade
    if (tip.status === "success") {
      await prisma.tip.update({
        where: { txRef },
        data: { status: "failed" },
      });
    }
    return false;
  } catch {
    return tip.status === "success"; // maintain current status on network error
  }
}
```

### Fix 2 — Add unique constraint on flwTxId (preventative)

```prisma
model Tip {
  flwTxId     String?   @unique
}
```

This prevents two tips from ever referencing the same charge. The charge creation code already generates a new charge for each tip — the constraint makes it structurally impossible to share.

### Fix 3 — Register and handle Flutterwave webhooks

Add a webhook endpoint (`POST /api/webhooks/flutterwave`) that:
- Verifies the webhook signature using Flutterwave's webhook secret hash
- Handles `charge.completed`, `charge.failed`, and `charge.reversed` events
- Updates the local tip status accordingly

This is the only reliable way to catch post-settlement reversals. The current redirect-only pattern has a blind spot between initial charge success and final settlement.

### Fix 4 — IP-based rate limiting (from existing Finding C)

Implement rate limiting on the tip Server Action to prevent bulk exploitation of any of the above attacks.

### Fix 5 — Add CAPTCHA to the tip form

Require CAPTCHA verification on tip submission above a certain amount threshold (e.g., ₦10,000) to prevent automated abuse.

---

## Priority

1. **Fix 1 (always verify)** — closes the immediate-success-path gap. One file change, high impact.
2. **Fix 3 (webhooks)** — closes the settlement reversal blind spot. More work but the only complete solution.
3. **Fix 2 (flwTxId unique)** — preventative, low effort.
4. **Fixes 4 & 5** — operational hardening, medium effort.
