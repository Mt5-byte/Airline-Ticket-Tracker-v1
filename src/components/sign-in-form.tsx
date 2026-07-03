"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plane, Mail, AlertTriangle } from "lucide-react";
import { useSearchParams } from "next/navigation";

export function SignInForm({
  emailEnabled,
  googleEnabled,
}: {
  emailEnabled: boolean;
  googleEnabled: boolean;
}) {
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

  const nothingConfigured = !emailEnabled && !googleEnabled;

  return (
    <div className="container grid min-h-[70vh] place-items-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/60 p-8">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Plane className="h-4 w-4 -rotate-45" /> Sign in to Skybird
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Track your own routes and get email alerts when fares drop.
        </p>

        {nothingConfigured && (
          <div className="mt-6 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              No sign-in method is configured on this deployment. Set the SMTP
              (EMAIL_SERVER_*) or Google OAuth environment variables to enable
              accounts — see the README.
            </span>
          </div>
        )}

        {emailEnabled && (
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
        )}

        {emailEnabled && googleEnabled && (
          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>
        )}

        {googleEnabled && (
          <Button
            variant="secondary"
            className={emailEnabled ? "w-full" : "mt-6 w-full"}
            onClick={() => signIn("google", { callbackUrl })}
          >
            Continue with Google
          </Button>
        )}
      </div>
    </div>
  );
}
