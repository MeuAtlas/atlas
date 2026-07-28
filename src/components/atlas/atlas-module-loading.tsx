export type AtlasLoadingSkeleton =
  | "overview"
  | "transactions"
  | "accounts"
  | "cards"
  | "loans"
  | "commitments"
  | "planning"
  | "reports"
  | "integrations"
  | "invoice-review"
  | "generic";

export type AtlasModuleLoadingProps = {
  title: string;
  description?: string;
  variant?: "finance" | "default";
  showSkeleton?: boolean;
  skeletonType?: AtlasLoadingSkeleton;
  compact?: boolean;
  className?: string;
};

function SkeletonLine({ size = "full" }: { size?: "short" | "medium" | "full" }) {
  return <i className={`atlas-loading-line ${size}`} aria-hidden="true" />;
}

function TransactionRows() {
  return (
    <div className="atlas-loading-transaction-list" data-skeleton="transactions">
      <div className="atlas-loading-toolbar">
        <SkeletonLine />
        <SkeletonLine size="short" />
        <SkeletonLine size="short" />
      </div>
      {Array.from({ length: 4 }, (_, index) => (
        <div className="atlas-loading-transaction" key={index}>
          <i className="atlas-loading-date" />
          <span>
            <SkeletonLine size={index % 2 ? "medium" : "full"} />
            <SkeletonLine size="short" />
          </span>
          <SkeletonLine size="short" />
        </div>
      ))}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="atlas-loading-overview" data-skeleton="overview">
      <div className="atlas-loading-overview-balance-card">
        <span>
          <SkeletonLine size="medium" />
          <SkeletonLine size="short" />
          <i className="atlas-loading-balance" />
        </span>
        <span>
          <SkeletonLine size="medium" />
          <SkeletonLine size="short" />
        </span>
      </div>
      <div className="atlas-loading-overview-analysis">
        <div className="atlas-loading-overview-main">
          <SkeletonLine size="medium" />
          <i className="atlas-loading-chart" />
        </div>
        <div className="atlas-loading-overview-side">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="atlas-loading-overview-lower">
        <article className="atlas-loading-invoice-summary">
          <SkeletonLine size="medium" />
          <SkeletonLine size="short" />
          <span>
            <i />
            <i />
          </span>
          <i className="atlas-loading-invoice-value" />
          <SkeletonLine size="medium" />
          <SkeletonLine size="short" />
        </article>
        <i />
      </div>
    </div>
  );
}

function AccountCards({ kind }: { kind: "accounts" | "cards" | "loans" }) {
  return (
    <div className={`atlas-loading-card-grid ${kind}`} data-skeleton={kind}>
      {Array.from({ length: 3 }, (_, index) => (
        <article key={index}>
          <header>
            <i className="atlas-loading-card-icon" />
            <SkeletonLine size="medium" />
          </header>
          <i className="atlas-loading-card-value" />
          <SkeletonLine size="short" />
          <SkeletonLine size={index === 1 ? "medium" : "full"} />
        </article>
      ))}
    </div>
  );
}

function CommitmentsSkeleton() {
  return (
    <div className="atlas-loading-commitments" data-skeleton="commitments">
      <div className="atlas-loading-commitment-summary">
        <i />
        <i />
        <i />
      </div>
      <div className="atlas-loading-toolbar">
        <SkeletonLine />
        <SkeletonLine size="short" />
      </div>
      {Array.from({ length: 4 }, (_, index) => (
        <div className="atlas-loading-commitment-row" key={index}>
          <i className="atlas-loading-date" />
          <span>
            <SkeletonLine size="medium" />
            <SkeletonLine size="short" />
          </span>
          <SkeletonLine size="short" />
        </div>
      ))}
    </div>
  );
}

function PlanningSkeleton({ type }: { type: "planning" | "reports" }) {
  return (
    <div className={`atlas-loading-planning ${type}`} data-skeleton={type}>
      <div>
        <SkeletonLine size="medium" />
        <i className="atlas-loading-projection-chart" />
      </div>
      <aside>
        <i />
        <i />
        <i />
      </aside>
    </div>
  );
}

