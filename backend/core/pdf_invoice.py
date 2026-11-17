"""Server-side PDF invoice and receipt generation for RankLens subscription billing periods.
Uses ReportLab to generate clean, professional, print-ready invoices for agency subscriptions.
"""

import io

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def generate_invoice_pdf(billing_period, agency, user=None) -> bytes:
    """Generates an executive-ready PDF receipt/invoice for a given billing period."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )

    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        "InvoiceTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#0f172a"),
    )

    ParagraphStyle(
        "InvoiceH2",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#1e293b"),
    )

    body_style = ParagraphStyle(
        "InvoiceBody",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#334155"),
    )

    bold_style = ParagraphStyle(
        "InvoiceBold",
        parent=body_style,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#0f172a"),
    )

    muted_style = ParagraphStyle(
        "InvoiceMuted",
        parent=body_style,
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#64748b"),
    )

    right_style = ParagraphStyle(
        "InvoiceRight",
        parent=body_style,
        alignment=TA_RIGHT,
    )

    right_bold_style = ParagraphStyle(
        "InvoiceRightBold",
        parent=bold_style,
        alignment=TA_RIGHT,
    )

    story = []

    plan = billing_period.plan
    plan_name = plan.name if plan else "Growth"
    getattr(plan, "slug", "growth")
    monthly_price = getattr(plan, "monthly_price_usd", "149.00")
    runs_included = getattr(plan, "prompt_runs_included", 600)
    client_limit = getattr(plan, "client_limit", 25)

    invoice_number = f"INV-{billing_period.period_start.strftime('%Y%m')}-{str(agency.id)[:6].upper()}"
    invoice_date = billing_period.period_start.strftime("%B %d, %Y")
    period_str = f"{billing_period.period_start.strftime('%b %d, %Y')} — {billing_period.period_end.strftime('%b %d, %Y')}"

    # Header: RankLens Logo + INVOICE tag
    header_data = [
        [
            Paragraph("<b>RankLens</b> <font color='#6366f1'>AI VISIBILITY</font>", title_style),
            Paragraph(f"<font color='#6366f1'><b>INVOICE / RECEIPT</b></font><br/><font color='#64748b'>#{invoice_number}</font>", right_style),
        ]
    ]
    header_table = Table(header_data, colWidths=[270, 270])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 15))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#e2e8f0"), spaceAfter=15))

    # Billed To & Invoice Metadata
    agency_name = agency.name if agency else "Agency Client"
    user_email = user.email if user else (getattr(agency.users.first(), "email", "billing@agency.dev") if hasattr(agency, "users") and agency.users.exists() else "billing@agency.dev")

    info_data = [
        [
            Paragraph("<b>Billed To:</b>", bold_style),
            Paragraph("<b>Invoice Details:</b>", bold_style),
        ],
        [
            Paragraph(f"<b>{agency_name}</b><br/>{user_email}<br/>United States", body_style),
            Paragraph(
                f"<b>Invoice Date:</b> {invoice_date}<br/>"
                f"<b>Billing Period:</b> {period_str}<br/>"
                f"<b>Payment Status:</b> <font color='#16a34a'><b>Paid / Settled (Test Mode)</b></font><br/>"
                f"<b>Payment Method:</b> VISA •••• 4242",
                body_style,
            ),
        ],
    ]
    info_table = Table(info_data, colWidths=[270, 270])
    info_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 20))

    # Line Items Table
    items_header = [
        Paragraph("<b>Description</b>", bold_style),
        Paragraph("<b>Billing Cycle</b>", bold_style),
        Paragraph("<b>Credits / Workspaces</b>", bold_style),
        Paragraph("<b>Amount (USD)</b>", right_bold_style),
    ]

    item_row_1 = [
        Paragraph(f"<b>RankLens {plan_name} Tier Subscription</b><br/><font color='#64748b' size='7.5'>Multi-Engine AI Search Visibility, Sentiment Analysis &amp; Citations Tracking</font>", body_style),
        Paragraph("Monthly", body_style),
        Paragraph(f"{runs_included:,} Runs &bull; {client_limit} Workspaces", body_style),
        Paragraph(f"${monthly_price}", right_style),
    ]

    item_row_2 = [
        Paragraph("<b>Traceable Citations &amp; AI Evidence Vault</b><br/><font color='#64748b' size='7.5'>Perplexity, OpenAI, Claude, and Gemini verifiable trace audits</font>", body_style),
        Paragraph("Included", body_style),
        Paragraph("Unlimited Traces", body_style),
        Paragraph("$0.00", right_style),
    ]

    item_row_3 = [
        Paragraph("<b>PostgreSQL Row-Level Security &amp; Tenant Isolation</b><br/><font color='#64748b' size='7.5'>Strict agency data privacy, immutable audit history &amp; cold archive</font>", body_style),
        Paragraph("Included", body_style),
        Paragraph("Enterprise Safe", body_style),
        Paragraph("$0.00", right_style),
    ]

    table_data = [items_header, item_row_1, item_row_2, item_row_3]
    items_table = Table(table_data, colWidths=[240, 75, 135, 90])
    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
        ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#cbd5e1")),
        ("LINEBELOW", (0, 1), (-1, -1), 0.5, colors.HexColor("#f1f5f9")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 15))

    # Totals Summary Table
    totals_data = [
        ["", Paragraph("Subtotal:", body_style), Paragraph(f"${monthly_price}", right_style)],
        ["", Paragraph("Estimated Tax (0%):", body_style), Paragraph("$0.00", right_style)],
        ["", Paragraph("<b>Total Paid (USD):</b>", bold_style), Paragraph(f"<b><font color='#6366f1'>${monthly_price}</font></b>", right_bold_style)],
    ]
    totals_table = Table(totals_data, colWidths=[270, 160, 110])
    totals_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (1, 2), (-1, 2), 1, colors.HexColor("#e2e8f0")),
    ]))
    story.append(totals_table)
    story.append(Spacer(1, 25))

    # Guarantee & Notes Box
    guarantee_text = (
        "<b>Zero Data-Loss Guarantee:</b> All tracked client workspaces, prompt schedules, competitors, "
        "and historical visibility audits remain permanently stored and protected under strict multi-tenant "
        "encryption even during subscription pauses. Automated renewals occur on the 1st of each billing month."
    )
    notice_table = Table(
        [[Paragraph(guarantee_text, muted_style)]],
        colWidths=[540],
    )
    notice_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(notice_table)

    story.append(Spacer(1, 20))
    story.append(Paragraph("<font color='#94a3b8' size='7.5'>Thank you for choosing RankLens AI Visibility. For billing questions or invoice adjustments, contact billing@avtr.dev.</font>", right_style))

    doc.build(story)
    return buffer.getvalue()
