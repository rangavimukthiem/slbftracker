const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const mysql = require("mysql2/promise");
const readXlsxFile = require("read-excel-file/node");

const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, ".env");

dotenv.config({ path: ENV_PATH, quiet: true });

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_IMPORT_FILE = path.resolve(
  ROOT_DIR,
  process.env.DEFAULT_IMPORT_FILE || "SLBF registry.xlsx"
);
const DB_FIELD_MAX_LENGTH = Number(process.env.DB_FIELD_MAX_LENGTH || 120);
const MYSQL_TABLE_NAME = process.env.MYSQL_TABLE || "slbf_registry";
const MYSQL_TABLE = escapeIdentifier(MYSQL_TABLE_NAME);
const COL = {
  id: "`id`",
  name: "`name`",
  licenseNo: "`license_no`",
  address: "`address`",
  telephone: "`telephone`",
  fax: "`fax`",
  email: "`email`",
  validTill: "`valid_till`",
  reference: "`reference`",
  createdAt: "`created_at`"
};
const SELECT_COLUMNS = [
  COL.id,
  COL.name,
  COL.licenseNo,
  COL.address,
  COL.telephone,
  COL.fax,
  COL.email,
  COL.validTill,
  COL.reference,
  COL.createdAt
].join(", ");

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "slbftracker",
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0
});

function escapeIdentifier(value) {
  const identifier = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`Invalid MySQL identifier: ${identifier}`);
  }
  return `\`${identifier}\``;
}

async function dbRun(sql, params = [], connection = pool) {
  const [result] = await connection.execute(sql, params);
  return result;
}

async function dbGet(sql, params = [], connection = pool) {
  const [rows] = await connection.execute(sql, params);
  return rows[0] || null;
}

async function dbAll(sql, params = [], connection = pool) {
  const [rows] = await connection.execute(sql, params);
  return rows;
}

async function initDb() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS ${MYSQL_TABLE} (
      ${COL.id} INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
      ${COL.name} VARCHAR(120) NOT NULL,
      ${COL.licenseNo} VARCHAR(120) NOT NULL,
      ${COL.address} VARCHAR(120) NOT NULL,
      ${COL.telephone} VARCHAR(120) NOT NULL,
      ${COL.fax} VARCHAR(120) NOT NULL,
      ${COL.email} VARCHAR(120) NOT NULL,
      ${COL.validTill} VARCHAR(120) NOT NULL,
      ${COL.reference} VARCHAR(120) NOT NULL,
      ${COL.createdAt} DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (${COL.id})
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const FIELD_HEADERS = {
  source_row_id: ["id", "no", "number", "serialno", "srno"],
  name: ["agency", "agencyname", "nameofagency", "foreignagency", "name"],
  license_no: ["lno", "licenseno", "licensenumber", "licno", "license", "licence"],
  address: ["address", "agencyaddress"],
  telephone: ["telephone", "phone", "phoneno", "contact", "contactno", "tel"],
  fax: ["fax", "faxno"],
  email: ["email", "emailaddress", "mail"],
  valid_till: ["validupto", "validuntil", "validtill", "expirydate", "expiredate", "licenseexpirydate"],
  reference: ["source", "reference", "url", "link"]
};

const DB_FIELDS = [
  "name",
  "license_no",
  "address",
  "telephone",
  "fax",
  "email",
  "valid_till",
  "reference"
];

function cleanValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function limitForSchema(value, result) {
  const cleaned = cleanValue(value);
  if (!DB_FIELD_MAX_LENGTH || cleaned.length <= DB_FIELD_MAX_LENGTH) {
    return cleaned;
  }

  result.truncated += 1;
  return cleaned.slice(0, DB_FIELD_MAX_LENGTH);
}

function pickField(row, candidates) {
  const wanted = new Set(candidates);
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normalizeHeader(key))) {
      return cleanValue(value);
    }
  }
  return "";
}

function cleanRow(row) {
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    const header = cleanValue(key);
    if (header) {
      result[header] = cleanValue(value);
    }
  }
  return result;
}

function normalizeLicense(value) {
  return cleanValue(value).replace(/\.0$/, "");
}

