# SLBF Agency Tracker

Single page search app for the Sri Lanka Bureau of Foreign Employment agency registry workbook.

## Features

- Imports the SLBF Excel registry into the MySQL `slbf_registry` table.
- Uses license number as the application-level duplicate key, so duplicate agency rows are not inserted.
- Updates existing rows when the Excel row changes.
- Maps Excel columns to `name`, `license_no`, `address`, `telephone`, `fax`, `email`, `valid_till`, and `reference`.
- Writes `LAST_IMPORT_TIMESTAMP`, `LAST_IMPORT_FILE_HASH`, and `LAST_IMPORT_FILENAME` to `.env` after each successful import.
- Serves a single page search interface from `public/`.

## Project Structure

```text
slbftracker/
|-- public/
|   |-- index.html
|   |-- app.css
|   |-- app.js
|   `-- assets/
|       `-- logo.png
|-- server.js
|-- package.json
|-- .env.example
|-- .gitignore
`-- README.md
```

The app creates `data/uploads/` at runtime for uploaded Excel files.

## Setup

Requires Node.js `18` or newer.

```bash
npm install
copy .env.example .env
```

Set these MySQL values in `.env` before starting or importing:

```text
MYSQL_HOST="localhost"
MYSQL_PORT=3306
MYSQL_USER="your_mysql_user"
MYSQL_PASSWORD="your_mysql_password"
MYSQL_DATABASE="slbftracker"
MYSQL_TABLE="slbf_registry"
DB_FIELD_MAX_LENGTH=120
```

Then run:

```bash
npm run import -- "SLBF registry.xlsx"
npm start
```

Open `http://localhost:3000`.

## Import Options

Run a command line import:

```bash
npm run import -- "SLBF registry.xlsx"
```

Or upload a new `.xlsx` workbook from the web page. The upload endpoint expects the file field name `registry`.

To import the bundled workbook automatically on an empty database, set this in `.env`:

```text
IMPORT_ON_START=true
```

## MySQL Table

The app is mapped to your current server table:

```sql
CREATE TABLE slbf_registry (
  id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  license_no VARCHAR(120) NOT NULL,
  address VARCHAR(120) NOT NULL,
  telephone VARCHAR(120) NOT NULL,
  fax VARCHAR(120) NOT NULL,
  email VARCHAR(120) NOT NULL,
  valid_till VARCHAR(120) NOT NULL,
  reference VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);
```

Recommended duplicate protection:

```sql
ALTER TABLE slbf_registry
  ADD UNIQUE KEY uniq_slbf_registry_license_no (license_no);
```

Some SLBF registry values are longer than 120 characters. With your current schema, `DB_FIELD_MAX_LENGTH=120` keeps imports compatible by trimming long values. To preserve full data, expand the columns and set `DB_FIELD_MAX_LENGTH=0`:

```sql
ALTER TABLE slbf_registry
  MODIFY name VARCHAR(255) NOT NULL,
  MODIFY address TEXT NOT NULL,
  MODIFY telephone TEXT NOT NULL,
  MODIFY email TEXT NOT NULL,
  MODIFY reference VARCHAR(255) NOT NULL;
```

## API

`GET /api/status`

Returns total agency count, expired count, expiring soon count, and latest import metadata.

`GET /api/agencies?q=term&limit=50`

Searches agency name, license number, address, telephone, and email.

`GET /api/agencies/:id`

Returns one full agency record.

`POST /api/import`

Uploads and imports an Excel workbook.

`POST /api/import/default`

Imports the local workbook configured by `DEFAULT_IMPORT_FILE`.

## Deployment Note

The upload and import endpoints mutate the database and `.env`. For a public server, protect those endpoints with your normal admin authentication or disable them after the first import.
