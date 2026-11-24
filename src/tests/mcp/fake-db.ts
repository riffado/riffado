import {
    Column,
    getTableColumns,
    getTableName,
    is,
    SQL,
    Table,
} from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

type Row = Record<string, unknown>;

export type FakeTables = Record<string, Row[]>;

const dialect = new PgDialect();

function columnKey(table: Table, column: Column): string | undefined {
    const columns = getTableColumns(table);
    return Object.keys(columns).find((key) => columns[key] === column);
}

function snakeToKey(table: Table, snake: string): string | undefined {
    const columns = getTableColumns(table);
    return Object.keys(columns).find((key) => columns[key].name === snake);
}

/**
 * Applies the conjunctive `col = $n`, `col in (...)` and `col is null`
 * predicates of a rendered where clause to rows of `table`. Range predicates
 * are ignored. Missing scoping in the code under test therefore shows up as
 * extra rows, not as silently filtered ones.
 */
function filterRows(table: Table, rows: Row[], where: SQL | undefined): Row[] {
    if (!where) return rows;
    const { sql, params } = dialect.sqlToQuery(where);
    const name = getTableName(table);
    const predicates: Array<(row: Row) => boolean> = [];

    for (const match of sql.matchAll(
        new RegExp(`"${name}"\\."(\\w+)" = \\$(\\d+)`, "g"),
    )) {
        const key = snakeToKey(table, match[1]);
        const value = params[Number(match[2]) - 1];
        if (key && typeof value === "string") {
            predicates.push((row) => row[key] === value);
        }
    }
    for (const match of sql.matchAll(
        new RegExp(`"${name}"\\."(\\w+)" in \\(([^)]*)\\)`, "g"),
    )) {
        const key = snakeToKey(table, match[1]);
        const values = match[2]
            .split(",")
            .map((ref) => params[Number(ref.trim().slice(1)) - 1]);
        if (key) predicates.push((row) => values.includes(row[key]));
    }
    for (const match of sql.matchAll(
        new RegExp(`"${name}"\\."(\\w+)" is null`, "g"),
    )) {
        const key = snakeToKey(table, match[1]);
        if (key) predicates.push((row) => row[key] == null);
    }

    return rows.filter((row) => predicates.every((check) => check(row)));
}

type Fields = Record<string, unknown> | undefined;

function project(
    tables: FakeTables,
    base: Table,
    row: Row,
    fields: Fields,
): Row {
    if (!fields) return row;
    const out: Row = {};
    for (const [key, value] of Object.entries(fields)) {
        if (is(value, Table)) {
            const name = getTableName(value);
            if (value === base) {
                out[key] = row;
            } else if (name === "plaud_devices") {
                out[key] =
                    (tables.plaud_devices ?? []).find(
                        (device) =>
                            device.userId === row.userId &&
                            device.serialNumber === row.deviceSn,
                    ) ?? null;
            } else {
                out[key] =
                    (tables[name] ?? []).find(
                        (other) =>
                            other.recordingId === row.id &&
                            other.userId === row.userId,
                    ) ?? null;
            }
        } else if (is(value, Column)) {
            const columnName = columnKey(base, value);
            out[key] = columnName ? row[columnName] : undefined;
        } else if (is(value, SQL)) {
            out[key] = (tables.transcriptions ?? []).some(
                (t) => t.recordingId === row.id && t.userId === row.userId,
            );
        }
    }
    return out;
}

type Chain = Promise<Row[]> & {
    orderBy: () => Chain;
    limit: (n: number) => Promise<Row[]>;
};

function chain(rows: Row[]): Chain {
    return Object.assign(Promise.resolve(rows), {
        orderBy: () => chain(rows),
        limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    });
}

/** A minimal stand-in for the Drizzle `db` used by the MCP route under test. */
export function createFakeDb(tables: FakeTables) {
    return {
        select(fields?: Record<string, unknown>) {
            return {
                from(table: Table) {
                    const builder = {
                        leftJoin: () => builder,
                        where(where: SQL | undefined) {
                            const rows = filterRows(
                                table,
                                tables[getTableName(table)] ?? [],
                                where,
                            );
                            return chain(
                                rows.map((row) =>
                                    project(tables, table, row, fields),
                                ),
                            );
                        },
                    };
                    return builder;
                },
            };
        },
        update() {
            return {
                set: () => ({ where: () => Promise.resolve() }),
            };
        },
    };
}
