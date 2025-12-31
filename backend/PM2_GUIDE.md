# PM2 Process Manager Guide

PM2 is now configured to keep your server running on port 5001.

## Quick Commands

```bash
# Start the server with PM2
npm run pm2:start

# Stop the server
npm run pm2:stop

# Restart the server
npm run pm2:restart

# View logs
npm run pm2:logs

# Check status
npm run pm2:status

# Monitor (real-time)
npm run pm2:monitor

# Delete/remove from PM2
npm run pm2:delete
```

## Direct PM2 Commands

```bash
# Start
pm2 start ecosystem.config.js

# Stop
pm2 stop news-aggregator-backend

# Restart
pm2 restart news-aggregator-backend

# Delete
pm2 delete news-aggregator-backend

# View logs
pm2 logs news-aggregator-backend

# View logs (last 50 lines)
pm2 logs news-aggregator-backend --lines 50

# Follow logs (live)
pm2 logs news-aggregator-backend --lines 0

# Status
pm2 status

# Monitor (dashboard)
pm2 monit

# Save PM2 process list (for auto-start on reboot)
pm2 save

# Setup PM2 to start on system boot
pm2 startup
```

## Features

- ✅ **Auto-restart**: Server automatically restarts if it crashes
- ✅ **Port 5001**: Always runs on port 5001
- ✅ **Logs**: All logs saved to `backend/logs/`
- ✅ **Memory limit**: Auto-restarts if memory exceeds 1GB
- ✅ **Crash recovery**: Restarts up to 10 times with 4s delay

## Logs Location

- Output logs: `backend/logs/pm2-out.log`
- Error logs: `backend/logs/pm2-error.log`

## Auto-start on System Reboot

To make PM2 start your server automatically when your system reboots:

```bash
pm2 save
pm2 startup
```

Follow the instructions PM2 provides to complete the setup.

