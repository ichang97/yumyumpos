export function prepareStmt(db, sql, params = []) {
  const stmt = db.prepare(sql);
  return params.length > 0 ? stmt.bind(...params) : stmt;
}

export async function queryAll(db, sql, params = []) {
  const res = await prepareStmt(db, sql, params).all();
  return res.results || [];
}

export async function queryFirst(db, sql, params = []) {
  return prepareStmt(db, sql, params).first();
}

export async function execute(db, sql, params = []) {
  const res = await prepareStmt(db, sql, params).run();
  return res.meta || {};
}

export async function queryByIdChunks(db, buildSql, ids, chunkSize = 80) {
  if (!ids || ids.length === 0) {
    return [];
  }
  const allRows = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await queryAll(db, buildSql(placeholders), chunk);
    allRows.push(...rows);
  }
  return allRows;
}
