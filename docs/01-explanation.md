# How the Payment Flow Works — ELI7

Four things to understand deeply:

1. How the payment is initiated
2. Where the user gets redirected and why
3. How the server verifies the transaction with Flutterwave's API
4. Why client-side success messages must never be trusted alone

---

## Part 1 — How the payment is initiated

### The form (`app/tip/[slug]/TipForm.tsx`)

```tsx
"use client";
```
This component runs in the browser. The user can see it and type into it.

```tsx
const [state, action, pending] = useActionState(initiateTipAction, initial);
```
`useActionState` hooks the form up to a **Server Action** — a function that runs on the server, not in the browser. When the user clicks Submit, the browser packages up everything in the form and ships it to the server. The `pending` flag flips to `true` while that's happening, which grays out the button so they don't click twice.

```tsx
<input type="hidden" name="slug" value={slug} />
```
A hidden field the user never sees. It tells the server which creator is being tipped, because the server action doesn't know the URL — it only knows what the form sends it.

```tsx
function handleCardInput(e: React.ChangeEvent<HTMLInputElement>) {
  const digits = e.target.value.replace(/\D/g, "").slice(0, 16);
  e.target.value = digits.replace(/(.{4})/g, "$1 ").trim();
}
```
Pure cosmetics. As the user types `5531886652142950` this reformats it to `5531 8866 5214 2950`. The spaces get stripped back off on the server before anything real happens — this is just to make it easier to read.

---

### The Server Action (`app/actions/tip.ts`)

This is where the real work happens. Every line runs on the server — the user's browser never sees this code.

```ts
const rawCardNumber = (formData.get("cardNumber") as string | null) ?? "";
```
Pull the card number out of the form submission. `formData` is like a bag of labeled values the browser sent over.

```ts
const raw = {
  slug: formData.get("slug") as string,
  cardNumber: rawCardNumber.replace(/\s+/g, ""),
  ...
};
```
Strip the spaces back out of the card number (remember those cosmetic spaces from the form), then collect all the other fields into one object.

```ts
const parsed = tipSchema.safeParse(raw);
if (!parsed.success) {
  return { errors: parsed.error.flatten().fieldErrors };
}
```
Run every field through Zod validation rules. If the card number is too short, the email doesn't look like an email, the CVV isn't 3–4 digits — stop here and send the error messages back to the form. Nothing touches Flutterwave until the data is clean.

```ts
const encKey = process.env.FLW_ENCRYPTION_KEY;
if (!encKey) {
  return { message: "Payment not configured. Add FLW_ENCRYPTION_KEY to .env.local." };
}
```
Check that the encryption key is configured. This key lives in environment variables on the server — the browser has no way to read it.

```ts
const creator = await prisma.user.findUnique({ where: { slug } });
if (!creator) return { message: "Creator not found." };
```
Look up the creator in the database. If someone guessed a bad URL slug, bail here.

```ts
const nonce = generateNonce();
```
Generate a random 12-character string. Think of this as a one-time salt for the encryption. Every transaction gets a fresh nonce so two identical card numbers don't produce the same encrypted output.

```ts
[encCardNum, encExpMonth, encExpYear, encCvv] = await Promise.all([
  encryptCardField(cardNumber, encKey, nonce),
  encryptCardField(expiryMonth, encKey, nonce),
  encryptCardField(expiryYear, encKey, nonce),
  encryptCardField(cvv, encKey, nonce),
]);
```
Encrypt all four card fields using AES-GCM (a standard used by banks and militaries). The plain card number never leaves this server function. What gets sent to Flutterwave is scrambled ciphertext that only Flutterwave can unscramble using the same key. `Promise.all` runs all four encryptions at the same time instead of waiting for one before starting the next.

```ts
const txRef = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
```
Create a unique ID for this transaction — `txRef` stands for "transaction reference". It's 32 random hex characters. This is *our* reference number. We'll use it to look the transaction up in our own database later.

---

### The three Flutterwave API calls

Flutterwave v4 requires three separate API calls to charge a card. Think of it like a restaurant: first you make a reservation (customer), then you hand over your card (payment method), then you order and pay (charge).

**Step 1 — Create a customer**

```ts
const customerRes = await flwFetch("/customers", {
  method: "POST",
  body: JSON.stringify(customerPayload),
});
```
Tell Flutterwave "this person exists, here is their email." Flutterwave responds with a customer ID like `cust_abc123`. This is Flutterwave's internal ID for them.

```ts
if (!customerRes.ok || !(customerJson.data as Record<string, unknown>)?.id) {
  return { message: `Customer creation failed (HTTP ${customerRes.status}): ${apiMsg}` };
}
```
If Flutterwave says no for any reason — bad credentials, wrong API URL, network hiccup — stop and send the exact error message back to the form. Never silently swallow errors.

