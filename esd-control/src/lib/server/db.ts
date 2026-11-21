import "server-only";
import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export interface Ctx {
  orgId: string;
  userId: string;
}

const globalForDb = globalThis as unknown as { __esdSql?: Sql };

export function createAppSql(url: string, max = 10): Sql {
  return postgres(url, {
    max,
    idle_timeout: 30,
    connect_timeout: 10,
    // Salvaguardas: ninguna consulta ni transacción ociosa puede retener una conexión indefinidamente.
    connection: { TimeZone: "UTC", application_name: "esd-control", statement_timeout: 30000, idle_in_transaction_session_timeout: 60000 },
    // Las columnas DATE se devuelven como texto AAAA-MM-DD (sin desfase horario)
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
    transform: { undefined: null },
    onnotice: () => {},
  });
}

export function getSql(): Sql {
  if (!globalForDb.__esdSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no está configurada (ver .env.example)");
    globalForDb.__esdSql = createAppSql(url, Number(process.env.DB_POOL_MAX ?? 15));
  }
  return globalForDb.__esdSql;
}

/**
 * Ejecuta `fn` en una transacción con el contexto de organización y usuario
 * fijado para RLS (set_config local a la transacción).
 */
export async function withCtx<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>, sqlOverride?: Sql): Promise<T> {
  const sql = sqlOverride ?? getSql();
  const r = await sql.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId}, true)`;
    return fn(tx);
  });
  return r as T;
}
