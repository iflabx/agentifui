#!/bin/sh
set -eu
: "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY_ID:?}" "${S3_SECRET_ACCESS_KEY:?}" "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}"
case "$S3_BUCKET" in *[!a-z0-9.-]*|'') echo 'Invalid bucket name' >&2; exit 1 ;; esac
if [ "$S3_ACCESS_KEY_ID" = "$MINIO_ROOT_USER" ]; then
  echo 'Use a separate bucket-scoped application identity' >&2
  exit 1
fi
if [ "${#S3_SECRET_ACCESS_KEY}" -lt 24 ] || [ "${#MINIO_ROOT_PASSWORD}" -lt 24 ] || [ "$S3_SECRET_ACCESS_KEY" = "$MINIO_ROOT_PASSWORD" ]; then
  echo 'Set independent storage application/root passwords of at least 24 characters' >&2
  exit 1
fi
case "$S3_SECRET_ACCESS_KEY:$MINIO_ROOT_PASSWORD" in
  *replace_with*|*CHANGE_ME*) echo 'Replace the example storage passwords' >&2; exit 1 ;;
esac
mc alias set install "$S3_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
if mc stat "install/$S3_BUCKET" >/dev/null 2>&1; then
  echo 'Refusing initialization of an existing bucket; do not replay initial setup' >&2
  exit 1
fi
if mc admin user info install "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  echo 'Refusing to modify an existing storage identity' >&2
  exit 1
fi
mc mb "install/$S3_BUCKET"
mc anonymous set none "install/$S3_BUCKET"
printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListBucket","s3:GetBucketLocation"],"Resource":["arn:aws:s3:::%s"]},{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":["arn:aws:s3:::%s/*"]}]}' "$S3_BUCKET" "$S3_BUCKET" >/tmp/agentifui-policy.json
mc admin policy create install "agentifui-$S3_BUCKET" /tmp/agentifui-policy.json
mc admin user add install "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
mc admin policy attach install "agentifui-$S3_BUCKET" --user "$S3_ACCESS_KEY_ID"
echo 'Private bucket and scoped application identity ready'
