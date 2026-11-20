import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SIGN_IN_HREF } from "@/lib/client/mode-copy";

/** Production's replacement for the demo's "Start demo" buttons. */
export function SignInLink({ className }: { className?: string }) {
  return (
    <Link href={SIGN_IN_HREF} className={`${buttonVariants({ variant: "outline", size: "sm" })} ${className ?? ""}`.trim()}>
      Sign in
    </Link>
  );
}
