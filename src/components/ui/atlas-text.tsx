import { createElement, type ElementType, type HTMLAttributes, type ReactNode } from "react";

export type AtlasTextVariant =
  | "pageTitle"
  | "pageSubtitle"
  | "modalTitle"
  | "sectionTitle"
  | "cardTitle"
  | "itemTitle"
  | "body"
  | "bodyStrong"
  | "secondary"
  | "label"
  | "caption"
  | "financialValue"
  | "financialValueSmall"
  | "button"
  | "tableHeader"
  | "tableBody"
  | "formLabel"
  | "formHelp"
  | "error"
  | "badge";

const variantClasses: Record<AtlasTextVariant, string> = {
  pageTitle: "atlas-page-title",
  pageSubtitle: "atlas-page-subtitle",
  modalTitle: "atlas-modal-title",
  sectionTitle: "atlas-section-title",
  cardTitle: "atlas-card-title",
  itemTitle: "atlas-item-title",
  body: "atlas-body",
  bodyStrong: "atlas-body-strong",
  secondary: "atlas-secondary",
  label: "atlas-label",
  caption: "atlas-caption",
  financialValue: "atlas-financial-value",
  financialValueSmall: "atlas-financial-value-small",
  button: "atlas-button-label",
  tableHeader: "atlas-table-header",
  tableBody: "atlas-table-body",
  formLabel: "atlas-form-label",
  formHelp: "atlas-form-help",
  error: "atlas-error-text",
  badge: "atlas-badge-text",
};

const defaultElements: Record<AtlasTextVariant, ElementType> = {
  pageTitle: "h1",
  pageSubtitle: "p",
  modalTitle: "h2",
  sectionTitle: "h2",
  cardTitle: "h3",
  itemTitle: "b",
  body: "p",
  bodyStrong: "p",
  secondary: "p",
  label: "span",
  caption: "small",
  financialValue: "strong",
  financialValueSmall: "strong",
  button: "span",
  tableHeader: "span",
  tableBody: "span",
  formLabel: "span",
  formHelp: "small",
  error: "p",
  badge: "span",
};

export function AtlasText({
  as,
  variant = "body",
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  variant?: AtlasTextVariant;
  children: ReactNode;
}) {
  return createElement(
    as ?? defaultElements[variant],
    { ...props, className: `${variantClasses[variant]} ${className}`.trim() },
    children,
  );
}
