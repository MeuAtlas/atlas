import { redirect } from "next/navigation";
import { MovementsBrowser } from "@/components/finance/movements-browser";
import { requireFinanceAccess } from "@/modules/finance/access";
import {
  calculateMovementPeriodSummary,
  calculateMovementSummaryByFilter,
  buildMovementQueryKey,
  buildMovementFiltersUrl,
  canonicalizeMovementPath,
  currentMovementFiltersPath,
  deduplicateMovements,
  matchesMovement,
  normalizeMovementFilterState,
  normalizeMovementListItem,
  resolveMovementPeriod,
  type MovementFilters,
} from "@/modules/finance/movement-filters";
import {
  getAvailableCardCycles,
  getMovementsData,
  resolveOpenCardInvoice,
} from "@/modules/finance/queries";

const PAGE_SIZE = 40;

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<MovementFilters>;
}) {
  const rawFilters = await searchParams;
  const { supabase, user } = await requireFinanceAccess();
  const cardCycles = await getAvailableCardCycles(supabase, user.id);
  const filters = normalizeMovementFilterState(rawFilters, cardCycles);
  const selectedCycle = filters.type === "card"
    ? cardCycles.find(cycle => cycle.cycleId === filters.cycle) ?? null
    : null;
  const hasIncompatibleCardParams =
    filters.type === "card" &&
    Boolean(rawFilters.period || rawFilters.from || rawFilters.to || rawFilters.account);
  const hasIncompatibleBankParams =
    filters.type !== "card" &&
    Boolean(rawFilters.bill || rawFilters.cycle);
  const currentPath = currentMovementFiltersPath(rawFilters);
  const canonicalPath = buildMovementFiltersUrl(filters, {}, {
    preservePage: true,
  });
  const needsCanonicalRedirect =
    hasIncompatibleCardParams ||
    hasIncompatibleBankParams ||
    canonicalizeMovementPath(currentPath) !==
      canonicalizeMovementPath(canonicalPath);
  if (needsCanonicalRedirect) {
    redirect(canonicalPath);
  }
  const period = selectedCycle
    ? {
        from: selectedCycle.cycleStartDate,
        to: selectedCycle.cycleEndDate,
      }
    : resolveMovementPeriod(filters);
  const data = await getMovementsData(
    supabase,
    user.id,
    {
      ...period,
      type: filters.type,
      cycleId: selectedCycle?.cycleId,
    },
  );
  const resolvedOpenInvoice = selectedCycle?.status === "open"
    ? await resolveOpenCardInvoice(supabase, user.id, {
        cycleId: selectedCycle.cycleId,
        referenceDate: new Date(),
      })
    : null;
  const normalized = deduplicateMovements([
    ...data.transactions.map(transaction =>
      normalizeMovementListItem(transaction, data.accounts)),
    ...data.cardPurchases.map(purchase => normalizeMovementListItem(purchase)),
  ]).sort((left, right) =>
    right.date.localeCompare(left.date) ||
    (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
  );
  const filtered = normalized.filter(item =>
    matchesMovement(item, filters, selectedCycle));
  const summary = calculateMovementPeriodSummary(filtered);
  const displaySummary = calculateMovementSummaryByFilter(
    filtered,
    filters.type,
    selectedCycle,
  );
  const openCycleBreakdown = resolvedOpenInvoice
    ? {
        newPurchasesTotal: resolvedOpenInvoice.newPurchasesTotal,
        postedInstallmentsTotal: resolvedOpenInvoice.postedInstallmentsTotal,
        projectedUnpostedInstallmentsTotal:
          resolvedOpenInvoice.projectedInstallmentsTotal,
        feesAndTaxesTotal: resolvedOpenInvoice.feesAndTaxesTotal,
        creditsAndRefundsTotal:
          resolvedOpenInvoice.creditsAndRefundsTotal,
        detailedTotal: resolvedOpenInvoice.detailedTotal,
        confirmedOpenTotal: resolvedOpenInvoice.confirmedOpenTotal,
        reconciliationDifference:
          resolvedOpenInvoice.reconciliationDifference,
        installmentsDataStatus: data.installmentsDataStatus,
      }
    : null;
  const requestedPage = Number(filters.page || "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const offset = (page - 1) * PAGE_SIZE;
  const items = filtered.slice(offset, offset + PAGE_SIZE);
  const activeAccounts = data.accounts
    .filter(account => account.status === "active")
    .map(account => ({
      id: account.id,
      name: account.institution_name && account.institution_name !== account.name
        ? `${account.institution_name} · ${account.name}`
        : account.name,
    }));
  const activeCards = data.cards
    .filter(card => card.status === "active" && !card.user_archived_at)
    .flatMap(card => {
      const instruments = (card.credit_card_instruments ?? [])
        .filter(instrument => !instrument.user_archived_at)
        .map(instrument => ({
          id: instrument.id,
          parentId: card.id,
          name: `${instrument.display_name}${
            instrument.last_four_digits
              ? ` · final ${instrument.last_four_digits}`
              : ""
          }`,
        }));
      return instruments.length
        ? instruments
        : [{
          id: card.id,
          parentId: card.id,
          name: `${card.name}${
            card.last_four_digits ? ` · final ${card.last_four_digits}` : ""
          }`,
        }];
    });
  return (
    <MovementsBrowser
      key={buildMovementQueryKey(filters)}
      filters={filters}
      items={items}
      summary={summary}
      displaySummary={displaySummary}
      openCycleBreakdown={openCycleBreakdown}
      resolvedOpenInvoice={resolvedOpenInvoice}
      accounts={activeAccounts}
      cards={activeCards}
      cardCycles={cardCycles}
      selectedCycle={selectedCycle}
      categories={data.categories.map(category => ({
        id: String(category.id),
        name: String(category.name),
      }))}
      totalCount={filtered.length}
      page={page}
      pageSize={PAGE_SIZE}
      hasConnectedAccount={data.connections.length > 0}
      completeness={data.completeness}
      warnings={data.warnings}
    />
  );
}
