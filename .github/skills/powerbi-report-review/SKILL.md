---
name: powerbi-report-review
description: Review Power BI PBIR/PBIP changes against the Opportunity Revenue report standard.
---

# Power BI report review

Use this skill whenever a pull request changes a `.Report` directory, `.pbip`
project, report theme, page, visual, filter, slicer, bookmark, or tooltip.

## Required context

Read:

1. `guideline/powerbi_report/README.md`
2. `guideline/powerbi_report/opportunity-revenue-template/README.md`
3. The relevant template page and visual definitions under
   `guideline/powerbi_report/opportunity-revenue-template/Report/`
4. Every changed PBIR file and its surrounding page/report metadata

Run:

```text
python .github/scripts/validate_powerbi_reports.py
powerbi-report-author validate <changed-report.Report>
```

## Review checklist

- Overview, Detail, and Tooltip page architecture matches the template.
- The overview is 16:9 and has a title, 2-4 KPI cards, restrained slicers,
  geographic context when relevant, ranked comparison, lifecycle/stage, and
  trend or value-volume analysis.
- Detail is on a separate page with a matrix/table and return navigation.
- Tooltip is compact, hidden, and adds context.
- `azureMap`, `cardVisual`, `tableEx`, and `pivotTable` are used instead of
  deprecated visual types.
- Visual titles state business meaning; rankings are sorted by value.
- Theme colors follow consistent semantic roles.
- Accessibility includes contrast, insight-driven alt text, meaningful tab
  order, and sufficiently large interaction targets.
- The PBIR validator has no errors. Warnings must be evaluated, not ignored.

## Decision

Use `PBI###` findings from the repository validator as mandatory violations.
Also report concrete manual-review issues with file evidence and the exact
guideline section. Request changes for missing required architecture,
deprecated visuals, invalid PBIR, inaccessible interactions, or misleading
encodings.

