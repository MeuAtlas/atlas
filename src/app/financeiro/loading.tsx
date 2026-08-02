export default function Loading() {
  return (
    <main className="finance-overview fov-dashboard fov-loading" aria-label="Carregando visão geral financeira">
      <header className="fov-header"><i /><i /></header>
      <i className="fov-loading-wide compact" />
      <section className="fov-position-grid">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</section>
      <section className="fov-flow-layout"><i /><i className="fov-loading-highlight" /></section>
      <section className="fov-two-column"><i /><i /></section>
      <section className="fov-two-column"><i /><i /></section>
      <i className="fov-loading-wide compact" />
      <section className="fov-next-period">
        <i className="fov-loading-wide compact" />
        <section className="fov-position-grid">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</section>
        <section className="fov-two-column"><i /><i /></section>
        <section className="fov-two-column"><i /><i /></section>
        <i className="fov-loading-wide" />
      </section>
    </main>
  );
}