**Step 2 — Create a payment method**

```ts
const pmRes = await flwFetch("/payment-methods", {
  method: "POST",
  body: JSON.stringify({
    type: "card",
    card: {
      encrypted_card_number: encCardNum,
      encrypted_expiry_month: encExpMonth,
      encrypted_expiry_year: encExpYear,
      encrypted_cvv: encCvv,
      nonce,
    },
  }),
});
```
Hand the encrypted card details to Flutterwave. Notice: the actual card number is never in this payload — only the ciphertext. Flutterwave decrypts it on their side using your Encryption Key. If this succeeds, Flutterwave responds with a payment method ID like `pm_xyz789`.

**Save the pending tip to the database**

```ts
await prisma.tip.create({
  data: {
    creatorId: creator.id,
    tipperEmail: email,
    amount,
    txRef,
    status: "pending",
  },
});
```
Before charging, write the tip to the database with `status: "pending"`. This is a safety net. If the server crashes mid-charge, we have a record that something was attempted. It also means we can check "was this txRef already processed?" later.

**Step 3 — Create the charge**

```ts
const chargeRes = await flwFetch("/charges", {
  method: "POST",
  body: JSON.stringify({
    reference: txRef,
    currency: "NGN",
    customer_id: customerId,
    payment_method_id: paymentMethodId,
    amount,
    redirect_url: `${baseUrl}/tip/${slug}/success?ref=${txRef}`,
  }),
});
```
The actual charge request. The important fields:

- `reference: txRef` — our reference number, so we can match this charge back to our database record
- `redirect_url` — the page Flutterwave will send the user back to after 3DS authentication (explained in Part 2)
- `customer_id` and `payment_method_id` — the IDs from steps 1 and 2

```ts
await prisma.tip.update({
  where: { txRef },
  data: { flwTxId: chargeId },
});
```
Save the charge ID (`chg_xxx`) that Flutterwave returned. We need this on the success page to verify the payment.

---

## Part 2 — Where the user gets redirected and why

After the charge is created, Flutterwave doesn't immediately take the money. For most Nigerian bank cards, two extra security steps happen first.

### Step A — PIN authorization

```ts
if (
  nextAction?.type === "authorize" &&
  (nextAction?.authorization as Record<string, unknown>)?.type === "pin"
) {
  const encPin = await encryptCardField("12345", encKey, nonce);

  const pinRes = await flwFetch(`/charges/${chargeId}`, {
    method: "PUT",
    body: JSON.stringify({
      authorization: {
        type: "pin",
        pin: { nonce, encrypted_pin: encPin },
      },
    }),
  });
```
Flutterwave replies to the charge request saying "this card needs a PIN before I'll proceed." In the sandbox, the test PIN is always `12345`. The server encrypts it with the same key and nonce used for the card fields, then sends a `PUT` request to authorize the charge.

In production you'd collect the PIN from the user with a second form step. For this sandbox build it's hardcoded.

### Step B — 3DS redirect

```ts
if ((pinData?.next_action as Record<string, unknown>)?.type === "redirect_url") {
  const redir = (pinData!.next_action as Record<string, unknown>).redirect_url as Record<string, unknown>;
  redirect(redir.url as string);
}
```
After the PIN, Flutterwave says "now the user needs to authenticate with their bank." It gives us a URL like `https://3ds.flutterwave.com/verify?...`. The server calls Next.js `redirect()`, which sends the user's browser there immediately.

**Why redirect?** Because the user's bank runs their own security page — an OTP prompt, a biometric check, or a code sent to their phone. Flutterwave can't fake this for you; the user has to interact with their actual bank. This step is called 3DS (3D Secure) and it's why stolen card details alone can't always complete a transaction.

**What the user sees:** They leave your site, land on a Flutterwave/bank page, approve the payment, and then get sent back.

**Where they land:** The `redirect_url` you passed to the charge — `/tip/[slug]/success?ref={txRef}`. Flutterwave appends `?ref=` with your original transaction reference so the success page can look it up.

---

## Part 3 — How the server verifies the transaction

### The success page (`app/tip/[slug]/success/page.tsx`)

```ts
export default async function SuccessPage({ params, searchParams }: Props) {
```
This is a **Server Component** — it runs on the server, not in the browser. The user can't modify what it does.

```ts
const txRef = sp.ref as string | undefined;
```
Read the `?ref=` value from the URL. This is the same transaction reference we generated earlier.

```ts
const verified = await verifyAndSaveTip(txRef);
```
Call the verification function. Nothing is shown to the user until this returns.

---

### Inside `verifyAndSaveTip`

```ts
const tip = await prisma.tip.findUnique({ where: { txRef } });
if (!tip) return false;
```
Look up this transaction reference in *our own database*. If it doesn't exist there, someone made up a fake `ref` in the URL. Return false.

