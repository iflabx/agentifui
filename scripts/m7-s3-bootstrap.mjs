#!/usr/bin/env node
import { ensureS3BucketExists } from './m7-shared.mjs';

async function run() {
  const result = await ensureS3BucketExists();
  console.log(
    JSON.stringify(
      {
        ok: true,
        created: result.created,
        status: result.status,
      },
      null,
      2
    )
  );
}

run().catch(error => {
  console.error(
    `[m7-s3-bootstrap] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
