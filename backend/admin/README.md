# Admin Tools

This folder contains **debug and control panel** endpoints. These are for developers and admins, not for the iOS app.

## What This Is

Admin tools let you:
- Manually trigger jobs (ingest, process, rank)
- Check system health
- Debug issues
- Control the system

## What's In Here

- **`routes.js`** - Admin API endpoints
  - `/internal/ingest` - Manually fetch news
  - `/internal/process` - Manually run pipeline
  - `/internal/rank` - Manually rank articles
  - `/internal/health` - Check system status

## Security

**All admin endpoints require an internal API key.**

Set `INTERNAL_API_KEY` in your `.env` file, then include it in requests:
```
x-internal-key: your-secret-key
```

## When to Use

Use admin endpoints when:
- Testing the system
- Debugging issues
- Manually triggering jobs (if scheduler is disabled)
- Checking system health

## Important

**The iOS app should NEVER call admin endpoints.**

Admin endpoints are for:
- Developers
- System administrators
- Debugging tools
- The existing admin UI

Product endpoints (`/v1/*`) are for the iOS app.



