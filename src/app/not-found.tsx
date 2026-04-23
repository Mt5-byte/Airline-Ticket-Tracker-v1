import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container grid min-h-[60vh] place-items-center text-center">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">404</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Route not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">This deal may have expired.</p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted/70"
        >
          Back to feed
        </Link>
      </div>
    </div>
  );
}
