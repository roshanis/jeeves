// The cookie that carries a session token. Its own import-free module because
// two very different callers need the name: route-guard reads the token from it
// (and pulls in the database layer to do so), while proxy.ts only asks whether
// a credential is present at all and must stay small.
export const SESSION_COOKIE_NAME = "jeeves_session";
