import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  body,
  className,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  body?: string;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/30 px-6 py-14 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
