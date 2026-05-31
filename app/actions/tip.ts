"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { tipSchema } from "@/lib/validations";
import { flwFetch, encryptCardField, generateNonce } from "@/lib/flutterwave";

export type TipActionResult = {
  errors?: Record<string, string[]>;
  message?: string;
};

// Returns { first, last } only when both parts are present and long enough.
// Returns null when name is absent or only one word — caller omits the field.
function parseName(
  name?: string
): { first: string; last: string } | null {
  if (!name?.trim()) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || parts[1].length < 2) return null;
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export async function initiateTipAction(
  _prev: TipActionResult,
  formData: FormData
): Promise<TipActionResult> {
  // Strip spaces from card number before validation
  const rawCardNumber = (formData.get("cardNumber") as string | null) ?? "";

  const raw = {
    slug: formData.get("slug") as string,
    name: (formData.get("name") as string | null)?.trim() || undefined,
    email: formData.get("email") as string,
    amount: formData.get("amount") as string,
    message: (formData.get("message") as string | null)?.trim() || undefined,
    cardNumber: rawCardNumber.replace(/\s+/g, ""),
    expiryMonth: formData.get("expiryMonth") as string,
    expiryYear: formData.get("expiryYear") as string,
    cvv: formData.get("cvv") as string,
  };

  const parsed = tipSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const {
    slug,
    name,
    email,
    amount,
    message,
    cardNumber,
    expiryMonth,
    cvv,
  } = parsed.data;

  // Normalize expiry year to 2 digits (accept "2032" or "32")
  const expiryYear = parsed.data.expiryYear.slice(-2);

  const encKey = process.env.FLW_ENCRYPTION_KEY;
  if (!encKey) {
    return {
      message:
        "Payment not configured. Add FLW_ENCRYPTION_KEY to .env.local.",
    };
  }

  // Find creator
  const creator = await prisma.user.findUnique({ where: { slug } });
  if (!creator) return { message: "Creator not found." };

  // Generate nonce — must be exactly 12 chars, same for all card fields + PIN
  const nonce = generateNonce();

  // Encrypt card fields (server-side with Node.js webcrypto)
  let encCardNum: string,
    encExpMonth: string,
    encExpYear: string,
    encCvv: string;
  try {
    [encCardNum, encExpMonth, encExpYear, encCvv] = await Promise.all([
      encryptCardField(cardNumber, encKey, nonce),
      encryptCardField(expiryMonth, encKey, nonce),
      encryptCardField(expiryYear, encKey, nonce),
      encryptCardField(cvv, encKey, nonce),
    ]);
  } catch {
    return {
      message:
        "Card encryption failed. Check that FLW_ENCRYPTION_KEY is correct.",
    };
  }

  // Unique reference: 6–42 chars required by Flutterwave v4
  const txRef = crypto.randomUUID().replace(/-/g, "").slice(0, 32);

  // --- Step 1: Create customer ---
  // name is optional — only include it when both first and last are present
  const parsedName = parseName(name);
  const customerPayload: Record<string, unknown> = { email };
  if (parsedName) customerPayload.name = parsedName;

  let customerJson: Record<string, unknown>;
  try {
    const customerRes = await flwFetch("/customers", {
      method: "POST",
      body: JSON.stringify(customerPayload),
    });
    customerJson = await customerRes.json();
    if (!customerRes.ok || !(customerJson.data as Record<string, unknown>)?.id) {
      const apiMsg =
        (customerJson.message as string) ||
        JSON.stringify(customerJson).slice(0, 300);
      return {
        message: `Customer creation failed (HTTP ${customerRes.status}): ${apiMsg}`,
      };
    }
  } catch (err) {
    return {
      message: `Network error reaching Flutterwave: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const customerId: string = (customerJson.data as Record<string, unknown>).id as string;

  // --- Step 2: Create payment method ---
  let pmJson: Record<string, unknown>;
  try {
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
    pmJson = await pmRes.json();
    if (!pmRes.ok || !(pmJson.data as Record<string, unknown>)?.id) {
      const apiMsg =
        (pmJson.message as string) ||
        JSON.stringify(pmJson).slice(0, 300);
      return {
        message: `Payment method creation failed (HTTP ${pmRes.status}): ${apiMsg}`,
      };
    }
  } catch (err) {
    return {
      message: `Network error creating payment method: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const paymentMethodId: string = (pmJson.data as Record<string, unknown>).id as string;

  // --- Save pending tip to DB ---
  await prisma.tip.create({
    data: {
      creatorId: creator.id,
      tipperName: name ?? null,
      tipperEmail: email,
      amount,
      message: message ?? null,
      txRef,
      status: "pending",
    },
  });

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  // --- Step 3: Create charge ---
  let chargeJson: Record<string, unknown>;
  try {
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
    chargeJson = await chargeRes.json();
    if (!chargeRes.ok || !(chargeJson.data as Record<string, unknown>)?.id) {
      const apiMsg =
        (chargeJson.message as string) ||
        JSON.stringify(chargeJson).slice(0, 300);
      return { message: `Charge creation failed (HTTP ${chargeRes.status}): ${apiMsg}` };
    }
  } catch (err) {
    return {
      message: `Network error creating charge: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const chargeData = chargeJson.data as Record<string, unknown>;
  const chargeId = chargeData.id as string;

  // Record charge ID so success page can verify
  await prisma.tip.update({
    where: { txRef },
    data: { flwTxId: chargeId },
  });

  // --- Step 4: Handle next_action ---
  const nextAction = chargeData.next_action as Record<string, unknown> | undefined;

  // PIN authorization required (common for Nigerian cards in sandbox)
  if (
    nextAction?.type === "authorize" &&
    (nextAction?.authorization as Record<string, unknown>)?.type === "pin"
  ) {
    // Sandbox test PIN is always 12345 — in production collect from user
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
    const pinJson = await pinRes.json() as Record<string, unknown>;
    const pinData = pinJson.data as Record<string, unknown> | undefined;

    // After PIN, expect a 3DS redirect
    if ((pinData?.next_action as Record<string, unknown>)?.type === "redirect_url") {
      const redir = (pinData!.next_action as Record<string, unknown>).redirect_url as Record<string, unknown>;
      redirect(redir.url as string);
    }

    // Immediate success without 3DS (rare)
    if (pinData?.status === "succeeded") {
      await prisma.tip.update({
        where: { txRef },
        data: { status: "success" },
      });
      redirect(`/tip/${slug}/success?ref=${txRef}`);
    }

    const pinErrMsg = (pinJson.message as string) || JSON.stringify(pinJson).slice(0, 200);
    return {
      message: `PIN authorization failed (${pinErrMsg}). Use test PIN 12345 for sandbox cards.`,
    };
  }

  // Direct 3DS redirect (no PIN step)
  if (nextAction?.type === "redirect_url") {
    const redir = nextAction.redirect_url as Record<string, unknown>;
    redirect(redir.url as string);
  }

  // Charge succeeded immediately (no auth required)
  if (chargeData.status === "succeeded") {
    await prisma.tip.update({
      where: { txRef },
      data: { status: "success" },
    });
    redirect(`/tip/${slug}/success?ref=${txRef}`);
  }

  return {
    message:
      "Unexpected payment response. Please try again or use a different card.",
  };
}