```ts
if (tip.status === "success") return true;
```
If we already verified this before (e.g. the user refreshed the page), don't call Flutterwave again. Idempotent — calling it twice gives the same answer without doing double work.

```ts
if (!tip.flwTxId) return false;
```
If we never saved a Flutterwave charge ID, the payment never made it past our server. Return false.

```ts
const res = await flwFetch(`/charges/${tip.flwTxId}`);
json = await res.json();
```
**This is the critical step.** Call Flutterwave's API from our server using our secret credentials and ask: "What is the status of charge `chg_xxx`?" Flutterwave's API is the only source of truth for whether money moved.

```ts
if (
  json.data?.status !== "succeeded" ||
  json.data?.reference !== txRef
) {
  await prisma.tip.update({ where: { txRef }, data: { status: "failed" } });
  return false;
}
```
Two checks must both pass:

1. `status === "succeeded"` — Flutterwave confirms the charge went through
2. `reference === txRef` — the charge's reference matches *our* reference for this tip

The second check matters because otherwise someone could hand us a valid charge ID from a completely different transaction and claim success.

```ts
await prisma.tip.update({
  where: { txRef },
  data: { status: "success" },
});
return true;
```
Only after both checks pass do we mark the tip as successful in our database. This is the moment the creator's dashboard count goes up.

---

## Part 4 — Why client-side success messages must never be trusted alone

### What "client-side" means

Client-side means running in the user's browser. The browser is not your machine. You have no control over it. A user can open DevTools and change JavaScript. They can craft any URL they want. They can intercept and modify network responses.

### The attack this prevents

Imagine if the success page just showed a message based on the URL:

```ts
// DANGEROUS — never do this
if (searchParams.status === "success") {
  showThankYouMessage();
}
```

Flutterwave does redirect back with something like `?status=successful&tx_ref=...` in its response URL. If your app trusts that URL parameter, any user can type `?status=successful` themselves without paying a single naira. They'd see the success screen. Worse — if your server then credited the creator based on that, the creator would see a fake tip in their dashboard.

### What we do instead

The URL only carries a `?ref=` value — our transaction reference. That reference alone proves nothing. A reference with no matching database record is worthless. A reference with a matching record but no charge ID is worthless. A reference where the Flutterwave API says "this charge failed" is worthless.

The chain is:

```
URL has ?ref=abc123
  → look up abc123 in OUR database
    → get the flwTxId (chg_xxx) we saved when the charge was created
      → call Flutterwave GET /charges/chg_xxx FROM OUR SERVER using OUR secret credentials
        → Flutterwave says "status: succeeded, reference: abc123"
          → both match → mark as success → show thank you
```

Every step requires something the user cannot fake. They can't invent a database record. They can't call our Flutterwave account. They can't forge what Flutterwave's API returns to our server.

### Why the server-side call specifically matters

The call to `GET /charges/{id}` happens from Vercel's servers, authenticated with `FLW_CLIENT_ID` and `FLW_CLIENT_SECRET`. Those credentials never leave the server. The user's browser is not involved in this request at all. The user cannot intercept it, replay it, or modify its response. When Flutterwave says "succeeded," it means their systems registered a real money movement.

If you skip this check and show a success page based on what Flutterwave put in the redirect URL, you are trusting a message that was routed through the user's browser — a machine you don't control.

---

## The full journey in one picture

```
User fills form
      │
      ▼
[Browser] sends form data to Server Action
      │
      ▼
[Server] validates → encrypts card → calls Flutterwave API:
  POST /customers          → get customer ID
  POST /payment-methods    → get payment method ID
  write tip to DB (pending)
  POST /charges            → get charge ID, save to DB
      │
      ▼
Flutterwave says: "need PIN"
      │
      ▼
[Server] sends encrypted PIN → PUT /charges/{id}
      │
      ▼
Flutterwave says: "go to this bank URL for 3DS"
      │
      ▼
[Server] calls Next.js redirect() → user's browser goes to bank page
      │
      ▼
[User's bank] shows OTP / biometric prompt
      │
      ▼
User approves → bank tells Flutterwave → Flutterwave redirects to:
  https://hustlereceipt.vercel.app/tip/[slug]/success?ref={txRef}
      │
      ▼
[Server] success page loads:
  look up txRef in DB → get flwTxId
  call Flutterwave GET /charges/{flwTxId}
  check status === "succeeded" AND reference === txRef
      │
      ├── both pass → update DB to "success" → show thank you
      │
      └── either fails → update DB to "failed" → show error
```

The user's browser touches three things: the form, the bank's 3DS page, and the final success URL. The money verification never passes through the browser — it's a private server-to-server call every single time.
