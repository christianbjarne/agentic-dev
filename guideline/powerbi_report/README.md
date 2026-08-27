# Power BI report guideline

Every Power BI report in this repository must follow the design and navigation
pattern demonstrated by the Opportunity Revenue reference template in
`opportunity-revenue-template/`.

The template is an inspectable, report-only extraction of
`Revenue Opportunities.pbix`. Embedded data, the semantic model, credentials,
and remote workspace identifiers are intentionally excluded.

## Required page architecture

1. **Overview** — the default 16:9 landing page. It must communicate the
   business position in one scan.
2. **Detail** — a drill-through or navigation target with a matrix/table and a
   visible back action.
3. **Tooltip** — a compact hidden page that adds context to at least one
   overview visual.

Additional analytical or narrative pages are allowed when they answer a
distinct question.

## Overview composition

Use the Opportunity Revenue layout as the minimum composition:

- A clear report title and short business-oriented subtitle.
- Two to four decision-driving KPI cards, including the primary value measure
  and a volume/count measure.
- No more than three visible slicers. Place them in a reserved filter band or
  right rail, never in the top-left headline position.
- A modern `azureMap` when geography is analytically relevant.
- A ranked comparison such as revenue by region/state.
- A lifecycle or stage visual such as pipeline by stage.
- A trend or value-versus-volume visual.
- A composition visual such as a treemap only when category share is useful.

Do not duplicate the same absolute measure in multiple cards or callouts.

## Layout and visual hierarchy

- Use a 16:9 canvas (`1280 x 720` or `1920 x 1080`).
- Reserve the upper band for the page title, filter context, and KPIs.
- Align visual edges to an 8-pixel grid with consistent gutters.
- Keep the overview to at most 12 analytical visuals.
- Put detailed matrices on the Detail page, not the Overview page.
- Use insight-oriented titles such as "Revenue by Region and State", not
  generic chart-type labels.
- Sort ranked visuals by the value measure descending.

## Interaction

- Overview visuals cross-filter predictably.
- Detail navigation must provide a back button.
- Report tooltips must add a comparison, distribution, or related KPI rather
  than repeat the hovered value.
- Reports with more than three visible pages need discoverable navigation.
- Filter state and slicer purpose must remain visible.

## Theme and color

The reference uses the **Classroom** identity:

- Primary blue: `#4A8DDC`
- Secondary slate: `#4C5D8A`
- Revenue/highlight yellow: `#F3C911`
- Risk red: `#DC5B57`
- Positive green: `#33AE81`
- Canvas: `#FFFFFF`
- Text: `#070F25`
- Font: Segoe UI

Use these colors consistently by semantic role. Color must never be the only
signal. Do not use more than eight active categorical colors.

## Modernization requirement

The historical reference contains a legacy `filledMap`. New or modified
reports must use `azureMap`; `map` and `filledMap` are prohibited. The
reference is authoritative for composition and interaction, not for deprecated
visual APIs.

## Accessibility and quality

- Every data visual needs a useful title and insight-oriented alt text.
- Text contrast must be at least 4.5:1; non-text marks at least 3:1.
- Tab order must follow title, filters, KPIs, analysis, navigation.
- Interactive targets must be at least 24 by 24 pixels.
- Avoid 3D visuals, gauges, decorative shadows, truncated bar axes, and dual
  y-axes.
- Use modern `cardVisual`, `tableEx`/`pivotTable`, and `azureMap` visual types.
- Validate PBIR with `powerbi-report-author validate <Report-folder>` before
  committing.

## Review evidence

Pull-request reviewers must:

1. Compare changed reports with this guideline and the reference template.
2. Apply the Power BI report design and authoring skills in `.github/skills/`.
3. Report automated findings using the `PBI###` identifiers emitted by
   `.github/scripts/validate_powerbi_reports.py`.
4. Request changes when required page architecture or prohibited visual types
   are present.

