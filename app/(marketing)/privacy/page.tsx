import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/jeeves/legal-page";
import { LEGAL_LAST_UPDATED, PRIVACY_CONTACT } from "@/lib/marketing/site-config";

// Written from what the code actually does, not from a template. Every claim
// below is checkable against a file:
//   - jeeves_workspace cookie      -> app/api/session/route.ts
//   - sessionStorage token         -> lib/client/session-context.tsx
//   - public submissions           -> app/api/public-session/route.ts
//   - OpenAI calls                 -> lib/agents/openai-adapter.ts
//   - append-only audit trail      -> lib/db/schema.ts
// If one of those changes, this page is wrong and must change with it.
export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What this demonstration stores, where it is stored, who can see it, and how to have it removed.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" lastUpdated={LEGAL_LAST_UPDATED}>
      <LegalSection heading="What this service is">
        <p>
          Jeeves is a demonstration of an AI governance workflow. &ldquo;Meridian
          Health&rdquo; is a fictional healthcare payer and all twelve seeded
          initiatives, every reviewer, and all telemetry are synthetic. Nothing
          here is a real health plan, and no real patient or member data is
          held in the seeded dataset.
        </p>
      </LegalSection>

      <LegalSection heading="What we store when you browse">
        <p>
          Browsing the public pages and the read-only console stores nothing
          about you on our side. There is no advertising, no tracking pixel
          and no third-party analytics on this site.
        </p>
      </LegalSection>

      <LegalSection heading="What we store when you use the demo">
        <p>If you start a session — either with the demo passcode or by starting a public request — we store:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <span className="font-medium">A session cookie</span> (<code className="font-mono text-xs">jeeves_workspace</code>),
            which identifies your isolated demo workspace so your records stay
            separate from other visitors&rsquo;. It is HttpOnly, signed, lasts
            seven days, and contains no personal information.
          </li>
          <li>
            <span className="font-medium">A session token</span> held in your
            browser&rsquo;s sessionStorage. It is cleared when you close the tab.
          </li>
          <li>
            <span className="font-medium">Whatever you type into the intake
            form</span>, stored in our database along with an append-only audit
            record of the actions taken on it.
          </li>
          <li>
            <span className="font-medium">Your IP address</span>, transiently,
            for rate limiting. It is not stored against your submission.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Please do not enter real information">
        <p>
          The intake form asks questions shaped like a healthcare payer&rsquo;s
          governance intake — data sources, patient populations, clinical
          impact. <span className="font-medium text-foreground">Do not enter real
          personal, member, patient or health information into it.</span> This is
          a demonstration system: it is not certified, not covered by a
          business associate agreement, and not an appropriate place for
          anyone&rsquo;s real data, including your own.
        </p>
      </LegalSection>

      <LegalSection heading="Where it is stored, and who can see it">
        <p>
          Submissions are stored in a hosted Postgres database. Records you
          create in a demo session are scoped to your own workspace and are
          not visible to other visitors. Requests sent through the public
          intake form are visible to whoever operates this deployment, so that
          they can be read and responded to — that is the purpose of sending
          one.
        </p>
      </LegalSection>

      <LegalSection heading="AI processing">
        <p>
          When the demo runs its review agents, the contents of the initiative
          being reviewed are sent to OpenAI&rsquo;s API for processing. This happens
          only for actions taken by a passcode-holding demo user; submitting a
          public request does not send anything to an AI provider. If no API
          key is configured the demo uses a deterministic local mock and
          nothing leaves the server.
        </p>
      </LegalSection>

      <LegalSection heading="How long it is kept">
        <p>
          Demo records are kept while the demonstration is running and may be
          reset without notice. There is no guaranteed retention period, and
          equally no guarantee that a record is deleted on a schedule — if you
          need something removed, ask.
        </p>
      </LegalSection>

      <LegalSection heading="Getting your data removed">
        <p>
          Write to{" "}
          <a
            href={PRIVACY_CONTACT}
            className="underline underline-offset-4 hover:text-foreground"
          >
            the contact address for this deployment
          </a>{" "}
          describing what you submitted, and it will be deleted. Because this
          is a demonstration, the simplest and fastest remedy is usually
          deletion of the whole record.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          If what the demo stores changes, this page changes with it. The
          date at the top is when it was last reviewed against the code.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
