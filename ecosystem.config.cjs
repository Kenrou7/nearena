module.exports = {
  apps: [
    {
      name: "gladiator-backend",
      cwd: ".",
      env_file: ".env",
      script: "npm",
      args: "run start --workspace @gladiator/backend",
      interpreter: "none",
      autorestart: true,
      watch: false,
      restart_delay: 2000,
      max_memory_restart: "350M",
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
