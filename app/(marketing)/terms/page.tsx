import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/jeeves/legal-page";
import { CONTACT_URL, LEGAL_LAST_UPDATED } from "@/lib/marketing/site-config";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "The terms on which this demonstration of the Jeeves AI governance gateway is made available.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" lastUpdated={LEGAL_LAST_UPDATED}>
      <LegalSection heading="What you are using">
        <p>
          This site demonstrates Jeeves, an AI governance gateway. It is
          provided so you can see how the workflow behaves. It is not a
          production service, carries no service level, and may be changed,
          reset or taken down at any time without notice.
        </p>
      </LegalSection>

      <LegalSection heading="The scenario is fictional">
        <p>
          &ldquo;Meridian Health&rdquo; is an invented healthcare payer. Its
          initiatives, policies, reviewers, approvers, incidents and telemetry
          are all synthetic, created to demonstrate the workflow. Nothing on
          this site describes a real organisation&rsquo;s governance posture, and
          no output of this demo is a compliance assessment, legal advice, or
          clinical advice.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            Do not submit real personal, member, patient or health information.
            See the{" "}
            <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
              privacy page
            </Link>
            .
          </li>
          <li>
            Do not submit unlawful, abusive or infringing content, or anything
            you do not have the right to share.
          </li>
          <li>
            Do not attempt to disrupt the service, evade its rate limits, or
            access another visitor&rsquo;s workspace.
          </li>
          <li>
            Do not use it to make or justify a real decision about a real
            person.
          </li>
        </ul>
        <p>
          Submissions that breach these terms may be deleted and access may be
          blocked.
        </p>
      </LegalSection>

      <LegalSection heading="What you submit">
        <p>
          You keep whatever rights you have in what you submit. By submitting
          it you allow this deployment&rsquo;s operator to store, display and
          process it for the purpose of running and demonstrating the
          governance workflow. Submissions may be deleted at any time,
          including as part of a demo reset.
        </p>
      </LegalSection>

      <LegalSection heading="AI-generated content">
        <p>
          Parts of this demo are drafted by AI agents. Agent output is a draft
          and a recommendation only: in this workflow agents never approve,
          sign or decide anything, and a named human is accountable for every
          decision. Treat anything an agent produces here as illustrative, and
          do not rely on it.
        </p>
      </LegalSection>

      <LegalSection heading="No warranty, and limited liability">
        <p>
          The demonstration is provided &ldquo;as is&rdquo;, without warranty of any
          kind. To the fullest extent permitted by law, the operator is not
          liable for any loss arising from your use of it — including any
          decision made in reliance on anything it produces. Nothing here
          excludes liability that cannot lawfully be excluded.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about these terms:{" "}
          <a href={CONTACT_URL} className="underline underline-offset-4 hover:text-foreground">
            get in touch
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