function parseValidDate(value) {
  const raw = cleanValue(value);
  if (!raw || raw === "***" || raw === "****") {
    return "";
  }

  const months = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12"
  };

  const namedDate = raw.match(/^(\d{1,2})[-/\s]+([A-Za-z]+)[-/,\s]+(\d{4})$/);
  if (namedDate) {
    const day = namedDate[1].padStart(2, "0");
    const month = months[namedDate[2].toLowerCase()];
    const year = namedDate[3];
    return month ? `${year}-${month}-${day}` : "";
  }

  const numericDate = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (numericDate) {
    const day = numericDate[1].padStart(2, "0");
    const month = numericDate[2].padStart(2, "0");
    return `${numericDate[3]}-${month}-${day}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

function hashContent(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return hashContent(fs.readFileSync(filePath));
}

function normalizeRegistryRow(inputRow, result) {
  const row = cleanRow(inputRow);
  return {
    source_row_id: pickField(row, FIELD_HEADERS.source_row_id),
    name: limitForSchema(pickField(row, FIELD_HEADERS.name), result),
    license_no: limitForSchema(normalizeLicense(pickField(row, FIELD_HEADERS.license_no)), result),
    address: limitForSchema(pickField(row, FIELD_HEADERS.address), result),
    telephone: limitForSchema(pickField(row, FIELD_HEADERS.telephone), result),
    fax: limitForSchema(pickField(row, FIELD_HEADERS.fax), result),
    email: limitForSchema(pickField(row, FIELD_HEADERS.email), result),
    valid_till: limitForSchema(pickField(row, FIELD_HEADERS.valid_till), result),
    reference: limitForSchema(pickField(row, FIELD_HEADERS.reference), result)
  };
}

async function readWorkbookRows(filePath) {
  const parsedRows = await readXlsxFile(filePath, { sheet: 1 });
  const sheetRows = Array.isArray(parsedRows[0]?.data) ? parsedRows[0].data : parsedRows;
  if (!sheetRows.length) {
    throw new Error("The workbook does not contain any sheets.");
  }

  const headers = sheetRows[0].map(cleanValue);
  const rows = [];

  for (const row of sheetRows.slice(1)) {
    const item = {};
    let hasData = false;

    for (let column = 0; column < headers.length; column += 1) {
      const header = headers[column];
      if (!header) {
        continue;
      }

      const value = cleanValue(row[column]);
      item[header] = value;
      if (value) {
        hasData = true;
      }
    }

    if (hasData) {
      rows.push(item);
    }
  }

  return rows;
}

function quoteEnvValue(value) {
  return JSON.stringify(String(value || ""));
}

function upsertEnvValues(values) {
  const lines = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)
    : [];
  const keys = new Set(Object.keys(values));
  const found = new Set();
  const nextLines = lines
    .filter((line, index) => line.length > 0 || index < lines.length - 1)
    .map((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (!match || !keys.has(match[1])) {
        return line;
      }
      found.add(match[1]);
      return `${match[1]}=${quoteEnvValue(values[match[1]])}`;
    });

  for (const [key, value] of Object.entries(values)) {
    if (!found.has(key)) {
      nextLines.push(`${key}=${quoteEnvValue(value)}`);
    }
    process.env[key] = String(value || "");
  }

  fs.writeFileSync(ENV_PATH, `${nextLines.join("\n")}\n`);
}

function recordsEqual(existing, record) {
  return DB_FIELDS.every((field) => cleanValue(existing[field]) === cleanValue(record[field]));
}

async function insertAgency(record, connection) {
  await dbRun(
    `
      INSERT INTO ${MYSQL_TABLE}
        (${COL.name}, ${COL.licenseNo}, ${COL.address}, ${COL.telephone}, ${COL.fax}, ${COL.email}, ${COL.validTill}, ${COL.reference}, ${COL.createdAt})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
    [
      record.name,
      record.license_no,
      record.address,
      record.telephone,
      record.fax,
      record.email,
      record.valid_till,
      record.reference
    ],
    connection
  );
}

