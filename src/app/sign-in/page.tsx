import { Suspense } from "react";
import { SignInForm } from "@/components/sign-in-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server component: read which auth providers are actually configured so the
// client form never offers a sign-in method that would silently fail.
export default function SignInPage() {
  const emailEnabled = Boolean(process.env.EMAIL_SERVER_HOST);
  const googleEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );

  return (
    <Suspense fallback={null}>
      <SignInForm emailEnabled={emailEnabled} googleEnabled={googleEnabled} />
    </Suspense>
  );
}
