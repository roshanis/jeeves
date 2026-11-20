// Demo-only strings for client components. They are chosen here, behind the
// build-time JEEVES_DEMO_ENABLED switch (see lib/client/personas.ts), so a
// demo-disabled build contains none of them; components still gate their use
// on the runtime deployment mode. Empty where there is no demo.
const DEMO_BUILD = process.env.JEEVES_DEMO_ENABLED !== "0";

/** The fictional payer. */
export const DEMO_COMPANY: string = DEMO_BUILD ? "Meridian Health" : "";

/** The demo's approver named by the canned audit query. */
export const DEMO_APPROVER_NAME: string = DEMO_BUILD ? "Angela Torres" : "";

/** Evidence-tab line asking for synthetic material only. */
export const DEMO_EVIDENCE_NOTE: string = DEMO_BUILD ? "Upload only synthetic Meridian Health material. " : "";

/** Intake-chat line for a real request in the demo. */
export const DEMO_REAL_REQUEST_NOTE: string = DEMO_BUILD ? "Use the structured form to send your request to the Meridian team." : "";
