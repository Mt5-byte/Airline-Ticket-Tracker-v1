import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { LiveIndicator } from "./live-indicator";
import { SignOutButton } from "./sign-out-button";
import { Button } from "./ui/button";
import { Plane } from "lucide-react";

export async function SiteHeader() {
  const session = await getServerSession(authOptions);
  const signedIn = Boolean(session?.user);

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="group flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/95 text-background">
              <Plane className="h-3.5 w-3.5 -rotate-45" />
            </div>
            <span className="text-[15px] font-semibold tracking-tight">Skybird</span>
            <span className="hidden sm:inline text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              deals
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            <Link
              href="/"
              className="rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              Deals
            </Link>
            <Link
              href="/routes"
              className="rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              My routes
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator className="hidden sm:flex" />
          {signedIn ? (
            <SignOutButton />
          ) : (
            <Button asChild size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
