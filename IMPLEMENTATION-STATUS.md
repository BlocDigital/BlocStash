# Household Edition implementation status

## Implemented
- First-run household administrator setup and individual username/password login.
- Passwords stored as salted scrypt hashes; random sessions stored as SHA-256 hashes and delivered as HttpOnly, SameSite=Strict cookies.
- One-time, five-minute household invitations and member registration.
- Separate per-user Personal indexes and one Shared index.
- Server-side access checks: administrators can manage Shared but cannot read members' Personal libraries; members can only change their own Shared contributions.
- Shared and Personal media served only when referenced by a library the signed-in user may access.
- Deleted media moved to recoverable trash; restore endpoint and in-app trash view; startup cleanup after 30 days.
- One-time import of the existing index.json into the first administrator's Personal library. Existing index.json and media files are retained.
- Existing desktop folder mode remains available. Legacy shared-token API is disabled after household setup.
- Local server continues to serve the app and media on the LAN.

## Verification performed
- Node syntax checks for server and inline application JavaScript.
- HTTP integration test: first-run setup, session, invitation, joining, Personal/Shared indexes, upload, trash, restore, media read and legacy API lockdown.
- Privacy check: administrator cannot read a member's Personal index.
- Migration test: legacy index imported while original index and media remain in place.
- ZIP integrity check.

## Not yet implemented / limitations
- Metadata database is currently atomic `household.json`, not SQLite. This avoids native module installation and keeps the app dependency-free, but SQLite remains the next storage hardening step.
- Invitation is a one-time shareable link, not a rendered QR code yet.
- No administrator account-disable UI, per-device session revocation UI, automated scheduled backups, or automated multi-device conflict resolution yet.
- No physical iOS/Android device test or large-library performance benchmark has been performed.
- Local HTTP is unencrypted. Use only on a trusted private LAN; do not expose the port to the public internet.

### Invite-only + real QR invitations (update)
- Invite registration remains gated by a one-use invitation code; no open registration is provided after initial administrator setup.
- Invitation creation and QR retrieval are administrator-only server routes; member invitation creation is verified to return HTTP 403.
- Household UI only shows Invite member to administrator accounts.
- QR invitation is a locally generated SVG, using a bundled Python QR library (no online QR/CDN request). Requires Python 3 available on the host; copyable invite URL remains fallback.
- Invitations expire after five minutes and are single-use. QR endpoint refuses expired or used codes.
- Verified admin create invite, QR SVG route returns HTTP 200, member joins, and member invite attempt returns HTTP 403.
