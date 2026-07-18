const state = {
  query: "",
  results: [],
  selectedId: null,
  searchTimer: null
};

const els = {
  searchInput: document.querySelector("#searchInput"),
  results: document.querySelector("#results"),
  resultCount: document.querySelector("#resultCount"),
  detail: document.querySelector("#detail"),
  registryFile: document.querySelector("#registryFile"),
  uploadStatus: document.querySelector("#uploadStatus"),
  defaultImportBtn: document.querySelector("#defaultImportBtn"),
  totalAgencies: document.querySelector("#totalAgencies"),
  expiringSoon: document.querySelector("#expiringSoon"),
  expiredAgencies: document.querySelector("#expiredAgencies"),
  lastUpdate: document.querySelector("#lastUpdate")
};

function formatDate(value) {
  if (!value) {
    return "Not listed";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatTimestamp(value) {
  if (!value) {
    return "Last update pending";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return `Last update ${value}`;
  }

  return `Last update ${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date)}`;
}

function statusLabel(agency) {
  if (agency.status === "expired") {
    return "Expired";
  }
  if (agency.status === "expiring") {
    return "Expiring";
  }
  if (agency.status === "active") {
    return "Active";
  }
  return "Unknown";
}

function expiryLine(agency) {
  if (agency.days_until_expiry === null || agency.days_until_expiry === undefined) {
    return "Expiry not listed";
  }
  if (agency.days_until_expiry < 0) {
    return `${Math.abs(agency.days_until_expiry)} days expired`;
  }
  if (agency.days_until_expiry === 0) {
    return "Expires today";
  }
  return `${agency.days_until_expiry} days remaining`;
}

function setText(el, value) {
  el.textContent = value;
}

function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function loadStatus() {
  const status = await fetchJson("/api/status");
  setText(els.totalAgencies, status.totalAgencies.toLocaleString());
  setText(els.expiringSoon, status.expiringSoonAgencies.toLocaleString());
  setText(els.expiredAgencies, status.expiredAgencies.toLocaleString());
  setText(els.lastUpdate, formatTimestamp(status.lastImportTimestamp));
  els.defaultImportBtn.hidden = !status.defaultImportAvailable;
}

async function searchAgencies(query = state.query) {
  state.query = query.trim();
  const payload = await fetchJson(`/api/find?q=${encodeURIComponent(state.query)}&limit=50`);
  state.results = payload.results;
  renderResults();
}

function renderResults() {
  clearNode(els.results);
  setText(els.resultCount, `${state.results.length} found`);

  if (state.results.length === 0) {
    els.results.appendChild(makeEl("p", "empty-list", "No matching agencies found."));
    return;
  }

  for (const agency of state.results) {
    const button = makeEl("button", "result-item");
    button.type = "button";
    button.dataset.id = agency.id;
    if (agency.id === state.selectedId) {
      button.classList.add("active");
    }

    const body = makeEl("span");
    const title = makeEl("strong", "", agency.agency);
    const meta = makeEl(
      "span",
      "meta",
      `License ${agency.license_no} - Valid up to ${formatDate(agency.valid_up_to_iso || agency.valid_up_to_raw)}`
    );
    body.append(title, meta);

    const pill = makeEl("span", `pill ${agency.status}`, statusLabel(agency));
    button.append(body, pill);
    button.addEventListener("click", () => selectAgency(agency.id));
    els.results.appendChild(button);
  }
}

function makeField(label, value, options = {}) {
  const field = makeEl("div", options.full ? "field full" : "field");
  field.appendChild(makeEl("span", "", label));

  if (options.href && value) {
    const link = makeEl("a", "", value);
    link.href = options.href;
    if (options.external) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
    field.appendChild(link);
  } else {
    field.appendChild(makeEl("p", "", value || "Not listed"));
  }

  return field;
}

function rawExtras(agency) {
  const hidden = new Set([
    "id",
    "Agency",
    "L.No",
    "Address",
    "Telephone",
    "Fax",
    "Email",
    "Valid Up to",
    "Source",
    "name",
    "license_no",
    "address",
    "telephone",
    "fax",
    "email",
    "valid_till",
    "reference",
    "created_at"
  ]);

  return Object.entries(agency.raw || {}).filter(([key, value]) => {
    return !hidden.has(key) && String(value || "").trim() !== "";
  });
}

function renderDetail(agency) {
  clearNode(els.detail);

  const head = makeEl("div", "detail-head");
  const titleWrap = makeEl("div");
  titleWrap.appendChild(makeEl("h2", "", agency.agency));

  const license = makeEl("p", "license");
  license.append("License ");
  license.appendChild(makeEl("b", "", agency.license_no));
  titleWrap.appendChild(license);

  const pill = makeEl("span", `pill ${agency.status}`, statusLabel(agency));
  head.append(titleWrap, pill);

  const grid = makeEl("div", "field-grid");
  grid.appendChild(makeField("License Expire Date", formatDate(agency.valid_up_to_iso || agency.valid_up_to_raw)));
  grid.appendChild(makeField("Expiry Status", expiryLine(agency)));
  grid.appendChild(makeField("Address", agency.address, { full: true }));
  grid.appendChild(makeField("Telephone", agency.telephone));
  grid.appendChild(makeField("Fax", agency.fax));
  grid.appendChild(
    makeField("Email", agency.email, {
      href: agency.email ? `mailto:${agency.email}` : ""
    })
  );
  grid.appendChild(
    makeField("Source", agency.source, {
      href: agency.source,
      external: true
    })
  );

  els.detail.append(head, grid);

  const extras = rawExtras(agency);
  if (extras.length > 0) {
    const list = makeEl("dl", "extra-grid");
    for (const [key, value] of extras) {
      list.appendChild(makeEl("dt", "", key));
      list.appendChild(makeEl("dd", "", value));
    }
    els.detail.appendChild(list);
  }
}

async function selectAgency(id) {
  state.selectedId = id;
  renderResults();
  const agency = await fetchJson(`/api/agencies/${id}`);
  renderDetail(agency);
}

async function importDefaultWorkbook() {
  setText(els.uploadStatus, "Importing workbook...");
  els.defaultImportBtn.disabled = true;
  try {
    const payload = await fetchJson("/api/import/default", { method: "POST" });
    setText(
      els.uploadStatus,
      `Imported: ${payload.result.inserted} new, ${payload.result.updated} updated.`
    );
    await loadStatus();
    await searchAgencies();
  } catch (error) {
    setText(els.uploadStatus, error.message);
  } finally {
    els.defaultImportBtn.disabled = false;
  }
}

async function uploadWorkbook(file) {
  if (!file) {
    return;
  }

  const formData = new FormData();
  formData.append("registry", file);
  setText(els.uploadStatus, "Uploading registry...");

  try {
    const payload = await fetchJson("/api/import", {
      method: "POST",
      body: formData
    });
    setText(
      els.uploadStatus,
      `Imported: ${payload.result.inserted} new, ${payload.result.updated} updated.`
    );
    await loadStatus();
    await searchAgencies();
  } catch (error) {
    setText(els.uploadStatus, error.message);
  } finally {
    els.registryFile.value = "";
  }
}

els.searchInput.addEventListener("input", () => {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => {
    searchAgencies(els.searchInput.value).catch((error) => {
      setText(els.uploadStatus, error.message);
    });
  }, 180);
});

els.registryFile.addEventListener("change", () => {
  uploadWorkbook(els.registryFile.files[0]);
});

els.defaultImportBtn.addEventListener("click", () => {
  importDefaultWorkbook();
});

loadStatus()
  .then(() => searchAgencies(""))
  .catch((error) => {
    setText(els.uploadStatus, error.message);
  });
