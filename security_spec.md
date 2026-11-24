# LambdaQuant Firestore Security Specification (Phase 0)

## 1. Master Source of Truth & Relationship Mapping
- **Master Parent Document**: `/users/{userId}` (`UserWorkspace`)
  - Owned strictly by `request.auth.uid == userId` with verified email (`request.auth.token.email_verified == true`) on all writes.
  - Contains PII (`email`, `displayName`, `photoURL`); therefore `get` is restricted strictly to the owner (`request.auth.uid == userId`) and `list` is explicitly denied (`allow list: if false;`).
- **Child Subcollection 1**: `/users/{userId}/bets/{betId}` (`BetDocument`)
  - Master Gate: Every `get`, `create`, `update`, and `delete` verifies that the parent `/users/{userId}` exists (`exists(/databases/$(database)/documents/users/$(userId))`) and `request.auth.uid == userId`.
  - List Query Enforcer (Zero `get()`/`exists()` inside `allow list`): `allow list` validates `isSignedIn() && request.auth.uid == userId && resource.data.ownerId == request.auth.uid`.
  - Terminal State Locking: Once a bet reaches `status in ['won', 'lost', 'void']`, no further updates are permitted. Only `pending -> won | lost | void` transitions are permitted via the explicit `settleBet` action (`affectedKeys().hasOnly(['status', 'pnl', 'closingOdds', 'finalScore', 'updatedAt'])`).
- **Child Subcollection 2**: `/users/{userId}/parlayLegs/{legId}` (`ParlayLegDocument`)
  - Master Gate: Every `get`, `create`, `update`, and `delete` verifies parent `/users/{userId}` existence and `request.auth.uid == userId`.
  - List Query Enforcer: `allow list` validates `isSignedIn() && request.auth.uid == userId && resource.data.ownerId == request.auth.uid`.

