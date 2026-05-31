# Lie Detector

Five statements about how this payment flow works.
Four are true. One is false.

Find the false one. Show your proof — the file, the line, what it actually says.
Then ask me to reveal it.

---

**Statement 1**

The tip record is written to the database with `status: "pending"` before the charge request is ever sent to Flutterwave. If the server crashed after the database write but before the charge completed, the attempt would still exist as a recoverable record.

---

**Statement 2**

The OAuth access token is not fetched fresh on every payment request. It is cached in a module-level variable and only re-fetched when it is within 60 seconds of its expiry time.

---

**Statement 3**

The `handleCardInput` function in `TipForm.tsx` strips all spaces from the card number before the form is submitted, so the server receives a clean unspaced string like `5531886652142950` in the form payload.

---

**Statement 4**

The success page does not rely on Flutterwave's `status` field alone. It checks two things from the API response: the status must equal `"succeeded"` and the reference stored on Flutterwave's charge must match the `txRef` this server generated. A real charge from a different transaction — even one with `status: "succeeded"` — would still fail verification.

---

**Statement 5**

If a tipper types only a single word as their name — for example, just `"Ada"` — the name field is omitted from the Flutterwave customer creation request entirely, rather than sending something like `{ first: "Ada", last: "" }`.

---

*When you've found it and can show the proof, ask me to confirm.*
