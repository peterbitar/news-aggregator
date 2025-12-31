module.exports = {
  apps: [{
    name: 'news-aggregator-backend',
    script: './server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork', // Use fork mode (not cluster) for single instance
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 5001
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5001
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    // Restart on crash
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000
  }]
};

