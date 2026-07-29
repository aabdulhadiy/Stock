// End-to-end smoke test against a running server, driven through a real browser.
//
// Useful for demonstrating acceptance (§17): it signs in, switches all three
// languages, checks that a language switch mid-form does not lose typed input,
// creates a product, books in a receipt in boxes, reads the stock figures back,
// and downloads both export formats — asserting they are genuinely an XLSX and a
// PDF rather than an error page, which a naive "status 200" check would miss.
//
//   npm run build && npm start &
//   node scripts/smoke.mjs
//
// Environment:
//   BASE   server URL          (default http://127.0.0.1:3000)
//   LOGIN  Director login      (default director)
//   PASS   Director password   (default director12345)
//
// Playwright is not a project dependency — this uses whatever is installed
// globally, and skips cleanly if it is not available.

import { createRequire } from "node:module";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const LOGIN = process.env.LOGIN || "director";
const PASS = process.env.PASS || "director12345";
const STAMP = Date.now().toString(36).toUpperCase().slice(-5);
const SKU = `SMOKE-${STAMP}`;

let chromium;
try {
  const require = createRequire(import.meta.url);
  ({ chromium } = require("playwright"));
} catch {
  console.log("playwright is not installed — skipping the browser smoke test.");
  console.log("Install it with:  npm i -g playwright");
  process.exit(0);
}

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

const waitText = async (page, needle, ms = 10_000) => {
  try {
    await page.waitForFunction((n) => document.body.innerText.includes(n), needle, {
      timeout: ms,
    });
    return true;
  } catch {
    return false;
  }
};

/** The visible locale switcher: the mobile one is hidden at desktop widths. */
const switchTo = (page, title) =>
  page.locator(`button[title="${title}"]`).last().click();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
page.on("pageerror", (e) => {
  console.log("  PAGE ERROR:", e.message);
  failures++;
});

