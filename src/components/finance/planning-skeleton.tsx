export function PlanningSkeleton() {
  return <div className="planning-dashboard planning-skeleton" role="status" aria-label="Carregando planejamento"><header><span /><i /><i /></header><section><div>{Array.from({ length: 4 }, (_, index) => <article key={index}><i /><b /><span /></article>)}</div></section><section><i className="chart" /><div>{Array.from({ length: 3 }, (_, index) => <span key={index} />)}</div></section><section className="columns"><article /><article /></section><span className="sr-only">Calculando projeções</span></div>;
}
