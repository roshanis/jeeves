import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// The marketing pages with NEXT_PUBLIC_CONTACT_URL and NEXT_PUBLIC_PRIVACY_CONTACT
// unset, which is how a production-mode or self-built image ships.
// The helpers are imported after resetModules so providers and pages share one module graph.
const renderer = async () => (await import("./helpers")).renderWithProviders;

async function withNoContact() {
  vi.resetModules();
  vi.doMock("@/lib/marketing/site-config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/marketing/site-config")>()),
    CONTACT_URL: null,
    PRIVACY_CONTACT: null,
  }));
}

afterEach(() => {
  cleanup();
  vi.doUnmock("@/lib/marketing/site-config");
  vi.resetModules();
});

describe("contact settings unset", () => {
  it("the landing page and pilot page render no contact CTA", async () => {
    await withNoContact();
    const { LandingPage } = await import("@/components/jeeves/landing-page");
    const { LiveSessionProvider } = await import("@/lib/client/session-context");
    const { RoleProvider } = await import("@/components/jeeves/role-context");
    const { DeploymentModeProvider } = await import("@/lib/client/deployment-mode-context");
    const landing = render(
      <DeploymentModeProvider mode="demo">
        <RoleProvider>
          <LiveSessionProvider>
            <LandingPage />
          </LiveSessionProvider>
        </RoleProvider>
      </DeploymentModeProvider>,
    );
    const renderWithProviders = await renderer();
    expect(landing.queryByRole("link", { name: "Book a governance assessment" })).toBeNull();
    expect(landing.container.querySelector('a[href^="mailto:"]')).toBeNull();
    landing.unmount();

    const { default: PilotPage } = await import("@/app/(marketing)/pilot/page");
    const pilot = renderWithProviders(<PilotPage />);
    expect(pilot.queryByRole("link", { name: "Book an intro call" })).toBeNull();
  });

  it("the framework pages render no contact CTA", async () => {
    await withNoContact();
    const renderWithProviders = await renderer();
    for (const page of ["nist-ai-rmf", "eu-ai-act"]) {
      const { default: Page } = await import(`@/app/(marketing)/frameworks/${page}/page`);
      const view = renderWithProviders(<Page />);
      expect(view.queryByRole("link", { name: "Book a governance assessment" }), page).toBeNull();
      view.unmount();
    }
  });

  it("the legal pages say contact is not configured and render no Email link", async () => {
    await withNoContact();
    const renderWithProviders = await renderer();
    for (const page of ["privacy", "terms"]) {
      const { default: Page } = await import(`@/app/(marketing)/${page}/page`);
      const view = renderWithProviders(<Page />);
      const contact = view.container.querySelector('[data-slot="legal-contact"]');
      expect(contact?.textContent, page).toMatch(/Contact for this installation is not configured/);
      expect(view.container.querySelector('a[href^="mailto:"]'), page).toBeNull();
      expect(view.container.textContent, page).not.toMatch(/Email /);
      view.unmount();
    }
  });

  it("an https booking link as the privacy setting is never rendered as 'Email'", async () => {
    vi.resetModules();
    vi.doMock("@/lib/marketing/site-config", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/marketing/site-config")>()),
      PRIVACY_CONTACT: null,
    }));
    const renderWithProviders = await renderer();
    const { default: Page } = await import("@/app/(marketing)/privacy/page");
    const view = renderWithProviders(<Page />);
    expect(view.container.textContent).not.toMatch(/Email https?:/);
  });
});
