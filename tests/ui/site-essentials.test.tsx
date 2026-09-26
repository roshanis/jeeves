// The "is this a real site" checklist, as tests.
//
// Most of these are things nobody notices until they are missing — a 404
// with no way onward, a confirmation page that never confirms, a cookie
// banner that lies about what it stores. They are cheap to add and cheap to
// break, which is exactly why they are worth pinning.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import NotFound from "@/app/not-found";
import ThankYouPage from "@/app/(marketing)/thank-you/page";
import PrivacyPage from "@/app/(marketing)/privacy/page";
import TermsPage from "@/app/(marketing)/terms/page";
import { CookieNotice, resetCookieNoticeForTests } from "@/components/jeeves/cookie-notice";
import { StickyMobileCta } from "@/components/jeeves/sticky-mobile-cta";
import { act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

describe("root 404", () => {
  it("is never a dead end — every route out is a real link", () => {
    renderWithProviders(<NotFound />);

    expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/inbox");
    // No "#" or empty placeholder links — the project rule is no dead links.
    expect(hrefs.every((h) => h && h !== "#")).toBe(true);
  });
});

describe("thank-you page", () => {
  it("confirms it was sent, to whom, and what happens next", () => {
    renderWithProviders(<ThankYouPage />);

    expect(screen.getByText(/has been sent/i)).toBeDefined();
    expect(screen.getByText(/what happens next/i)).toBeDefined();
    // The honest part: a person reads it and replies by email.
    expect(screen.getByText(/a person reads it/i)).toBeDefined();
    expect(screen.getByText(/reply by email/i)).toBeDefined();
  });

  it("does not promise a governance review a real request never gets", () => {
    // It used to describe a Program Office QC, triage and domain review. In
    // the passwordless playground anyone can be the Program Office, so real
    // requests go to the site's operators instead — and nothing else.
    renderWithProviders(<ThankYouPage />);
    expect(screen.queryByText(/program office/i)).toBeNull();
    expect(screen.queryByText(/triage/i)).toBeNull();
  });

  it("uses design tokens that exist", () => {
    // `status-ok-*` never existed; Tailwind drops unknown utilities silently,
    // so the success badge rendered as a bare circle.
    renderWithProviders(<ThankYouPage />);
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/status-ok/);
    expect(html).toMatch(/bg-status-good-bg/);
  });

  it("does not promise a timeline it cannot keep", () => {
    renderWithProviders(<ThankYouPage />);
    expect(screen.getByText(/no timeline for a reply is promised/i)).toBeDefined();
  });

  it("repeats that this is a demo — a confirmation is often the only page seen", () => {
    renderWithProviders(<ThankYouPage />);
    expect(screen.getByText(/demonstration system/i)).toBeDefined();
  });
});

describe("legal pages", () => {
  it("privacy says what is actually stored, cookie by cookie", () => {
    renderWithProviders(<PrivacyPage />);
    expect(screen.getByText(/jeeves_workspace/)).toBeDefined();
    expect(screen.getByText(/sessionStorage/)).toBeDefined();
    // Said twice on purpose — as a section heading and in the body — so
    // this matches both.
    expect(screen.getAllByText(/do not enter real/i).length).toBeGreaterThan(0);
  });

  it("privacy is honest that AI processing sends data to OpenAI", () => {
    renderWithProviders(<PrivacyPage />);
    expect(screen.getByText(/OpenAI/)).toBeDefined();
  });

  it("terms state that agents never approve", () => {
    renderWithProviders(<TermsPage />);
    expect(screen.getByText(/never approve, sign or decide/i)).toBeDefined();
  });

  it("both flag themselves as unreviewed rather than posing as settled law", () => {
    const { unmount } = renderWithProviders(<PrivacyPage />);
    expect(screen.getByText(/not reviewed legal advice/i)).toBeDefined();
    unmount();
    renderWithProviders(<TermsPage />);
    expect(screen.getByText(/not reviewed legal advice/i)).toBeDefined();
  });

  it("gives a real, reachable contact point", () => {
    renderWithProviders(<PrivacyPage />);
    const contact = document.querySelector('[data-slot="legal-contact"]');
    expect(contact).not.toBeNull();
    const mailto = contact!.querySelector('a[href^="mailto:"]');
    expect(mailto).not.toBeNull();
    // Rendered as the address itself, not as "click here" — a contact point
    // you cannot read is not much of one.
    expect(mailto!.textContent).toMatch(/@/);
  });

  it("invents no postal address, and says so rather than leaving a silent gap", () => {
    // An invented street address on a privacy policy is worse than an absent
    // one: the reader cannot tell it is fiction.
    renderWithProviders(<PrivacyPage />);
    expect(screen.getByText(/no postal address is published/i)).toBeDefined();
    expect(screen.queryByText(/NEXT_PUBLIC_OPERATOR/)).toBeNull();
  });
});

describe("cookie notice", () => {
  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
    resetCookieNoticeForTests();
  });

  it("describes the one cookie this site actually sets", () => {
    renderWithProviders(<CookieNotice />);
    expect(screen.getByText(/one cookie/i)).toBeDefined();
    // Not the usual boilerplate: there is genuinely no tracking here, and
    // claiming otherwise would be its own kind of dishonesty.
    expect(screen.getByText(/no third-party analytics/i)).toBeDefined();
  });

  it("stays dismissed", () => {
    const { unmount } = renderWithProviders(<CookieNotice />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss cookie notice/i }));
    expect(document.querySelector('[data-slot="cookie-notice"]')).toBeNull();

    unmount();
    renderWithProviders(<CookieNotice />);
    expect(document.querySelector('[data-slot="cookie-notice"]')).toBeNull();
  });
});

describe("sticky mobile CTA", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCookieNoticeForTests();
  });

  function scrollPastHero() {
    act(() => {
      Object.defineProperty(window, "scrollY", { value: window.innerHeight * 2, configurable: true });
      window.dispatchEvent(new Event("scroll"));
    });
  }

  it("stays out of the way while the cookie notice is up — both sit at bottom-0", () => {
    renderWithProviders(<StickyMobileCta href="/initiatives/new" label="Try the demo or send a request" />);
    scrollPastHero();
    expect(document.querySelector('[data-slot="sticky-mobile-cta"]')).toBeNull();
  });

  it("appears once the notice is dismissed and the hero is scrolled past", () => {
    window.localStorage.setItem("jeeves_cookie_notice_ack", "1");
    resetCookieNoticeForTests();
    renderWithProviders(<StickyMobileCta href="/initiatives/new" label="Try the demo or send a request" />);
    scrollPastHero();
    const cta = document.querySelector('[data-slot="sticky-mobile-cta"] a');
    expect(cta?.getAttribute("href")).toBe("/initiatives/new");
  });
});
