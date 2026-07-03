"use client";

import { signOut } from "next-auth/react";
import { Button } from "./ui/button";

// A GET link to /api/auth/signout does NOT sign the user out in NextAuth v4 —
// it renders an intermediate confirmation page. signOut() posts with the CSRF
// token and actually ends the session.
export function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => signOut({ callbackUrl: "/" })}
    >
      Sign out
    </Button>
  );
}
