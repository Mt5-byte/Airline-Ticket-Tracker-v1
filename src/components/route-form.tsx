"use client";

import { useState, useTransition } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useRouter } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { searchAirports } from "@/lib/airports";

type Tracked = {
  id: string;
  routeId: string;
  targetCents: number | null;
  targetDropPct: number | null;
  route: { origin: string; destination: string };
};

function IataInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const options = value.length >= 1 ? searchAirports(value, 6) : [];

  return (
    <div className="relative">
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        maxLength={40}
        className="uppercase"
      />
      {open && options.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-border bg-card shadow-xl">
          {options.map((a) => (
            <button
              type="button"
              key={a.iata}
              onMouseDown={() => {
                onChange(a.iata);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/60"
            >
              <span className="flex items-center gap-2">
                <span className="num text-xs font-semibold">{a.iata}</span>
                <span>{a.city}</span>
              </span>
              <span className="text-xs text-muted-foreground">{a.country}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RouteForm({ existing }: { existing: Tracked[] }) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [target, setTarget] = useState("");
  const [dropPct, setDropPct] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin,
          destination,
          targetCents: target ? Math.round(Number(target) * 100) : undefined,
          targetDropPct: dropPct ? Number(dropPct) : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // j.error may be a plain string or a zod flatten() object — normalize
        // to a string, or React throws on rendering an object child.
        const msg =
          typeof j.error === "string"
            ? j.error
            : j.error?.formErrors?.[0] ??
              (Object.values(j.error?.fieldErrors ?? {}).flat()[0] as string | undefined) ??
              "Failed to add route";
        setErr(String(msg));
        return;
      }
      setOrigin("");
      setDestination("");
      setTarget("");
      setDropPct("");
      router.refresh();
    });
  };

  const onDelete = (id: string) => {
    start(async () => {
      await fetch(`/api/routes/${id}`, { method: "DELETE" });
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card/60 p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">From</label>
            <IataInput value={origin} onChange={setOrigin} placeholder="IATA e.g. JFK" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">To</label>
            <IataInput value={destination} onChange={setDestination} placeholder="IATA e.g. LHR" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Target $ (optional)
            </label>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="500"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Or drop % (optional)
            </label>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="25"
              value={dropPct}
              onChange={(e) => setDropPct(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Skybird will alert you the moment the price hits your target or drops below the rolling 30-day median.
          </p>
          <Button type="submit" disabled={pending || !origin || !destination}>
            {pending ? "Adding…" : "Track route"} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        {err && <div className="mt-3 text-xs text-destructive">{err}</div>}
      </form>

      {existing.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card/40">
          <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border/70 px-5 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Route</span>
            <span>Target</span>
          </div>
          <ul>
            {existing.map((t) => (
              <li
                key={t.id}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border/50 px-5 py-3 last:border-b-0"
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className="num">{t.route.origin}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="num">{t.route.destination}</span>
                </span>
                <span className="text-xs text-muted-foreground num">
                  {t.targetCents
                    ? `≤ $${(t.targetCents / 100).toFixed(0)}`
                    : t.targetDropPct
                      ? `−${t.targetDropPct}%`
                      : "baseline only"}
                </span>
                <Button variant="ghost" size="icon" onClick={() => onDelete(t.id)} aria-label="Remove">
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