## 2. Data Invariants
1. **Default Deny**: Any unmatched path (including `/test/connection` or unknown collections) is denied for all reads and writes.
2. **Verified Email Mandate**: Every `create`, `update`, and `delete` across all collections requires `request.auth.token.email_verified == true`.
3. **Path ID Hardening**: Every single-document operation (`get`, `create`, `update`, `delete`) enforces `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
4. **Anti-Update-Gap Blueprint**: Every `create` and `update` invokes `isValidUserWorkspace(incoming())`, `isValidBetDocument(incoming())`, or `isValidParlayLegDocument(incoming())` as a mandatory top-level guard.
5. **Action-Based Updates & No Shadow Fields**: Every `create` enforces `hasAll` + `hasOnly`; every `update` splits into explicit action branches enforcing `incoming().diff(existing()).affectedKeys().hasOnly(...)`.
6. **Immortal Fields & Temporal Integrity**: `uid`, `ownerId`, `email`, and `createdAt` are immutable after creation. `createdAt == request.time` on `create`, and `updatedAt == request.time` on both `create` and `update`.
7. **Orphan Prevention**: Subcollection documents (`/bets`, `/parlayLegs`) cannot be created unless `/users/{userId}` exists.
8. **Strict Size & Type Bounds**: Every string field enforces `.size()` bounds; every numeric field enforces finite domain bounds; nested maps (`bankrollConfig`, `alertSettings`, `mlFeatures`) enforce exact `hasAll` + `hasOnly` schemas.

## 3. The "Dirty Dozen" Adversarial Payloads (Must All Return `PERMISSION_DENIED`)

1. **D01 — Cross-Tenant PII Read (`GET /users/victim_uid` as `attacker_uid`)**:
   ```json
   { "operation": "get", "path": "/users/victim_uid", "auth": { "uid": "attacker_uid", "email_verified": true } }
   ```
2. **D02 — Blanket User Directory Enumeration (`LIST /users` as authenticated user)**:
   ```json
   { "operation": "list", "path": "/users", "auth": { "uid": "attacker_uid", "email_verified": true } }
   ```
3. **D03 — Unverified Email Write / Email Spoofing (`CREATE /users/spoof_uid` with `email_verified: false`)**:
   ```json
   {
     "operation": "create",
     "path": "/users/spoof_uid",
     "auth": { "uid": "spoof_uid", "email": "victim@example.com", "email_verified": false },
     "payload": {
       "uid": "spoof_uid",
       "email": "victim@example.com",
       "displayName": "Spoofer",
       "theme": "dark",
       "timezonePref": "gmt-6",
       "activeModel": "ensemble"
     }
   }
   ```
4. **D04 — Shadow Field Injection on User Create (`CREATE /users/u1` with ghost field `isAdmin: true`)**:
   ```json
   {
     "operation": "create",
     "path": "/users/u1",
     "auth": { "uid": "u1", "email": "u1@example.com", "email_verified": true },
     "payload": {
       "uid": "u1",
       "email": "u1@example.com",
       "displayName": "Analyst",
       "theme": "dark",
       "timezonePref": "gmt-6",
       "activeModel": "ensemble",
       "isAdmin": true
     }
   }
   ```
5. **D05 — Client-Forged Timestamp Backdating (`CREATE /users/u1/bets/bet-1` with forged `createdAt`)**:
   ```json
   {
     "operation": "create",
     "path": "/users/u1/bets/bet-1",
     "auth": { "uid": "u1", "email": "u1@example.com", "email_verified": true },
     "payload": {
       "ownerId": "u1",
       "date": "2026-10-01T18:00:00Z",
       "monthKey": "2026-10",
       "sport": "soccer",
       "league": "La Liga",
       "matchLabel": "Real Madrid vs Betis",
       "side": "over",
       "line": 2.5,
       "bookmaker": "Pinnacle",
       "odds": 1.95,
       "closingOdds": 1.95,
       "modelProb": 0.55,
       "edge": 0.04,
       "ev": 0.0725,
       "stake": 50,
       "status": "pending",
       "pnl": 0,
       "modelUsed": "ensemble",
       "createdAt": "2020-01-01T00:00:00Z",
       "updatedAt": "2020-01-01T00:00:00Z"
     }
   }
   ```
6. **D06 — Orphaned Bet Write Without Parent User Workspace (`CREATE /users/orphan_uid/bets/bet-orphan`)**:
   ```json
   {
     "operation": "create",
     "path": "/users/orphan_uid/bets/bet-orphan",
     "auth": { "uid": "orphan_uid", "email": "o@example.com", "email_verified": true },
     "payload": { "ownerId": "orphan_uid", "status": "pending" }
   }
   ```
7. **D07 — Identity Spoofing on Subcollection (`CREATE /users/u1/bets/bet-spoof` with `ownerId: "victim_uid"`)**:
   ```json
   {
     "operation": "create",
     "path": "/users/u1/bets/bet-spoof",
     "auth": { "uid": "u1", "email": "u1@example.com", "email_verified": true },
     "payload": { "ownerId": "victim_uid", "status": "pending" }
   }
   ```
8. **D08 — Terminal State Bypass (`UPDATE /users/u1/bets/bet-won` mutating already settled `won` bet back to `pending`)**:
   ```json
   {
     "operation": "update",
     "path": "/users/u1/bets/bet-won",
     "auth": { "uid": "u1", "email": "u1@example.com", "email_verified": true },
     "existing": { "status": "won", "pnl": 47.5 },
     "payload": { "status": "pending", "pnl": 0 }
   }
   ```
9. **D09 — Value Poisoning on Allowed Update Key (`UPDATE /users/u1/bets/bet-pending` setting `status: true` and 2KB `finalScore`)**:
   ```json
   {
     "operation": "update",
     "path": "/users/u1/bets/bet-pending",
     "auth": { "uid": "u1", "email": "u1@example.com", "email_verified": true },
     "existing": { "status": "pending", "pnl": 0 },
     "payload": { "status": true, "finalScore": "9999...<2000 chars>" }
   }
   ```
10. **D10 — Path Variable ID Poisoning (`CREATE /users/u1/bets/bad..id$with%chars` or 200-char ID)**:
    ```json
    {
      "operation": "create",
      "path": "/users/u1/bets/invalid.id$with/../../poison",
      "auth": { "uid": "u1", "email": "u1@example.com", "email_verified": true },
      "payload": { "ownerId": "u1", "status": "pending" }
    }
    ```
11. **D11 — Shadow Update on User Workspace (`UPDATE /users/u1` mutating `theme` + ghost field `role: "superadmin"`)**:
    ```json
    {
      "operation": "update",
      "path": "/users/u1",
      "auth": { "uid": "u1", "email": "u1@example.com", "email_verified": true },
      "payload": { "theme": "light", "role": "superadmin" }
    }
    ```
12. **D12 — Cross-Tenant Subcollection List Scraping (`LIST /users/victim_uid/bets` as `attacker_uid`)**:
    ```json
    {
      "operation": "list",
      "path": "/users/victim_uid/bets",
      "auth": { "uid": "attacker_uid", "email_verified": true }
    }
    ```
