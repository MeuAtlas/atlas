export type CardCycleAccountCandidate = {
  id: string;
  external_id?: string | null;
  bank_connection_id?: string | null;
  status?: string | null;
  user_archived_at?: string | null;
  credit_card_instruments?: Array<{
    id: string;
    last_four_digits?: string | null;
    user_archived_at?: string | null;
  }> | null;
};

export type CardCycleAccountResolution = {
  primaryAccountId: string;
  accountIds: string[];
  cardIds: string[];
  instrumentIds: string[];
  instrumentLastFours: string[];
  resolutionSource: "primary_card";
};

export function resolveCardCycleAccountIds(
  primaryCardId: string,
  cards: CardCycleAccountCandidate[],
): CardCycleAccountResolution {
  const primary = cards.find(card => card.id === primaryCardId);
  // A Pluggy Item/connection can expose multiple independent CREDIT accounts
  // (for example, one Mastercard and one Visa). Sharing a connection does not
  // mean sharing a bill. Additional and virtual cards belonging to the same
  // bill are already represented as instruments of the primary credit account.
  const resolved = [primary ?? { id: primaryCardId }];
  const cardIds = [...new Set(resolved.map(card => card.id))];
  const providerAccountIds = [...new Set(
    resolved
      .map(card => card.external_id)
      .filter((value): value is string => Boolean(value)),
  )];
  const instruments = resolved.flatMap(card =>
    (card.credit_card_instruments ?? []).filter(instrument =>
      !instrument.user_archived_at));
  return {
    primaryAccountId: primary?.external_id ?? primaryCardId,
    accountIds: providerAccountIds.length ? providerAccountIds : cardIds,
    cardIds,
    instrumentIds: [...new Set(instruments.map(instrument => instrument.id))],
    instrumentLastFours: [...new Set(
      instruments
        .map(instrument => instrument.last_four_digits)
        .filter((value): value is string => Boolean(value)),
    )],
    resolutionSource: "primary_card",
  };
}

export function resolveCycleCompetenceMonth(cycle: {
  due_date?: string | null;
  closing_date?: string | null;
  reference_month: string;
}) {
  return `${
    cycle.due_date ??
    cycle.closing_date ??
    cycle.reference_month
  }`.slice(0, 7) + "-01";
}
