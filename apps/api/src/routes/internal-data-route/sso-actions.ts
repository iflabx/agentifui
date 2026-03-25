import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '../../lib/pg-context';
import {
  escapeLikePattern,
  parsePositiveInt,
  parseSsoProtocol,
  readBoolean,
  readObject,
  readString,
  sanitizeSsoProviderRow,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import {
  type ApiActionResponse,
  LOCAL_SSO_ACTIONS,
  SSO_SORT_COLUMN_MAP,
  type SsoProviderRow,
} from './types';

export async function handleSsoAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_SSO_ACTIONS.has(action)) {
    return null;
  }

  if (action === 'sso.getSsoProviders') {
    const filters = readObject(payload?.filters);
    const page = Math.max(1, parsePositiveInt(filters.page, 1));
    const pageSize = Math.max(
      1,
      Math.min(parsePositiveInt(filters.pageSize, 20), 100)
    );
    const sortBy = readString(filters.sortBy) || 'display_order';
    const sortOrder =
      readString(filters.sortOrder).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const sortColumn = SSO_SORT_COLUMN_MAP[sortBy] || 'display_order';

    const whereClauses: string[] = [];
    const whereParams: unknown[] = [];

    const protocol = parseSsoProtocol(filters.protocol);
    if (protocol) {
      whereParams.push(protocol);
      whereClauses.push(`protocol = $${whereParams.length}::sso_protocol`);
    }

    if (Object.prototype.hasOwnProperty.call(filters, 'enabled')) {
      whereParams.push(readBoolean(filters.enabled, false));
      whereClauses.push(`enabled = $${whereParams.length}`);
    }

    const search = readString(filters.search);
    if (search) {
      whereParams.push(`%${escapeLikePattern(search)}%`);
      whereClauses.push(
        `(name ILIKE $${whereParams.length} ESCAPE '\\' OR button_text ILIKE $${whereParams.length} ESCAPE '\\')`
      );
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRows = await queryRowsWithPgSystemContext<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM sso_providers ${whereSql}`,
      whereParams
    );
    const total = Number(countRows[0]?.total || 0);
    const offset = (page - 1) * pageSize;

    const listRows = await queryRowsWithPgSystemContext<SsoProviderRow>(
      `
        SELECT
          id::text,
          name,
          protocol::text,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at::text,
          updated_at::text
        FROM sso_providers
        ${whereSql}
        ORDER BY ${sortColumn} ${sortOrder}, id ASC
        LIMIT $${whereParams.length + 1}
        OFFSET $${whereParams.length + 2}
      `,
      [...whereParams, pageSize, offset]
    );

    return toSuccessResponse({
      providers: listRows.map(sanitizeSsoProviderRow),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  }

  if (action === 'sso.getSsoProviderStats') {
    const rows = await queryRowsWithPgSystemContext<{
      protocol: string;
      enabled: boolean;
    }>(`SELECT protocol::text, enabled FROM sso_providers`);

    const stats = {
      total: rows.length,
      enabled: rows.filter(row => row.enabled).length,
      disabled: rows.filter(row => !row.enabled).length,
      byProtocol: {
        CAS: 0,
        SAML: 0,
        OAuth2: 0,
        OIDC: 0,
      },
    };

    rows.forEach(row => {
      if (row.protocol in stats.byProtocol) {
        const key = row.protocol as keyof typeof stats.byProtocol;
        stats.byProtocol[key] += 1;
      }
    });

    return toSuccessResponse(stats);
  }

  if (action === 'sso.getSsoProviderById') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const rows = await queryRowsWithPgSystemContext<SsoProviderRow>(
      `
        SELECT
          id::text,
          name,
          protocol::text,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at::text,
          updated_at::text
        FROM sso_providers
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id]
    );
    return toSuccessResponse(rows[0] ? sanitizeSsoProviderRow(rows[0]) : null);
  }

  if (action === 'sso.createSsoProvider') {
    const data = readObject(payload?.data);
    const name = readString(data.name);
    const protocol = parseSsoProtocol(data.protocol);
    if (!name || !protocol) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<SsoProviderRow>(
      `
        INSERT INTO sso_providers (
          name,
          protocol,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2::sso_protocol,
          $3::jsonb,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          NOW(),
          NOW()
        )
        RETURNING
          id::text,
          name,
          protocol::text,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at::text,
          updated_at::text
      `,
      [
        name,
        protocol,
        JSON.stringify(readObject(data.settings)),
        readString(data.client_id) || null,
        readString(data.client_secret) || null,
        readString(data.metadata_url) || null,
        readBoolean(data.enabled, true),
        Math.max(0, parsePositiveInt(data.display_order, 0)),
        readString(data.button_text) || null,
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeSsoProviderRow(rows[0]) : null);
  }

  if (action === 'sso.updateSsoProvider') {
    const id = readString(payload?.id);
    const data = readObject(payload?.data);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    const addSet = (fragment: string, value: unknown) => {
      setClauses.push(`${fragment} = $${index}`);
      values.push(value);
      index += 1;
    };

    if (Object.prototype.hasOwnProperty.call(data, 'name')) {
      addSet('name', readString(data.name) || null);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'protocol')) {
      const protocol = parseSsoProtocol(data.protocol);
      if (!protocol) {
        return toErrorResponse('Invalid protocol', 400);
      }
      setClauses.push(`protocol = $${index}::sso_protocol`);
      values.push(protocol);
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'settings')) {
      setClauses.push(`settings = $${index}::jsonb`);
      values.push(JSON.stringify(readObject(data.settings)));
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'client_id')) {
      addSet('client_id', readString(data.client_id) || null);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'client_secret')) {
      addSet('client_secret', readString(data.client_secret) || null);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'metadata_url')) {
      addSet('metadata_url', readString(data.metadata_url) || null);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'enabled')) {
      addSet('enabled', readBoolean(data.enabled, false));
    }
    if (Object.prototype.hasOwnProperty.call(data, 'display_order')) {
      addSet(
        'display_order',
        Math.max(0, parsePositiveInt(data.display_order, 0))
      );
    }
    if (Object.prototype.hasOwnProperty.call(data, 'button_text')) {
      addSet('button_text', readString(data.button_text) || null);
    }

    if (setClauses.length === 0) {
      return toErrorResponse('No fields to update', 400);
    }

    setClauses.push('updated_at = NOW()');
    values.push(id);

    const rows = await queryRowsWithPgSystemContext<SsoProviderRow>(
      `
        UPDATE sso_providers
        SET ${setClauses.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          name,
          protocol::text,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at::text,
          updated_at::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('SSO provider not found', 404);
    }
    return toSuccessResponse(sanitizeSsoProviderRow(rows[0]));
  }

  if (action === 'sso.deleteSsoProvider') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    await queryRowsWithPgSystemContext(
      `DELETE FROM sso_providers WHERE id = $1::uuid`,
      [id]
    );
    return toSuccessResponse(null);
  }

  if (action === 'sso.toggleSsoProvider') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }
    const enabled = readBoolean(payload?.enabled, false);

    const rows = await queryRowsWithPgSystemContext<SsoProviderRow>(
      `
        UPDATE sso_providers
        SET enabled = $2,
            updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING
          id::text,
          name,
          protocol::text,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at::text,
          updated_at::text
      `,
      [id, enabled]
    );
    if (!rows[0]) {
      return toErrorResponse('SSO provider not found', 404);
    }
    return toSuccessResponse(sanitizeSsoProviderRow(rows[0]));
  }

  if (action === 'sso.updateSsoProviderOrder') {
    const rawUpdates = Array.isArray(payload?.updates) ? payload?.updates : [];
    const sanitizedUpdates = rawUpdates
      .map(item => readObject(item))
      .map(item => ({
        id: readString(item.id),
        display_order: Math.max(0, parsePositiveInt(item.display_order, 0)),
      }))
      .filter(item => item.id);

    if (!actorUserId) {
      return toErrorResponse('Unauthorized', 401);
    }
    if (sanitizedUpdates.length === 0) {
      return toSuccessResponse(null);
    }

    const rows = await queryRowsWithPgUserContext<{ updated_rows: number }>(
      actorUserId,
      undefined,
      `SELECT update_sso_provider_order($1::jsonb) AS updated_rows`,
      [JSON.stringify(sanitizedUpdates)]
    );

    if ((rows[0]?.updated_rows || 0) !== sanitizedUpdates.length) {
      return toErrorResponse('Failed to update all SSO providers', 500);
    }
    return toSuccessResponse(null);
  }

  return null;
}
