export default function IncomeExpensesLoading() {
  return (
    <div className="ied-loading" aria-label="Carregando Receitas e Despesas">
      <div className="ied-loading-title" />
      <div className="ied-loading-tabs" />
      <div className="ied-loading-kpis">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div>
      <div className="ied-loading-main"><i /><i /></div>
      <div className="ied-loading-payroll" />
      <div className="ied-loading-main small"><i /><i /></div>
    </div>
  );
}
