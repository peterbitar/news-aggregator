# Core

This folder contains **shared utilities and infrastructure** used across the entire backend.

## What's In Here

- **`middleware/`** - Express middleware functions
  - `auth.js` - Authentication and authorization helpers
    - `requireInternalKey` - Protects admin endpoints
    - `extractUserId` - Extracts user ID from requests

## Why This Exists

Core utilities are shared across:
- Product API
- Admin endpoints
- Background jobs
- Pipeline processing

Keeping them in one place makes it easy to:
- Find shared code
- Update authentication logic
- Maintain consistency



