import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-medium uppercase tracking-wider",
  {
    variants: {
      variant: {
        default: "border-border bg-muted/50 text-muted-foreground",
        success: "border-transparent bg-success/15 text-success",
        warning: "border-transparent bg-amber-500/15 text-amber-400",
        primary: "border-transparent bg-primary/15 text-primary",
        danger: "border-transparent bg-destructive/15 text-destructive",
        outline: "border-border text-foreground/80",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
