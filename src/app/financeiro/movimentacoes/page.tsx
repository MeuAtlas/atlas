import { redirect } from "next/navigation";
import { MovementsBrowser } from "@/components/finance/movements-browser";
import { requireFinanceAccess } from "@/modules/finance/access";
import {
  calculateMovementPeriodSummary,
  calculateMovementSummaryByFilter,
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
import { scoreCommitmentMatch } from "@/modules/finance/commitments";
import {
  mapCommitment,
  mapOccurrence,
} from "@/modules/finance/commitments-query";
import {
  getMovementPersonContexts,
} from "@/modules/finance/person-reimbursements-query";
import {
  getMovementExpenseEstablishmentContexts,
} from "@/modules/finance/expense-establishments";
import { splitCardTransactions } from "@/modules/finance/card-movements-view-model";
import { resolveOpenProjectionCardAccountIds } from "@/modules/finance/card-cycle-accounts";

const PAGE_SIZE = 40;

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<MovementFilters>;
}) {
  const rawFilters = await searchParams;
  const { supabase, user } = await requireFinanceAccess();
  const workspacesResult = await supabase.from("workspaces")
    .select("id").order("type");
  const workspaceId = workspacesResult.data?.find(item =>
    item.id === rawFilters.workspace
  )?.id ?? workspacesResult.data?.[0]?.id ?? null;
  const availableCardCycles = await getAvailableCardCycles(supabase, user.id);
  const filters = normalizeMovementFilterState(rawFilters, availableCardCycles);
  const requestedCycle = filters.type === "card"
    ? availableCardCycles.find(cycle => cycle.cycleId === filters.cycle) ?? null
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
  const period = requestedCycle
    ? {
        from: requestedCycle.cycleStartDate,
        to: requestedCycle.cycleEndDate,
      }
    : resolveMovementPeriod(filters);
  const data = await getMovementsData(
    supabase,
    user.id,
    {
      ...period,
      type: filters.type,
      cycleId: requestedCycle?.cycleId,
    },
  );
  const cardCycles = availableCardCycles.map(cycle => {
    if (!["open", "partial"].includes(cycle.status)) return cycle;
    return {
      ...cycle,
      cardIds: [...new Set([
        ...resolveOpenProjectionCardAccountIds(cycle.cardId, data.cards).cardIds,
        ...availableCardCycles
          .filter(other => ["open", "partial"].includes(other.status))
          .flatMap(other => other.cardIds),
      ])],
    };
  });
  const selectedCycle = filters.type === "card"
    ? cardCycles.find(cycle => cycle.cycleId === filters.cycle) ?? null
    : null;
  const resolvedOpenInvoice = selectedCycle?.status === "open"
    ? await resolveOpenCardInvoice(supabase, user.id, {
        cycleId: selectedCycle.cycleId,
        referenceDate: new Date(),
        movementData: data,
      })
    : null;
  const normalizedBase = deduplicateMovements([
    ...data.transactions.map(transaction =>
      normalizeMovementListItem(transaction, data.accounts)),
    ...data.cardPurchases.map(purchase => normalizeMovementListItem(purchase)),
  ]).sort((left, right) =>
    right.date.localeCompare(left.date) ||
    (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
  );
  const normalized = normalizedBase;
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
  const cardSections = filters.type === "card"
    ? splitCardTransactions(filtered)
    : null;
  const regularTotalCount = cardSections?.regular.length ?? filtered.length;
  const items = cardSections
    ? [
        ...cardSections.installments,
        ...cardSections.regular.slice(offset, offset + PAGE_SIZE),
      ]
    : filtered.slice(offset, offset + PAGE_SIZE);
  const transactionItemIds = items
    .filter(item => item.sourceKind === "transaction").map(item => item.id);
  const [personContexts, establishmentContexts] = workspaceId
    ? await Promise.all([
        getMovementPersonContexts(supabase, workspaceId, transactionItemIds),
        getMovementExpenseEstablishmentContexts(
          supabase, workspaceId, transactionItemIds,
        ),
      ])
    : [{}, {}];
  const activeAccounts = data.accounts
    .filter(account => account.status === "active")
    .map(account => ({
      id: account.id,
      name: account.institution_name && account.institution_name !== account.name
        ? `${account.institution_name} · ${account.name}`
        : account.name,
    }));
  const activeCards = data.cards
    .filter(card => card.status !== "archived" && !card.user_archived_at)
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
  const displayedCardIds = new Set(activeCards.map(card => card.parentId ?? card.id));
  for (const cycle of cardCycles) {
    if (!["open", "partial"].includes(cycle.status) ||
      displayedCardIds.has(cycle.cardId)) continue;
    activeCards.push({
      id: cycle.cardId,
      parentId: cycle.cardId,
      name: cycle.cardLabel,
    });
    displayedCardIds.add(cycle.cardId);
  }
  const [peopleResult, occurrenceResult, decisionsResult] = workspaceId
    ? await Promise.all([
        supabase.from("financial_people").select("id,name")
          .eq("workspace_id", workspaceId).eq("is_active", true)
          .neq("relation_type", "self")
          .is("archived_at", null).order("name"),
        supabase.from("financial_commitment_occurrences").select(
          "*,financial_commitments!inner(id,workspace_id,title,description,commitment_type,recurrence_frequency,recurrence_interval,amount_type,expected_amount,minimum_expected_amount,maximum_expected_amount,currency_code,category_id,account_id,card_id,payment_method,due_day,due_date,start_date,end_date,next_due_date,status,auto_match_enabled,merchant_match_pattern,description_match_pattern,expected_day_tolerance,expected_amount_tolerance,source,source_record_id,is_payroll_deduction,generates_future_projections,last_generated_until)",
        ).eq("workspace_id", workspaceId)
          .not("status", "in", '("cancelled","skipped","disputed")')
          .gte("competence_month", `${period.from.slice(0, 7)}-01`)
          .lte("competence_month", `${period.to.slice(0, 7)}-01`)
          .is("linked_card_movement_id", null)
          .order("expected_due_date").limit(300),
        supabase.from("commitment_match_decisions")
          .select("fingerprint").eq("workspace_id", workspaceId)
          .eq("decision", "rejected"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const rejectedMatches = new Set((decisionsResult.data ?? []).map(item =>
    String(item.fingerprint)
  ));
  return (
    <MovementsBrowser
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
      paginationTotalCount={regularTotalCount}
      page={page}
      pageSize={PAGE_SIZE}
      hasConnectedAccount={data.connections.length > 0}
      completeness={data.completeness}
      warnings={data.warnings}
      workspaceId={workspaceId}
      people={(peopleResult.data ?? []).map(item => ({
        id: String(item.id),
        name: String(item.name),
      }))}
      commitmentOccurrences={(occurrenceResult.data ?? []).map(item => {
        const commitment = Array.isArray(item.financial_commitments)
          ? item.financial_commitments[0]
          : item.financial_commitments;
        return {
          id: String(item.id),
          name: `${commitment?.title ?? "Compromisso"} · ${
            item.expected_due_date ?? item.competence_month
          } · R$ ${Number(item.expected_amount ?? 0).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
          })}`,
        };
      })}
      commitmentMatches={items
        .filter(item => item.sourceKind === "transaction")
        .flatMap(item => (occurrenceResult.data ?? []).map(row => {
          const commitmentRow = Array.isArray(row.financial_commitments)
            ? row.financial_commitments[0]
            : row.financial_commitments;
          if (!commitmentRow?.auto_match_enabled || row.status === "paid") return null;
          const candidate = scoreCommitmentMatch({
            occurrence: mapOccurrence(
              row as unknown as Parameters<typeof mapOccurrence>[0],
            ),
            commitment: mapCommitment(
              commitmentRow as unknown as Parameters<typeof mapCommitment>[0],
            ),
            transaction: {
              id: item.id,
              description: item.originalDescription,
              merchant: item.normalizedDescription,
              amountCents: Math.round(Math.abs(item.amount) * 100),
              date: item.date,
              accountId: item.accountId,
              cardId: item.cardId,
            },
          });
          const fingerprint =
            `transaction:${item.id}:commitment:${commitmentRow.id}`;
          return candidate.score >= 0.7 && !rejectedMatches.has(fingerprint) ? {
            transactionId: item.id,
            occurrenceId: String(row.id),
            commitmentId: String(commitmentRow.id),
            title: String(commitmentRow.title),
            score: candidate.score,
            decision: candidate.decision,
            reasons: candidate.reasons,
          } : null;
        }).filter(candidate => candidate !== null))}
      personContexts={personContexts}
      establishmentContexts={establishmentContexts}
    />
  );
}
