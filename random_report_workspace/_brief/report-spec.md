# Report Spec

## Report identity

- Report name: Random Revenue Pulse
- Semantic model: NYC Taxi model
- Audience: Sales and revenue leadership
- Primary purpose: Monitor revenue, volume, geographic mix, and performance drivers
- Delivery target: Git-synchronized Fabric report artifact

## User decisions and constraints

- Scope: New report in a separate workspace folder and branch
- Page count: Six inherited analytical pages
- Design direction: Opportunity Revenue reference architecture
- Publishing: Git synchronization only
- Accessibility: Repository Power BI guideline baseline

## Narrative

The report opens with the current revenue position, provides focused analyses
of tipping, patterns, and model signals, and separates row-level detail and
tooltip context from the executive landing page.

## Canonical design contract

```yaml
Design Brief:
  generated_by: powerbi-report-design
  contract_version: 1
  mode: brownfield
  design_identity:
    tone: Classroom analytical
    signature: Opportunity overview with KPI band and linked analytical detail
  decision: Clone the validated Taxi Revenue PBIR structure, retain its 1280 x 720 canvas and semantic bindings, and rename the report without changing visual mechanics.
```

## Implementation notes

- PBIR/report authoring: Clone validated report files and assign a unique report identity.
- Validation: Run both the repository Power BI validator and `powerbi-report-author validate`.
- Publishing boundary: Leave the pull request open against `dev` for human review.

