"use client";

import { useActionState, useRef } from "react";
import { initiateTipAction, type TipActionResult } from "@/app/actions/tip";

interface Props {
  slug: string;
  creatorName: string;
}

const initial: TipActionResult = {};
const PRESET_AMOUNTS = [500, 1000, 2000, 5000];

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export default function TipForm({ slug, creatorName }: Props) {
  const [state, action, pending] = useActionState(initiateTipAction, initial);
  const amountRef = useRef<HTMLInputElement>(null);

  function setPreset(value: number) {
    if (amountRef.current) amountRef.current.value = String(value);
  }

  // Format card number as groups of 4 while typing
  function handleCardInput(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 16);
    e.target.value = digits.replace(/(.{4})/g, "$1 ").trim();
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="slug" value={slug} />

      {/* ── Tipper info ─────────────────────────────── */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          Your name <span className="text-zinc-600">(optional)</span>
        </label>
        <input
          name="name"
          type="text"
          autoComplete="name"
          className={inputCls}
          placeholder="Anonymous"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-1.5">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputCls}
          placeholder="you@example.com"
        />
        {state.errors?.email && (
          <p className="mt-1 text-xs text-red-400">{state.errors.email[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="amount" className="block text-sm font-medium text-zinc-300 mb-1.5">
          Amount (₦)
        </label>
        <div className="flex gap-2 mb-2 flex-wrap">
          {PRESET_AMOUNTS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setPreset(preset)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:border-emerald-500 hover:text-emerald-400 transition"
            >
              ₦{preset.toLocaleString()}
            </button>
          ))}
        </div>
        <input
          id="amount"
          name="amount"
          type="number"
          required
          min={100}
          step={50}
          ref={amountRef}
          className={inputCls}
          placeholder="1000"
        />
        {state.errors?.amount && (
          <p className="mt-1 text-xs text-red-400">{state.errors.amount[0]}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          Message <span className="text-zinc-600">(optional)</span>
        </label>
        <textarea
          name="message"
          rows={3}
          maxLength={500}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
          placeholder={`Say something nice to ${creatorName}…`}
        />
      </div>

      {/* ── Card details ─────────────────────────────── */}
      <div className="border-t border-zinc-800 pt-5">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">
          Card details
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="cardNumber" className="block text-sm font-medium text-zinc-300 mb-1.5">
              Card number
            </label>
            <input
              id="cardNumber"
              name="cardNumber"
              type="text"
              inputMode="numeric"
              required
              maxLength={19}
              autoComplete="cc-number"
              onChange={handleCardInput}
              className={inputCls}
              placeholder="1234 5678 9012 3456"
            />
            {state.errors?.cardNumber && (
              <p className="mt-1 text-xs text-red-400">
                {state.errors.cardNumber[0]}
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="expiryMonth" className="block text-sm font-medium text-zinc-300 mb-1.5">
                Month
              </label>
              <input
                id="expiryMonth"
                name="expiryMonth"
                type="text"
                inputMode="numeric"
                required
                maxLength={2}
                autoComplete="cc-exp-month"
                className={inputCls}
                placeholder="09"
              />
              {state.errors?.expiryMonth && (
                <p className="mt-1 text-xs text-red-400">
                  {state.errors.expiryMonth[0]}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="expiryYear" className="block text-sm font-medium text-zinc-300 mb-1.5">
                Year
              </label>
              <input
                id="expiryYear"
                name="expiryYear"
                type="text"
                inputMode="numeric"
                required
                maxLength={2}
                autoComplete="cc-exp-year"
                className={inputCls}
                placeholder="32"
              />
              {state.errors?.expiryYear && (
                <p className="mt-1 text-xs text-red-400">
                  {state.errors.expiryYear[0]}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="cvv" className="block text-sm font-medium text-zinc-300 mb-1.5">
                CVV
              </label>
              <input
                id="cvv"
                name="cvv"
                type="password"
                inputMode="numeric"
                required
                maxLength={4}
                autoComplete="cc-csc"
                className={inputCls}
                placeholder="•••"
              />
              {state.errors?.cvv && (
                <p className="mt-1 text-xs text-red-400">
                  {state.errors.cvv[0]}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Sandbox test card hint */}
        <div className="mt-3 rounded-lg bg-zinc-800/60 border border-zinc-700/50 px-3 py-2.5 text-xs text-zinc-500">
          <span className="text-zinc-400 font-medium">Sandbox test card:</span>{" "}
          5531 8866 5214 2950 &nbsp;·&nbsp; 09 / 32 &nbsp;·&nbsp; CVV: 564
        </div>
      </div>

      {state.message && (
        <p className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending
          ? "Processing…"
          : `Send Tip to ${creatorName}`}
      </button>

      <p className="text-center text-xs text-zinc-600">
        Secure payment · Flutterwave v4
      </p>
    </form>
  );
}
