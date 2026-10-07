// ------------------------------------------------------------------
// config.js — reads settings from the .env file in one place, so the
// rest of the code never touches process.env directly.
// ------------------------------------------------------------------
require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required setting ${name}. Check your .env file.`);
    process.exit(1);
  }
  return value;
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicApiUrl: (process.env.PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, ''),
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  databaseUrl: required('DATABASE_URL'),
  dbSsl: process.env.DB_SSL === 'true',
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  authRateLimit: parseInt(process.env.AUTH_RATE_LIMIT || '300', 10),

  storageMode: process.env.STORAGE_MODE === 's3' ? 's3' : 'local',
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_MB || '5', 10) * 1024 * 1024,

  awsRegion: process.env.AWS_REGION || 'ap-southeast-1',
  s3Bucket: process.env.S3_BUCKET,
  s3UrlExpires: parseInt(process.env.S3_URL_EXPIRES || '3600', 10),
};

if (config.storageMode === 's3' && !config.s3Bucket) {
  console.error('STORAGE_MODE is s3 but S3_BUCKET is not set.');
  process.exit(1);
}

module.exports = config;
