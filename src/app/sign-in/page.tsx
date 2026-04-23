"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plane, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SignInInner() {
  const sp = useSearchParams();
  const callbackUrl = sp.get("next") ?? "/routes";
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    await signIn("email", { email, callbackUrl });
    setPending(false);
  };

  return (
    <div className="container grid min-h-[70vh] place-items-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/60 p-8">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Plane className="h-4 w-4 -rotate-45" /> Sign in to Skybird
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Track your own routes and get email alerts when fares drop.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-2">
          <label className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Email magic link
          </label>
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button className="w-full" disabled={pending || !email}>
            <Mail className="h-4 w-4" /> {pending ? "Sending…" : "Send me a link"}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>

        <Button
          variant="secondary"
          className="w-full"
          onClick={() => signIn("google", { callbackUrl })}
        >
          Continue with Google
        </Button>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}
