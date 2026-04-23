import { Mail } from "lucide-react";

export default function CheckEmail() {
  return (
    <div className="container grid min-h-[70vh] place-items-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/60 p-8 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
          <Mail className="h-4 w-4" />
        </div>
        <h1 className="mt-3 text-base font-semibold">Check your inbox</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          We sent a sign-in link. It expires in 24 hours.
        </p>
      </div>
    </div>
  );
}
