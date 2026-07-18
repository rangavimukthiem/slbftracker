# SLBF Agency Tracker

Single page search app for the Sri Lanka Bureau of Foreign Employment agency registry workbook.

## Features

- Serves a single page search interface from `public/`.
- Searches agency name, license number, address, telephone, and email.
- Shows total agency count, expired agencies, and agencies expiring soon.
- Includes an optional command line Excel import for maintenance.

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

If your database is already populated, start the web app:

```bash
npm start
```

Open `http://localhost:3000`.

## Import Options

Run a command line import:

```bash
npm run import -- "SLBF registry.xlsx"
```

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

Returns total agency count, expired count, expiring soon count, and latest import metadata when available.

`GET /api/agencies?q=term&limit=50`

Searches agency name, license number, address, telephone, and email.

`GET /api/agencies/:id`

Returns one full agency record.

## Deployment Note

The web API is read-only. Use your database tools or the optional command line import when registry data needs maintenance.
