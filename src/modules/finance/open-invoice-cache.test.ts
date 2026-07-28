import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/modules/finance/open-invoice-cache.ts",
  "utf8",
);

test("invalidação central usa cycleId, tag imediata e as três páginas", () => {
  assert.match(
    source,
    /openInvoiceCacheTag\(identity\.workspaceId, identity\.cycleId\)/,
  );
  assert.match(source, /revalidateTag\([\s\S]*\{ expire: 0 \}/);
  for (const path of [
    "/financeiro",
    "/financeiro/cartoes",
    "/financeiro/movimentacoes",
  ]) assert.match(source, new RegExp(`revalidatePath\\("${path}"\\)`));
});

test("manual confirmation, synchronization and PDF invalidate the same invoice", () => {
  for (const path of [
    "src/modules/finance/actions.ts",
    "src/app/financeiro/integracoes/actions.ts",
    "src/app/api/invoice-imports/[id]/confirm/route.ts",
  ]) {
    const mutation = readFileSync(path, "utf8");
    assert.match(mutation, /invalidateOpenInvoiceCache/);
    assert.match(mutation, /cycleId/);
    assert.match(mutation, /workspaceId/);
  }
});
