import json
import sys
from collections import defaultdict
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

source_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
report = json.loads(source_path.read_text(encoding="utf-8"))
output_path.parent.mkdir(parents=True, exist_ok=True)
styles = getSampleStyleSheet()
title = ParagraphStyle("Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=colors.HexColor("#0b1d35"))
h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=colors.HexColor("#14365d"), spaceBefore=6, spaceAfter=4)
body = ParagraphStyle("Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.5, leading=10)
small = ParagraphStyle("Small", parent=body, fontSize=6.5, leading=8, textColor=colors.HexColor("#52606d"))
status_labels = {"ELIGIBLE": "DEVIDO", "NOT_ELIGIBLE": "NÃO DEVIDO", "UNKNOWN": "PENDENTE"}
meal_labels = {"DOMESTIC_BREAKFAST": "Café", "DOMESTIC_LUNCH": "Almoço", "DOMESTIC_DINNER": "Jantar", "DOMESTIC_SUPPER": "Ceia", "INTERNATIONAL_BREAKFAST": "Café", "INTERNATIONAL_LUNCH": "Almoço", "INTERNATIONAL_DINNER": "Jantar", "INTERNATIONAL_SUPPER": "Ceia", "MADRUGADA_TRANSPORT_REIMBURSEMENT": "Transporte madrugada"}
reason_labels = {"ELIGIBLE_TRAINING_OVERLAP": "atividade de treinamento", "ELIGIBLE_DEADHEAD_OVERLAP": "deadhead a serviço", "ELIGIBLE_RESERVE_OVERLAP": "reserva", "ELIGIBLE_SERVICE_OVERLAP": "serviço documentado", "NOT_ELIGIBLE_NO_SERVICE_IN_WINDOW": "sem serviço na janela", "NOT_ELIGIBLE_HOTEL_BREAKFAST": "café fornecido pelo hotel", "AT_CONTRACTUAL_BASE": "na base contratual", "UNKNOWN_LOCATION": "localização não confirmada", "UNKNOWN_HOTEL_STATUS": "hotel não confirmado", "UNKNOWN_STANDBY_DOCUMENTARY_POLICY": "política documental de standby pendente"}

def money(currency, value):
    if value is None or not currency:
        return "PENDENTE"
    number = value / 100
    if currency == "BRL":
        return f"R$ {number:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    symbols = {"USD": "US$", "EUR": "EUR", "GBP": "GBP"}
    return f"{symbols.get(currency, currency)} {number:,.2f}"

def page_number(canvas, doc):
    canvas.saveState(); canvas.setFont("Helvetica", 7); canvas.setFillColor(colors.HexColor("#52606d")); canvas.drawString(1.7*cm, 1.1*cm, "Atlas Flight - Auditoria de Diárias - dados persistidos"); canvas.drawRightString(A4[0]-1.7*cm, 1.1*cm, f"Página {doc.page}"); canvas.restoreState()

story = [Paragraph("Atlas Flight - Auditoria de Diárias", title), Paragraph("Agosto/2026 - exportação para reconciliação manual. Fonte única: entitlements persistidos da execução corrente.", body), Spacer(1, 10)]
summary_rows = [["Período", "Pagamento", "BRL", "USD", "EUR", "GBP", "Pendências"]]
for summary in report["summaries"]:
    currency = {value["currency"]: value for value in summary["currencies"]}
    summary_rows.append(["01-15" if summary["half"] == "FIRST_HALF" else "16-31", summary["paymentDate"], money("BRL", currency["BRL"]["dailyKnownMinorUnits"]), money("USD", currency["USD"]["dailyKnownMinorUnits"]), money("EUR", currency["EUR"]["dailyKnownMinorUnits"]), money("GBP", currency["GBP"]["dailyKnownMinorUnits"]), str(summary["unknownCount"])])
table = Table(summary_rows, colWidths=[1.6*cm, 2.1*cm, 2.0*cm, 2.0*cm, 1.7*cm, 1.7*cm, 1.8*cm])
table.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), colors.HexColor("#163a64")), ("TEXTCOLOR", (0,0), (-1,0), colors.white), ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("FONTNAME", (0,1), (-1,-1), "Helvetica"), ("FONTSIZE", (0,0), (-1,-1), 7), ("GRID", (0,0), (-1,-1), .25, colors.HexColor("#cdd7e1")), ("VALIGN", (0,0), (-1,-1), "MIDDLE"), ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5)]))
story += [table, Spacer(1, 10), Paragraph("Reconciliação", h2)]
recon_rows = [["Período", "Moeda", "Soma diária", "Ciclo", "Delta", "Status"]]
for item in report["reconciliation"]:
    recon_rows.append(["01-15" if item["half"] == "FIRST_HALF" else "16-31", item["currency"], money(item["currency"], item["dailyKnownMinorUnits"]), money(item["currency"], item["cycleKnownMinorUnits"]), money(item["currency"], item["deltaMinorUnits"]), item["status"]])
