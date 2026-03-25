import { type RealtimeRow, realtimeService } from '../realtime-service';
import {
  REALTIME_BRIDGE_ENSURER_GLOBAL_KEY,
  REALTIME_ENABLED_TABLES,
  REALTIME_PUBLISHER_GLOBAL_KEY,
} from './constants';
import { assertIdentifier, quoteIdentifier } from './identifiers';
import { normalizeRow } from './normalize';
import { resolveManagedRepositoryForOwnedTable } from './repository';
import type { RealtimePublisher, SqlPool } from './types';

export class DataServiceRealtimeSupport {
  private registeredRealtimeSubscriptions = new Set<string>();
  private realtimeHandlerIds = new WeakMap<
    (payload: unknown) => void,
    number
  >();
  private nextRealtimeHandlerId = 1;
  private realtimeBridgeEnsurer: (() => void) | null | undefined;
  private realtimePublisher: RealtimePublisher | null | undefined;
  private realtimeBridgeWarned = false;
  private realtimePublisherWarned = false;

  constructor(private readonly getPool: () => SqlPool) {}

  shouldPublishForTable(table: string): boolean {
    return REALTIME_ENABLED_TABLES.has(table);
  }

  async capturePreviousRow(
    table: string,
    id: string
  ): Promise<RealtimeRow | null> {
    if (!this.shouldPublishForTable(table)) {
      return null;
    }

    return this.loadRowById(table, id).catch(() => null);
  }

  async publishTableChange(input: {
    table: string;
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    newRow: unknown;
    oldRow: unknown;
  }): Promise<void> {
    if (!this.shouldPublishForTable(input.table)) {
      return;
    }

    const newRow = this.normalizeRealtimeRow(input.newRow);
    const oldRow = this.normalizeRealtimeRow(input.oldRow);
    if (!newRow && !oldRow) {
      return;
    }

    try {
      const publisher = this.loadRealtimePublisher();
      if (!publisher) {
        return;
      }

      await publisher({
        table: input.table,
        eventType: input.eventType,
        newRow,
        oldRow,
      });
    } catch (error) {
      console.warn('[DataService] Realtime publish failed:', error);
    }
  }

  registerSubscription(
    key: string,
    config: {
      event: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
      schema: string;
      table: string;
      filter?: string;
    },
    handler: (payload: unknown) => void
  ): void {
    const handlerId = this.getRealtimeHandlerId(handler);
    const dedupeKey = `${key}|${config.schema}|${config.table}|${config.event}|${config.filter || ''}|h:${handlerId}`;
    if (this.registeredRealtimeSubscriptions.has(dedupeKey)) {
      return;
    }

    if (typeof window === 'undefined') {
      const ensureBridge = this.loadRealtimeBridgeEnsurer();
      ensureBridge?.();
    }

    this.registeredRealtimeSubscriptions.add(dedupeKey);
    realtimeService.subscribe(key, config, handler);
  }

  private loadGlobalRealtimeBridgeEnsurer(): (() => void) | null {
    const globalState = globalThis as unknown as Record<string, unknown>;
    const candidate = globalState[REALTIME_BRIDGE_ENSURER_GLOBAL_KEY];
    return typeof candidate === 'function' ? (candidate as () => void) : null;
  }

  private loadGlobalRealtimePublisher(): RealtimePublisher | null {
    const globalState = globalThis as unknown as Record<string, unknown>;
    const candidate = globalState[REALTIME_PUBLISHER_GLOBAL_KEY];
    return typeof candidate === 'function'
      ? (candidate as RealtimePublisher)
      : null;
  }

  private warnRealtimeBridgeLoadOnce(error: unknown): void {
    if (this.realtimeBridgeWarned) {
      return;
    }

    this.realtimeBridgeWarned = true;
    console.warn(
      '[DataService] Failed to load realtime bridge module; realtime bridge disabled in this runtime:',
      error
    );
  }

  private warnRealtimePublisherLoadOnce(error: unknown): void {
    if (this.realtimePublisherWarned) {
      return;
    }

    this.realtimePublisherWarned = true;
    console.warn(
      '[DataService] Failed to load realtime publisher module; realtime publish disabled in this runtime:',
      error
    );
  }

  private loadRealtimeBridgeEnsurer(): (() => void) | null {
    if (typeof window !== 'undefined') {
      return null;
    }

    if (this.realtimeBridgeEnsurer !== undefined) {
      return this.realtimeBridgeEnsurer;
    }

    const globalBridgeEnsurer = this.loadGlobalRealtimeBridgeEnsurer();
    if (globalBridgeEnsurer) {
      this.realtimeBridgeEnsurer = globalBridgeEnsurer;
      return globalBridgeEnsurer;
    }

    try {
      const runtimeRequire = eval('require') as (id: string) => unknown;
      const bridgeModule = runtimeRequire('../../server/realtime/bridge') as {
        ensureRealtimeBridge?: () => void;
      };
      const ensurer =
        typeof bridgeModule.ensureRealtimeBridge === 'function'
          ? bridgeModule.ensureRealtimeBridge
          : null;

      this.realtimeBridgeEnsurer = ensurer;
      return ensurer;
    } catch (error) {
      this.warnRealtimeBridgeLoadOnce(error);
      this.realtimeBridgeEnsurer = null;
      return null;
    }
  }

  private loadRealtimePublisher(): RealtimePublisher | null {
    if (typeof window !== 'undefined') {
      return null;
    }

    if (this.realtimePublisher !== undefined) {
      return this.realtimePublisher;
    }

    const globalPublisher = this.loadGlobalRealtimePublisher();
    if (globalPublisher) {
      this.realtimePublisher = globalPublisher;
      return globalPublisher;
    }

    try {
      const runtimeRequire = eval('require') as (id: string) => unknown;
      const publisherModule = runtimeRequire(
        '../../server/realtime/publisher'
      ) as {
        publishTableChangeEvent?: RealtimePublisher;
      };
      const publisher =
        typeof publisherModule.publishTableChangeEvent === 'function'
          ? publisherModule.publishTableChangeEvent
          : null;

      this.realtimePublisher = publisher;
      return publisher;
    } catch (error) {
      this.warnRealtimePublisherLoadOnce(error);
      this.realtimePublisher = null;
      return null;
    }
  }

  private normalizeRealtimeRow(value: unknown): RealtimeRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return normalizeRow<RealtimeRow>(value);
  }

  private async loadRowById(
    table: string,
    id: string
  ): Promise<RealtimeRow | null> {
    const safeTable = assertIdentifier(table, 'table');
    const pool = this.getPool();
    const repository = resolveManagedRepositoryForOwnedTable(safeTable, pool);
    if (repository) {
      const row = await repository.findOne({ id });
      return row ? normalizeRow<RealtimeRow>(row) : null;
    }

    const sql = `SELECT * FROM ${quoteIdentifier(safeTable)} WHERE id = $1 LIMIT 1`;
    const queryResult = await pool.query(sql, [id]);
    const row = queryResult.rows[0];
    return row ? normalizeRow<RealtimeRow>(row) : null;
  }

  private getRealtimeHandlerId(handler: (payload: unknown) => void): number {
    const existing = this.realtimeHandlerIds.get(handler);
    if (existing) {
      return existing;
    }

    const created = this.nextRealtimeHandlerId++;
    this.realtimeHandlerIds.set(handler, created);
    return created;
  }
}
