module.exports = {
  apps: [
    {
      name: 'jetstream-pw',
      script: 'dist/apps/api/main.js',
      exec_mode: 'cluster',
      instances: -1,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