try {
  // --- Sign in -------------------------------------------------------------
  await page.goto(`${BASE}/login`);
  await page.fill("#login", LOGIN);
  await page.fill("#password", PASS);
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  check("sign in lands on the dashboard", page.url().includes("/dashboard"));

  // --- All three languages (§13) ------------------------------------------
  // The switch persists to the user record, so a previous run may have left the
  // Director in any language. Each language is therefore selected explicitly
  // rather than assuming a starting point.
  await switchTo(page, "O'zbekcha");
  check("switching to Uzbek re-renders the shell", await waitText(page, "Ombor"));

  await switchTo(page, "Русский");
  check("switching to Russian re-renders the shell", await waitText(page, "Склад"));

  await switchTo(page, "English");
  check("switching to English re-renders the shell", await waitText(page, "Products"));

  // --- A language switch must not lose unsaved work (§13) -----------------
  await page.goto(`${BASE}/products/new`);
  await page.fill("#sku", `${SKU}-KEEP`);
  await page.fill("#name", "Half typed product");
  await switchTo(page, "Русский");
  await waitText(page, "Артикул");
  const keptSku = await page.inputValue("#sku");
  const keptName = await page.inputValue("#name");
  check(
    "unsaved form input survives a language switch",
    keptSku === `${SKU}-KEEP` && keptName === "Half typed product",
    `sku="${keptSku}"`,
  );
  await switchTo(page, "English");
  await waitText(page, "SKU");

  // --- Create a product ---------------------------------------------------
  await page.goto(`${BASE}/products/new`);
  await page.fill("#sku", SKU);
  await page.fill("#name", "Smoke test bear");
  await page.fill("#unitsPerBox", "12");
  await page.fill("#boxVolumeM3", "0.045");
  await page.fill("#weightKg", "6.5");
  await page.fill("input[name=dimLengthCm]", "40");
  await page.fill("input[name=dimWidthCm]", "30");
  await page.fill("input[name=dimHeightCm]", "25");
  await page.fill("#costPriceCents", "4.50");
  await page.fill("#marketPriceCents", "7.90");
  await page.fill("#exportPriceCents", "9.50");
  await page.fill("#minStock", "100");
  await page.click("button[type=submit]");
  check("creating a product succeeds", await waitText(page, "Product created", 20_000));

  // --- It appears in the catalogue, priced for a Director -----------------
  await page.goto(`${BASE}/products?q=${SKU}`);
  const catalogue = await page.innerText("body");
  check("the product appears in the catalogue", catalogue.includes("Smoke test bear"));
  check("the Director sees the cost price", catalogue.includes("$4.50"));

  // --- Goods receipt, entered in boxes (§4.2) -----------------------------
  await page.goto(`${BASE}/receipts`);
  await page.selectOption("select[name=productId]", {
    label: `${SKU} — Smoke test bear`,
  });
  await page.fill("input[name=qty]", "10");
  await page.selectOption("select[name=enteredAs]", "BOXES");
  check("boxes convert to units live (10 × 12 = 120)", await waitText(page, "= 120", 6_000));
  await page.click("button[type=submit]");
  check("the receipt saves", await waitText(page, "Receipt recorded", 20_000));

  // --- Stock reflects it (§4.1) ------------------------------------------
  await page.goto(`${BASE}/stock?q=${SKU}`);
  const stock = await page.innerText("body");
  check("the stock screen shows 120 on hand", stock.includes("120"));
  check("the Director sees stock value at cost ($540.00)", stock.includes("$540.00"));

  // --- Exports really are an XLSX and a PDF ------------------------------
  const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  for (const [format, contentType, assertBody] of [
    [
      "xlsx",
      "spreadsheetml",
      (buf) => XLSX_MAGIC.every((byte, i) => buf[i] === byte),
    ],
    ["pdf", "application/pdf", (buf) => buf.subarray(0, 5).toString("latin1") === "%PDF-"],
  ]) {
    // Send the cookie explicitly: an APIRequestContext does not always inherit
    // the browser's session, and a silent redirect to /login would otherwise
    // look like a successful 200.
    const res = await context.request.get(`${BASE}/export/stock?format=${format}`, {
      headers: { Cookie: cookieHeader },
    });
    const buf = await res.body();
    const type = res.headers()["content-type"] ?? "";
    check(
      `the stock export (${format}) is a real ${format.toUpperCase()}`,
      res.ok() && type.includes(contentType) && assertBody(buf),
      `${res.status()} ${type} ${buf.length}B`,
    );
  }

  // --- A Russian PDF must still be a PDF (Cyrillic filename, §13) --------
  await page.goto(`${BASE}/stock`);
  await switchTo(page, "Русский");
  await waitText(page, "Склад");
  const ruCookies = (await context.cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const ru = await context.request.get(`${BASE}/export/stock?format=pdf`, {
    headers: { Cookie: ruCookies },
  });
  const ruBuf = await ru.body();
  const disposition = ru.headers()["content-disposition"] ?? "";
  check(
    "a Russian PDF export downloads with an RFC 6266 filename",
    ru.ok() &&
      ruBuf.subarray(0, 5).toString("latin1") === "%PDF-" &&
      disposition.includes("filename*=UTF-8''"),
    `${ruBuf.length}B`,
  );
  await switchTo(page, "English");
  await waitText(page, "Stock");

  // --- The import template ----------------------------------------------
  const tpl = await context.request.get(`${BASE}/products/import/template`, {
    headers: { Cookie: cookieHeader },
  });
  const tplBuf = await tpl.body();
  check(
    "the import template downloads as an XLSX",
    tpl.ok() && XLSX_MAGIC.every((byte, i) => tplBuf[i] === byte),
    `${tplBuf.length}B`,
  );

  // --- A whole order, through the UI (§5, §6, §7, §5.4) -------------------
  // The reservation rules are covered exhaustively by the integration tests;
  // what this adds is proof that the forms are wired to the right actions.
  await page.goto(`${BASE}/customers/new`);
  await page.fill("#name", `Smoke customer ${STAMP}`);
  await page.fill("#phone", `+998 90 ${STAMP}`);
  await page.selectOption("#channel", "DOMESTIC");
  await page.click("button[type=submit]");
  check("creating a customer succeeds", await waitText(page, "Customer created", 20_000));

  await page.goto(`${BASE}/orders/new`);
  // Resolve the option value by its text: selectOption's `label` needs an exact
  // string, and the customer name carries a run-specific suffix.
  const customerValue = await page
    .locator("select[name=customerId] option", { hasText: "Smoke customer" })
    .first()
    .getAttribute("value");
  check("the new customer is selectable on an order", Boolean(customerValue));
  await page.selectOption("select[name=customerId]", customerValue ?? "");
  await page.selectOption("select[name=productId]", { label: `${SKU} — Smoke test bear` });
  await page.fill("input[name=qty]", "5");
  await page.selectOption("select[name=enteredAs]", "BOXES");
  // The price should default from the product's market price.
  const defaulted = await page.inputValue("input[name=unitPrice]");
  check("the line price defaults from the catalogue", defaulted === "7.90", `got "${defaulted}"`);
  // Override it, which §5.2 says must affect only this order.
  await page.fill("input[name=unitPrice]", "7.00");
  await page.selectOption("#paymentTermDays", "30");
  await page.click('button[type=submit]:not([disabled])');
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const orderUrl = page.url();
  const orderPage = await page.innerText("body");
  check("the order is created and opens", /ORD-\d{4}-\d+/.test(orderPage));
  check("60 units are ordered (5 boxes × 12)", orderPage.includes("60"));
  check("nothing is reserved yet (BR-1)", orderPage.includes("New"));

  // Accept it: this is where stock gets reserved (BR-2).
  await page.click('button:has-text("Accept order")');
  check("accepting the order reserves stock", await waitText(page, "stock reserved", 20_000));
  check("the line reads as fully available", await waitText(page, "Full", 10_000));

  // Tick the line off, mark ready, ship.
  await page.click('button:has-text("Mark picked")');
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Mark ready")');
  check("marking ready succeeds", await waitText(page, "ready to ship", 20_000));
  await page.click('button:has-text("Ship order")');
  check("shipping the order deducts stock", await waitText(page, "stock deducted", 20_000));

  // 60 units at $7.00 = $420.00, and stock falls from 120 to 60.
  await page.goto(`${BASE}/stock?q=${SKU}`);
  check("stock fell to 60 after shipping", (await page.innerText("body")).includes("60"));

  await page.goto(`${orderUrl}/payments`);
  const paymentsPage = await page.innerText("body");
  check("the order total is $420.00 (60 × $7.00 override)", paymentsPage.includes("$420.00"));

  // A partial payment, then confirm the remaining balance.
  await page.fill("#amountCents", "100.00");
  await page.click('button[type=submit]:has-text("Record payment")');
  check("recording a partial payment succeeds", await waitText(page, "Payment recorded", 20_000));
  // Wait for the figure rather than snapshotting: the success message appears as
  // soon as the action returns, and the re-rendered numbers land just after.
  check(
    "the remaining balance updates to $320.00 without a reload",
    await waitText(page, "$320.00", 10_000),
  );

  // The catalogue price must be untouched by the order-line override (§5.2).
  await page.goto(`${BASE}/products?q=${SKU}`);
  check(
    "the catalogue market price is still $7.90 (§5.2)",
    (await page.innerText("body")).includes("$7.90"),
  );

  // --- Every main screen renders without an error ------------------------
  for (const path of [
    "/dashboard",
    "/products",
    "/stock",
    "/receipts",
    "/counts",
    "/produce",
    "/frozen",
    "/orders",
    "/orders/new",
    "/queue",
    "/customers",
    "/customers/new",
    "/receivables",
    "/returns",
    "/returns/new",
    "/expenses",
    "/expenses/categories",
    "/expenses/recurring",
    "/reports",
    "/reports/sales",
    "/reports/profit",
    "/reports/stock-value",
    "/reports/abc",
    "/audit",
    "/admin/users",
    "/settings",
  ]) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const body = await page.innerText("body");
    check(
      `${path} renders`,
      (res?.status() ?? 500) < 400 && !/Application error|Internal Server Error/i.test(body),
      String(res?.status()),
    );
  }
  // Hand the app back in its default language.
  await page.goto(`${BASE}/dashboard`);
  await switchTo(page, "O'zbekcha");
  await waitText(page, "Ombor");
} catch (err) {
  console.log(" FAIL  unexpected error:", err.message);
  failures++;
}

await browser.close();
console.log(
  failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
