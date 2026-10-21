// Minimal stand-in for the service-role client in Deno function tests. Records every call.
// Every query-builder method returns the same chain; awaiting it (or .single()/.maybeSingle())
// resolves through the configured handlers.
import type { HandlerContext } from '../handler.ts';
import type { TypedClient } from '../supabase.ts';

type DbError = { message: string; code?: string };
type Result = { data: unknown; error: DbError | null };

export type Call =
  | { op: 'insert'; table: string; row: Record<string, unknown>; filters: [string, unknown][] }
  | { op: 'update'; table: string; values: Record<string, unknown>; filters: [string, unknown][] }
  | { op: 'select'; table: string; columns: string; filters: [string, unknown][] }
  | { op: 'upload'; bucket: string; path: string; size: number; options: unknown }
  | { op: 'remove'; bucket: string; paths: string[] }
  | { op: 'rpc'; fn: string; args: Record<string, unknown> };

export type RpcResult = { data?: unknown; error?: DbError | null };
type QueryCall = Extract<Call, { op: 'insert' | 'update' | 'select' }>;

export type FakeOptions = {
  /** Errors returned by successive storage uploads; null = success. Default: always succeed. */
  uploadErrors?: (string | null)[];
  /** Error returned by successive storage removes; null = success. Default: always succeed. */
  removeErrors?: (string | null)[];
  /** Error returned by inserts into this table. */
  insertErrorFor?: string;
  /** Result per RPC name, or a function of its args. Unlisted RPCs return { data: null }. */
  rpc?: Record<string, RpcResult | ((args: Record<string, unknown>) => RpcResult)>;
  /** Result for selects / insert-returning per table. Default: { data: null }. */
  query?: Record<string, (call: QueryCall) => RpcResult | undefined>;
};

export function fakeSupabase(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const uploadErrors = [...(options.uploadErrors ?? [])];
  const removeErrors = [...(options.removeErrors ?? [])];
  const err = (message: string | null): DbError | null => (message ? { message } : null);

  function resolve(call: QueryCall): Result {
    const custom = options.query?.[call.table]?.(call);
    if (custom) return { data: custom.data ?? null, error: custom.error ?? null };
    if (call.op === 'insert' && options.insertErrorFor === call.table) return { data: null, error: err('insert failed') };
    return { data: null, error: null };
  }

  function chain(call: QueryCall) {
    calls.push(call);
    const settle = () => Promise.resolve(resolve(call));
    const builder = {
      select: (columns = '*') => {
        if (call.op === 'select') call.columns = columns;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return builder;
      },
      // Other filters are recorded as `op:column`, e.g. ['lt:last_accessed_at', iso].
      gt: (column: string, value: unknown) => (call.filters.push([`gt:${column}`, value]), builder),
      gte: (column: string, value: unknown) => (call.filters.push([`gte:${column}`, value]), builder),
      lt: (column: string, value: unknown) => (call.filters.push([`lt:${column}`, value]), builder),
      in: (column: string, value: unknown) => (call.filters.push([`in:${column}`, value]), builder),
      is: (column: string, value: unknown) => (call.filters.push([`is:${column}`, value]), builder),
      not: (column: string, op: string, value: unknown) => (call.filters.push([`not.${op}:${column}`, value]), builder),
      range: (from: number, to: number) => (call.filters.push(['range', [from, to]]), builder),
      order: () => builder,
      limit: () => builder,
      single: settle,
      maybeSingle: settle,
      then<T>(onFulfilled: (r: Result) => T, onRejected?: (e: unknown) => T) {
        return settle().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ op: 'rpc', fn, args });
      const configured = options.rpc?.[fn];
      const out = typeof configured === 'function' ? configured(args) : configured;
      return Promise.resolve({ data: out?.data ?? null, error: out?.error ?? null });
    },
    from(table: string) {
      return {
        select: (columns = '*') => chain({ op: 'select', table, columns, filters: [] }),
        insert: (row: Record<string, unknown>) => chain({ op: 'insert', table, row, filters: [] }),
        update: (values: Record<string, unknown>) => chain({ op: 'update', table, values, filters: [] }),
      };
    },
    storage: {
      from(bucket: string) {
        return {
          remove(paths: string[]) {
            calls.push({ op: 'remove', bucket, paths });
            const next = removeErrors.length ? removeErrors.shift()! : null;
            return Promise.resolve({ data: next ? null : paths.map((name) => ({ name })), error: err(next) });
          },
          upload(path: string, bytes: Uint8Array, opts: unknown) {
            calls.push({ op: 'upload', bucket, path, size: bytes.byteLength, options: opts });
            const next = uploadErrors.length ? uploadErrors.shift()! : null;
            return Promise.resolve({ data: next ? null : { path }, error: err(next) });
          },
        };
      },
    },
  };

  return { client: client as unknown as TypedClient, calls };
}

export function fakeContext(req: Request, admin: TypedClient, userId = 'user-1'): HandlerContext {
  return { req, userId, requestId: 'req-test', admin, userClient: admin };
}