async function updateAgency(id, record, connection) {
  await dbRun(
    `
      UPDATE ${MYSQL_TABLE}
      SET
        ${COL.name} = ?,
        ${COL.address} = ?,
        ${COL.telephone} = ?,
        ${COL.fax} = ?,
        ${COL.email} = ?,
        ${COL.validTill} = ?,
        ${COL.reference} = ?
      WHERE ${COL.id} = ?
    `,
    [
      record.name,
      record.address,
      record.telephone,
      record.fax,
      record.email,
      record.valid_till,
      record.reference,
      id
    ],
    connection
  );
}

async function importWorkbook(filePath, originalName = path.basename(filePath)) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Workbook not found: ${filePath}`);
  }

  const importedAt = new Date().toISOString();
  const fileHash = hashFile(filePath);
  const rows = await readWorkbookRows(filePath);
  const seenLicenses = new Set();
  const connection = await pool.getConnection();

  const result = {
    filename: originalName,
    storedPath: filePath,
    fileHash,
    importedAt,
    totalRows: rows.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    truncated: 0
  };

  try {
    await connection.beginTransaction();

    for (const row of rows) {
      const record = normalizeRegistryRow(row, result);
      if (!record.name || !record.license_no) {
        result.skipped += 1;
        continue;
      }

      const licenseKey = record.license_no.toLowerCase();
      if (seenLicenses.has(licenseKey)) {
        result.skipped += 1;
        continue;
      }
      seenLicenses.add(licenseKey);

      const existing = await dbGet(
        `SELECT ${COL.id}, ${COL.name}, ${COL.licenseNo}, ${COL.address}, ${COL.telephone}, ${COL.fax}, ${COL.email}, ${COL.validTill}, ${COL.reference}
         FROM ${MYSQL_TABLE}
         WHERE ${COL.licenseNo} = ?
         ORDER BY ${COL.id} ASC
         LIMIT 1`,
        [record.license_no],
        connection
      );

      if (!existing) {
        await insertAgency(record, connection);
        result.inserted += 1;
        continue;
      }

      if (recordsEqual(existing, record)) {
        result.unchanged += 1;
        continue;
      }

      await updateAgency(existing.id, record, connection);
      result.updated += 1;
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  upsertEnvValues({
    LAST_IMPORT_TIMESTAMP: importedAt,
    LAST_IMPORT_FILE_HASH: fileHash,
    LAST_IMPORT_FILENAME: originalName
  });

  return result;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function statusForValidTill(validTill) {
  const validIso = parseValidDate(validTill);
  if (!validIso) {
    return { status: "unknown", daysUntilExpiry: null, validIso: "" };
  }

  const expiry = new Date(`${validIso}T00:00:00Z`);
  const current = new Date(`${todayIso()}T00:00:00Z`);
  const daysUntilExpiry = Math.ceil((expiry - current) / 86400000);
  let status = "active";

  if (daysUntilExpiry < 0) {
    status = "expired";
  } else if (daysUntilExpiry <= 30) {
    status = "expiring";
  }

  return { status, daysUntilExpiry, validIso };
}

function decorateAgency(row) {
  if (!row) {
    return row;
  }

  const expiry = statusForValidTill(row.valid_till);

  return {
    id: row.id,
    source_row_id: "",
    agency: row.name,
    name: row.name,
    license_no: row.license_no,
    address: row.address,
    telephone: row.telephone,
    fax: row.fax,
    email: row.email,
    valid_up_to_raw: row.valid_till,
    valid_up_to_iso: expiry.validIso,
    valid_till: row.valid_till,
    source: row.reference,
    reference: row.reference,
    created_at: row.created_at,
    status: expiry.status,
    days_until_expiry: expiry.daysUntilExpiry,
    raw: {
      name: row.name,
      license_no: row.license_no,
      address: row.address,
      telephone: row.telephone,
      fax: row.fax,
      email: row.email,
      valid_till: row.valid_till,
      reference: row.reference,
      created_at: row.created_at
    }
  };
}

async function getStatus() {
  const total = await dbGet(`SELECT COUNT(*) AS count FROM ${MYSQL_TABLE}`);
  const rows = await dbAll(`SELECT ${COL.validTill} FROM ${MYSQL_TABLE}`);
  let expired = 0;
  let expiringSoon = 0;

  for (const row of rows) {
    const expiry = statusForValidTill(row.valid_till);
    if (expiry.status === "expired") {
      expired += 1;
    }
    if (expiry.status === "expiring") {
      expiringSoon += 1;
    }
  }

  return {
    totalAgencies: total.count,
    expiredAgencies: expired,
    expiringSoonAgencies: expiringSoon,
    lastImportTimestamp: process.env.LAST_IMPORT_TIMESTAMP || "",
    lastImport: {
      filename: process.env.LAST_IMPORT_FILENAME || "",
      file_hash: process.env.LAST_IMPORT_FILE_HASH || "",
      imported_at: process.env.LAST_IMPORT_TIMESTAMP || ""
    }
  };
}

function buildSearchQuery(q, limit) {
  const params = [];
  const clauses = [];
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);

  for (const term of terms) {
    const pattern = `%${term}%`;
    clauses.push(
      `(${COL.name} LIKE ? OR ${COL.licenseNo} LIKE ? OR ${COL.address} LIKE ? OR ${COL.telephone} LIKE ? OR ${COL.email} LIKE ?)`
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);

  return {
    sql: `
      SELECT ${SELECT_COLUMNS}
      FROM ${MYSQL_TABLE}
      ${where}
      ORDER BY ${COL.name} ASC
      LIMIT ?
    `,
    params
  };
}

async function maybeImportOnStart() {
  if (process.env.IMPORT_ON_START !== "true") {
    return null;
  }

  if (!fs.existsSync(DEFAULT_IMPORT_FILE)) {
    return null;
  }

  const total = await dbGet(`SELECT COUNT(*) AS count FROM ${MYSQL_TABLE}`);
  if (total.count > 0 && process.env.FORCE_IMPORT_ON_START !== "true") {
    return null;
  }

  return importWorkbook(DEFAULT_IMPORT_FILE, path.basename(DEFAULT_IMPORT_FILE));
}

async function startServer() {
  await initDb();

  const importArgIndex = process.argv.indexOf("--import");
  if (importArgIndex !== -1) {
    const requestedPath = process.argv[importArgIndex + 1];
    const importPath =
      requestedPath && !requestedPath.startsWith("--")
        ? path.resolve(ROOT_DIR, requestedPath)
        : DEFAULT_IMPORT_FILE;
    const result = await importWorkbook(importPath, path.basename(importPath));
    console.log(
      `Imported ${result.filename}: ${result.inserted} inserted, ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped, ${result.truncated} fields truncated.`
    );
    await pool.end();
    return;
  }

  const startupImport = await maybeImportOnStart();
  if (startupImport) {
    console.log(
      `Startup import completed: ${startupImport.inserted} inserted, ${startupImport.updated} updated.`
    );
  }

  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(ROOT_DIR, "public")));

  app.get(
    "/api/status",
    asyncHandler(async (req, res) => {
      res.json(await getStatus());
    })
  );

  app.get(
    "/api/agencies",
    asyncHandler(async (req, res) => {
      const q = cleanValue(req.query.q || "");
      const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);
      const query = buildSearchQuery(q, limit);
      const rows = await dbAll(query.sql, query.params);
      res.json({
        q,
        count: rows.length,
        results: rows.map(decorateAgency)
      });
    })
  );

  app.get(
    "/api/agencies/:id",
    asyncHandler(async (req, res) => {
      const row = await dbGet(
        `SELECT ${SELECT_COLUMNS}
         FROM ${MYSQL_TABLE}
         WHERE ${COL.id} = ?`,
        [req.params.id]
      );
      if (!row) {
        res.status(404).json({ error: "Agency not found." });
        return;
      }
      res.json(decorateAgency(row));
    })
  );

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(ROOT_DIR, "public", "index.html"));
  });

  app.use((error, req, res, next) => {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 500;
    res.status(status).json({
      error: error.message || "Unexpected server error."
    });
  });

  app.listen(PORT, () => {
    console.log(`SLBF tracker running at http://localhost:${PORT}`);
  });
}

startServer().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