recon = Table(recon_rows, colWidths=[1.5*cm, 1.5*cm, 2.5*cm, 2.5*cm, 2.1*cm, 3.1*cm])
recon.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), colors.HexColor("#163a64")), ("TEXTCOLOR", (0,0), (-1,0), colors.white), ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("FONTSIZE", (0,0), (-1,-1), 7), ("GRID", (0,0), (-1,-1), .25, colors.HexColor("#cdd7e1")), ("VALIGN", (0,0), (-1,-1), "MIDDLE"), ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5)]))
story += [recon, PageBreak()]

for index, day in enumerate(report["days"]):
    entries = day["entries"]
    locations = " / ".join(sorted({entry.get("location") for entry in entries if entry.get("location")})) or "Sem localização documental na janela"
    known = defaultdict(int)
    pending = 0
    for entry in entries:
        if entry["eligibility_status"] == "ELIGIBLE" and entry.get("currency") and entry.get("amount_minor_units") is not None:
            known[entry["currency"]] += entry["amount_minor_units"]
        if entry["eligibility_status"] == "UNKNOWN": pending += 1
    total = " · ".join(money(currency, value) for currency, value in known.items()) or "R$ 0,00"
    payment = "25/08/2026" if int(day["date"][-2:]) <= 15 else "10/09/2026"
    story += [Paragraph(f"{day['date'][8:10]}/{day['date'][5:7]}/2026 - {locations}", h2), Paragraph(f"Total conhecido: {total} | Pendências: {pending} | Pagamento previsto: {payment}", body)]
    rows = [["Item", "Status", "Atividade / horário / local", "Motivo", "Valor"]]
    ordered = sorted(entries, key=lambda item: (item["start_at"], item["entitlement_type"]))
    if not ordered:
        rows.append(["Sem entitlement persistido", "NÃO DEVIDO NÃO INFERIDO", "Nenhuma atividade registrada nesta exportação", "Ausência de linha não é conclusão", "-"])
    for entry in ordered:
        provenance = entry.get("provenance") or {}
        activity = str(provenance.get("timelineActivityKind") or "OFF").replace("_", " ")
        hotel = f"hotel usado={provenance.get('hotelUsed', 'UNKNOWN')}; dispensado={provenance.get('hotelWaived', 'UNKNOWN')}"
        reason = entry.get("reason") or "Sem reason code"
        rows.append([meal_labels.get(entry["entitlement_type"], entry["entitlement_type"]), status_labels.get(entry["eligibility_status"], entry["eligibility_status"]), f"{activity}; {entry['start_at']} - {entry['end_at']}; {entry.get('location') or 'UNKNOWN'}", f"{reason} - {reason_labels.get(reason, 'descrição não catalogada')}<br/>{hotel}", money(entry.get("currency"), entry.get("amount_minor_units"))])
    day_table = Table([[Paragraph(str(cell), small) for cell in row] for row in rows], colWidths=[2.2*cm, 2.1*cm, 5.0*cm, 5.0*cm, 2.2*cm], repeatRows=1)
    day_table.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), colors.HexColor("#e8eef5")), ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("GRID", (0,0), (-1,-1), .2, colors.HexColor("#cdd7e1")), ("VALIGN", (0,0), (-1,-1), "TOP"), ("TOPPADDING", (0,0), (-1,-1), 3), ("BOTTOMPADDING", (0,0), (-1,-1), 3)]))
    story += [day_table]
    technical = " | ".join(f"id={entry['id']}; subject={entry['subject_id']}; source={((entry.get('provenance') or {}).get('timelineActivityId') or 'none')}" for entry in ordered) or "Sem IDs de entitlement neste dia."
    story += [Paragraph(f"Técnico: {technical}", small), Spacer(1, 7)]
    if index and index % 3 == 0: story.append(PageBreak())

SimpleDocTemplate(str(output_path), pagesize=A4, rightMargin=1.4*cm, leftMargin=1.4*cm, topMargin=1.4*cm, bottomMargin=1.7*cm, title="atlas-diarias-auditoria-2026-08").build(story, onFirstPage=page_number, onLaterPages=page_number)
print(output_path)
