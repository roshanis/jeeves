# Security policy

## Reporting a vulnerability

Please report it privately: on the repository's **Security** tab, choose
**Report a vulnerability** (GitHub private vulnerability reporting). Do not open
a public issue or pull request for a security problem. Include what you found,
how to reproduce it, and which deployment (demo or production mode) it affects.

This is a demo project maintained by one owner. There is no bug bounty and no
guaranteed response time; reports are read and answered as soon as the owner can.

## Supported versions

`main` is the only supported branch. Fixes land there; older commits and other
branches get none.

## What the public demo holds

Seeded records and everything created in the playground are fictional
("Meridian Health" is not a real organization). The separate **real request**
door stores what a visitor types, including a name, an e-mail address and free
text, so the site's operators can read and reply to it. Please do not put real
personal or health information into the demo, and do not test against someone
else's real request. A request's content can be removed on request; see the
privacy page.

## More

How the system protects itself, and what it does not claim, is in
[`docs/security-model.md`](docs/security-model.md).
