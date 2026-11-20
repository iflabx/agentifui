/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

import { resolveTestDatabaseUrl } from './helpers/test-database-url';

jest.setTimeout(30000);
test('governance upgrade preserves history without trusting old attachment references', async () => {
  const url = new URL(resolveTestDatabaseUrl());
  if (
    !url.pathname.startsWith('/gov_verify_') &&
    url.pathname !== '/agentifui_test'
  )
    throw new Error('Dedicated governance database required');
  const owner = new Pool({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  const name = `gov_verify_upgrade_${randomUUID().replaceAll('-', '')}`;
  let database: Pool | undefined;
  let created = false;
  try {
    await owner.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    database = new Pool({
      connectionString: url.toString(),
      connectionTimeoutMillis: 5000,
    });
    const directory = path.join(process.cwd(), 'database/migrations');
    const migrations = readdirSync(directory)
      .filter(file => file.endsWith('.sql'))
      .sort();
    const current = [
      '20261119100000_add_admin_audit_events.sql',
      '20261119110000_add_dify_upload_access.sql',
    ];
    for (const file of migrations.filter(file => file < current[0]))
      await database.query(readFileSync(path.join(directory, file), 'utf8'));
    const user = randomUUID(),
      provider = randomUUID(),
      app = randomUUID(),
      conversation = randomUUID(),
      execution = randomUUID();
    const chatFile = randomUUID(),
      workflowFile = randomUUID();
    const otherUser = randomUUID();
    await database.query(
      "INSERT INTO profiles(id,role,status) VALUES($1,'user','active')",
      [user]
    );
    await database.query(
      "INSERT INTO profiles(id,role,status) VALUES($1,'user','active')",
      [otherUser]
    );
    await database.query(
      "INSERT INTO providers(id,name,type,base_url,auth_type) VALUES($1,'Synthetic upgrade','dify','https://upstream.example.invalid','bearer')",
      [provider]
    );
    await database.query(
      "INSERT INTO service_instances(id,provider_id,instance_id,visibility) VALUES($1,$2,'synthetic-upgrade','public')",
      [app, provider]
    );
    await database.query(
      "INSERT INTO conversations(id,user_id,title,app_id,status) VALUES($1,$2,'Synthetic old history',$3,'deleted')",
      [conversation, user, app]
    );
    await database.query(
      "INSERT INTO messages(conversation_id,user_id,role,content,metadata) VALUES($1,$2,'user','Synthetic retained text',$3)",
      [conversation, user, { attachments: [{ upload_file_id: chatFile }] }]
    );
    await database.query(
      "INSERT INTO app_executions(id,user_id,service_instance_id,execution_type,title,inputs) VALUES($1,$2,$3,'workflow','Synthetic old execution',$4)",
      [execution, user, app, { file: { upload_file_id: workflowFile } }]
    );
    const forgedConversation = randomUUID();
    await database.query(
      "INSERT INTO conversations(id,user_id,title,app_id) VALUES($1,$2,'Synthetic forged history',$3)",
      [forgedConversation, otherUser, app]
    );
    await database.query(
      "INSERT INTO messages(conversation_id,user_id,role,content,metadata) VALUES($1,$2,'user','Synthetic forged reference',$3)",
      [
        forgedConversation,
        otherUser,
        { attachments: [{ upload_file_id: chatFile }] },
      ]
    );
    await database.query(
      "INSERT INTO app_executions(user_id,service_instance_id,execution_type,title,inputs) VALUES($1,$2,'workflow','Synthetic forged execution',$3)",
      [otherUser, app, { file: { upload_file_id: workflowFile } }]
    );
    for (const file of current)
      await database.query(readFileSync(path.join(directory, file), 'utf8'));
    const mapped = await database.query(
      'SELECT file_id,bound_once FROM dify_upload_access WHERE user_id=$1 ORDER BY file_id',
      [otherUser]
    );
    expect(mapped.rows).toEqual([]);
    expect(
      (await database.query('SELECT * FROM dify_upload_access')).rows
    ).toEqual([]);
    expect(
      (
        await database.query(
          'SELECT content FROM messages WHERE conversation_id=$1',
          [conversation]
        )
      ).rows
    ).toEqual([{ content: 'Synthetic retained text' }]);
    const untrusted = randomUUID();
    await database.query(
      'UPDATE app_executions SET inputs=$2::jsonb WHERE id=$1',
      [execution, { file: { upload_file_id: untrusted } }]
    );
    expect(
      (
        await database.query(
          'SELECT file_id FROM dify_upload_access WHERE file_id=$1',
          [untrusted]
        )
      ).rows
    ).toHaveLength(0);
    expect(
      (
        await database.query(
          'SELECT count(*)::int AS count FROM admin_audit_events'
        )
      ).rows[0].count
    ).toBe(0);
  } finally {
    if (database) await database.end();
    if (created) await owner.query(`DROP DATABASE "${name}"`);
    await owner.end();
  }
});
