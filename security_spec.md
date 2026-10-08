# Security Specification — EcoVerify Waste & Resident Collector Portal

## 1. Data Invariants
1. Every document ID (`householdId`, `collectionId`) must match `^[a-zA-Z0-9_\-]+$` and be at most 128 characters.
2. Only authenticated users with verified emails (`request.auth.token.email_verified == true`) or the bootstrapped admin (`hiteshmishra910@gmail.com`) can write to `/households/{householdId}` and `/collections/{collectionId}`.
3. `ownerUid` in `/households/{householdId}` must strictly match `request.auth.uid`.
4. `collectorUid` in `/collections/{collectionId}` must strictly match `request.auth.uid`.
5. `createdAt` must strictly equal `request.time` on creation and remain immutable on update.
6. `wasteCategory` in `/collections/{collectionId}` must strictly belong to the 12 allowed categories: `Wet`, `Dry`, `Plastic`, `Polythene`, `Paper`, `Cardboard`, `Metal`, `Aluminium`, `Glass`, `E-Waste`, `Organic`, `Other`.
7. `status` in `/collections/{collectionId}` is locked to `'VERIFIED'` (terminal state locking prevents subsequent updates unless admin).

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null`, attempting `create` on `/households/HH-101`.
2. **Unverified Email Spoof**: `auth = { uid: 'u1', token: { email: 'hiteshmishra910@gmail.com', email_verified: false } }`.
3. **Identity Spoofing on Household**: `ownerUid: 'other_user'` when `request.auth.uid == 'u1'`.
4. **Identity Spoofing on Collection**: `collectorUid: 'other_collector'` when `request.auth.uid == 'u1'`.
5. **Shadow / Ghost Field Injection**: Adding `isAdmin: true` to `/households/HH-101`.
6. **ID Poisoning**: Creating `/households/invalid$id!with*spaces` or a 500-char ID.
7. **Timestamp Forgery**: Providing a client string or past timestamp for `createdAt` instead of `request.time`.
8. **Value Poisoning on WasteCategory**: Submitting `wasteCategory: 'HUMAN_DETECTED'` or `'Nuclear'` outside the 12 allowed enums.
9. **Confidence Out-of-Bounds**: Submitting `confidence: 999` or `confidence: -10`.
10. **Denial-of-Wallet Oversized String**: Submitting a 10,000-character string in `detectedItems` (max 500).
11. **Terminal State Mutation**: Attempting to update a `/collections/{collectionId}` document after `status == 'VERIFIED'`.
12. **Immutable Field Mutation**: Attempting to change `ownerUid`, `householdId`, or `createdAt` during an update on `/households/{householdId}`.
