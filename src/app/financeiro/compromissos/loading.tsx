export default function Loading() {
  return (
    <div className="commitments-page" aria-busy="true">
      <div className="commitment-skeleton commitment-skeleton-title" />
      <div className="commitment-summary-grid">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="commitment-skeleton" key={index} />
        ))}
      </div>
      <div className="commitment-skeleton commitment-skeleton-body" />
    </div>
  );
}