function IntegrationsSkeleton() {
  return (
    <div className="atlas-loading-integrations" data-skeleton="integrations">
      {Array.from({ length: 3 }, (_, index) => (
        <article key={index}>
          <i className="atlas-loading-provider-icon" />
          <span>
            <SkeletonLine size="medium" />
            <SkeletonLine size="short" />
          </span>
          <i className="atlas-loading-status-pill" />
        </article>
      ))}
    </div>
  );
}

function InvoiceReviewSkeleton() {
  return (
    <div className="atlas-loading-invoice-review" data-skeleton="invoice-review">
      <div className="atlas-loading-invoice-review-summary">
        <i />
        <i />
        <i />
      </div>
      <div className="atlas-loading-invoice-review-reconciliation">
        <SkeletonLine size="medium" />
        <span><i /><i /><i /><i /></span>
      </div>
      <div className="atlas-loading-invoice-review-rows">
        <SkeletonLine size="medium" />
        <i /><i /><i />
      </div>
      <div className="atlas-loading-invoice-review-installments">
        <SkeletonLine size="short" />
        <i /><i />
      </div>
    </div>
  );
}

function StructuralSkeleton({ type }: { type: AtlasLoadingSkeleton }) {
  if (type === "overview") return <OverviewSkeleton />;
  if (type === "transactions") return <TransactionRows />;
  if (type === "accounts" || type === "cards" || type === "loans") {
    return <AccountCards kind={type} />;
  }
  if (type === "commitments") return <CommitmentsSkeleton />;
  if (type === "planning" || type === "reports") {
    return <PlanningSkeleton type={type} />;
  }
  if (type === "integrations") return <IntegrationsSkeleton />;
  if (type === "invoice-review") return <InvoiceReviewSkeleton />;
  return (
    <div className="atlas-loading-generic" data-skeleton="generic">
      <SkeletonLine size="medium" />
      <SkeletonLine />
      <SkeletonLine />
    </div>
  );
}

function AtlasLoadingPlanet() {
  return (
    <svg
      className="atlas-loading-planet"
      viewBox="0 0 160 160"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="atlas-loading-planet-fill" cx="34%" cy="28%">
          <stop offset="0%" stopColor="var(--atlas-loading-planet-highlight)" />
          <stop offset="58%" stopColor="var(--atlas-loading-planet-mid)" />
          <stop offset="100%" stopColor="var(--atlas-loading-planet-shadow)" />
        </radialGradient>
        <radialGradient id="atlas-loading-satellite-fill">
          <stop offset="0%" stopColor="white" />
          <stop offset="45%" stopColor="var(--atlas-loading-orbit-dot)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <filter id="atlas-loading-halo" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <circle
        className="atlas-loading-halo"
        cx="80"
        cy="80"
        r="34"
        filter="url(#atlas-loading-halo)"
      />
      <ellipse className="atlas-loading-orbit" cx="80" cy="80" rx="66" ry="25" />
      <g className="atlas-loading-orbit-spinner">
        <circle
          className="atlas-loading-satellite-glow"
          cx="80"
          cy="27"
          r="9"
          fill="url(#atlas-loading-satellite-fill)"
        />
        <circle className="atlas-loading-satellite" cx="80" cy="27" r="3.2" />
      </g>
      <g className="atlas-loading-planet-core">
        <circle cx="80" cy="80" r="31" fill="url(#atlas-loading-planet-fill)" />
        <path d="M58 67c11 6 29 5 43-2M60 91c13-6 28-4 39 3" />
        <ellipse cx="69" cy="65" rx="10" ry="5" />
      </g>
      <path className="atlas-loading-ring-back" d="M23 88c18 13 93 14 115-7" />
      <path className="atlas-loading-ring-front" d="M23 88c21 24 94 22 115-7" />
    </svg>
  );
}

export function AtlasModuleLoading({
  title,
  description,
  variant = "default",
  showSkeleton = true,
  skeletonType = "generic",
  compact = false,
  className = "",
}: AtlasModuleLoadingProps) {
  return (
    <section
      className={`atlas-module-loading ${variant} ${compact ? "compact" : ""} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={title}
    >
      <div className="atlas-loading-message">
        <AtlasLoadingPlanet />
        <div>
          <h2>
            {title}
            <span className="atlas-loading-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {showSkeleton ? <StructuralSkeleton type={skeletonType} /> : null}
    </section>
  );
}
