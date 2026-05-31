"use client";

import { useQuery } from "@tanstack/react-query";

interface Tip {
  id: string;
  tipperName: string | null;
  tipperEmail: string;
  amount: number;
  message: string | null;
  createdAt: string;
}

interface TipsData {
  tips: Tip[];
  total: number;
  count: number;
}

function formatNaira(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function TipsDashboard() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery<TipsData>({
    queryKey: ["tips"],
    queryFn: async () => {
      const res = await fetch("/api/tips");
      if (!res.ok) throw new Error("Failed to load tips");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5-minute stale time
    refetchOnWindowFocus: true, // background revalidation on focus
  });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-zinc-800/50" />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-zinc-800/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center text-red-400">
        Failed to load tips. Please refresh the page.
      </div>
    );
  }

  const tips = data?.tips ?? [];
  const total = data?.total ?? 0;
  const count = data?.count ?? 0;
  const messaged = tips.filter((t) => t.message);

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <p className="text-sm text-zinc-500">Total received</p>
          <p className="mt-2 text-3xl font-bold text-emerald-400">
            {formatNaira(total)}
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <p className="text-sm text-zinc-500">Total tips</p>
          <p className="mt-2 text-3xl font-bold text-white">
            {count}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Last updated {dataUpdatedAt ? timeAgo(new Date(dataUpdatedAt).toISOString()) : "—"}
          </p>
        </div>
      </div>

      {/* Recent Tips */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Recent Tips</h2>
        {tips.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-10 text-center text-zinc-500">
            No tips yet. Share your page to start receiving support!
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900">
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">From</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Amount</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium hidden sm:table-cell">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {tips.map((tip) => (
                  <tr key={tip.id} className="bg-zinc-900/50 hover:bg-zinc-900 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-200">
                        {tip.tipperName || "Anonymous"}
                      </p>
                      <p className="text-xs text-zinc-600">{tip.tipperEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-400">
                      {formatNaira(tip.amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-500 hidden sm:table-cell">
                      {timeAgo(tip.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Message Wall */}
      {messaged.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">
            Messages from supporters
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {messaged.map((tip) => (
              <div
                key={tip.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5"
              >
                <p className="text-zinc-300 text-sm leading-relaxed">
                  &ldquo;{tip.message}&rdquo;
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs font-medium text-zinc-500">
                    — {tip.tipperName || "Anonymous"}
                  </p>
                  <span className="text-xs text-emerald-500 font-semibold">
                    {formatNaira(tip.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
