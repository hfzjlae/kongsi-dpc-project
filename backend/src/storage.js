// ------------------------------------------------------------------
// storage.js — where the actual photo FILES are kept.
//
// Two interchangeable modes (set STORAGE_MODE in .env):
//   local -> files saved in backend/uploads/ (for development on a laptop)
//   s3    -> files saved in an Amazon S3 bucket (for the cloud deployment)
//
// The rest of the code calls saveFile / getViewUrl / deleteFile and
// does not care which mode is active. This separation is what makes
// photo storage its own dedicated part of the data tier.
// ------------------------------------------------------------------
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

const LOCAL_DIR = path.join(__dirname, '..', 'uploads');

let s3 = null;
let S3Commands = null;
let getSignedUrl = null;

if (config.storageMode === 's3') {
  // Credentials are NOT written in code. On EC2 they come automatically
  // from the IAM role attached to the instance.
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
  s3 = new S3Client({ region: config.awsRegion });
  S3Commands = { PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
}

async function saveFile(key, buffer, contentType) {
  if (config.storageMode === 's3') {
    await s3.send(
      new S3Commands.PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return;
  }
  const fullPath = path.join(LOCAL_DIR, key);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
}

// Returns a URL the browser can use in <img src="...">.
// In S3 mode the bucket stays PRIVATE; we hand out a "pre-signed" URL
// that only works for a limited time (S3_URL_EXPIRES seconds).
async function getViewUrl(key) {
  if (config.storageMode === 's3') {
    return getSignedUrl(
      s3,
      new S3Commands.GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
      { expiresIn: config.s3UrlExpires }
    );
  }
  return `${config.publicApiUrl}/uploads/${key}`;
}

async function deleteFile(key) {
  try {
    if (config.storageMode === 's3') {
      await s3.send(new S3Commands.DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }));
      return;
    }
    await fs.unlink(path.join(LOCAL_DIR, key));
  } catch (err) {
    // A missing file should not break the request; just log it.
    console.warn(`Could not delete stored file ${key}: ${err.message}`);
  }
}

module.exports = { saveFile, getViewUrl, deleteFile, LOCAL_DIR };
