const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const REPORT = path.join(ROOT, 'Taxi Revenue.Report');
const DEF = path.join(REPORT, 'definition');
const PAGES = path.join(DEF, 'pages');

const VC = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/1.4.0/schema.json";
const PAGE_SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/1.0.0/schema.json";
const PAGESMETA = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json";

// ---- field reference helpers ----
function measure(entity, prop) {
  return { field: { Measure: { Expression: { SourceRef: { Entity: entity } }, Property: prop } }, queryRef: `${entity}.${prop}`, nativeQueryRef: prop };
}
function column(entity, prop) {
  return { field: { Column: { Expression: { SourceRef: { Entity: entity } }, Property: prop } }, queryRef: `${entity}.${prop}`, nativeQueryRef: prop };
}
const lit = v => ({ expr: { Literal: { Value: v } } });
const str = s => lit(`'${s}'`);

function titleObj(text) {
  return { title: [{ properties: { show: lit('true'), text: str(text), heading: str('Heading3') } }] };
}

// brand colors
const YELLOW = '#F3C911', NAVY = '#4C5D8A', BLUE = '#4A8DDC', RED = '#DC5B57', GREEN = '#33AE81';

// single-series solid color (no selector)
function dpDefault(hex) {
  return { dataPoint: [{ properties: { defaultColor: { solid: { color: str(hex) } } } }] };
}
// per-measure fills via metadata selector
function dpByMeasure(map) {
  return { dataPoint: Object.entries(map).map(([qr, hex]) => ({
    properties: { fill: { solid: { color: str(hex) } } },
    selector: { metadata: qr }
  })) };
}

function visual({ name, x, y, z, w, h, type, roles, vco, objects }) {
  const v = { visualType: type };
  if (roles) {
    v.query = { queryState: {} };
    for (const [role, projs] of Object.entries(roles)) {
      v.query.queryState[role] = { projections: projs };
    }
  }
  if (objects) v.objects = objects;
  if (vco) v.visualContainerObjects = vco;
  v.drillFilterOtherVisuals = true;
  return {
    "$schema": VC,
    name,
    position: { x, y, z, width: w, height: h },
    visual: v
  };
}

function writeVisual(pageId, vis) {
  const dir = path.join(PAGES, pageId, 'visuals', vis.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'visual.json'), JSON.stringify(vis, null, 2));
}

function writePage(pageId, displayName, w, h, visuals, extra = {}) {
  const dir = path.join(PAGES, pageId);
  fs.mkdirSync(dir, { recursive: true });
  const page = { "$schema": PAGE_SCHEMA, name: pageId, displayName, displayOption: "FitToPage", height: h, width: w, ...extra };
  fs.writeFileSync(path.join(dir, 'page.json'), JSON.stringify(page, null, 2));
  for (const v of visuals) writeVisual(pageId, v);
}

// reset pages dir
fs.rmSync(PAGES, { recursive: true, force: true });
fs.mkdirSync(PAGES, { recursive: true });

const REV = () => measure('fact_trips', 'Total Revenue');
const TRIPS = () => measure('fact_trips', 'Total Trips');
const AVG = () => measure('fact_trips', 'Avg Fare');
const TIPS = () => measure('fact_trips', 'Total Tips');
const PASS = () => measure('fact_trips', 'Total Passengers');

// ML (zone segmentation) table shortcuts
const MLZONES = () => measure('ml_zone_clusters', 'ML Zone Count');
const MLREV = () => measure('ml_zone_clusters', 'ML Segment Revenue');
const MLTRIPS = () => measure('ml_zone_clusters', 'ML Segment Trips');
const MLTIP = () => measure('ml_zone_clusters', 'ML Avg Tip %');
const mlCol = p => column('ml_zone_clusters', p);

// reusable page chrome
function accentBar(name) {
  return visual({ name, x: 0, y: 0, z: 0, w: 1280, h: 6, type: 'shape',
    objects: {
      shape: [{ properties: { tileShape: str('rectangle') } }],
      fill: [{ properties: { fillColor: { solid: { color: str('#0B6E4F') } }, transparency: lit('0D') }, selector: { id: 'default' } }],
      outline: [{ properties: { show: lit('false') }, selector: { id: 'default' } }]
    },
    vco: { background: [{ properties: { show: lit('false') } }], border: [{ properties: { show: lit('false') } }],
      padding: [{ properties: { top: lit('0D'), bottom: lit('0D'), left: lit('0D'), right: lit('0D') } }] }
  });
}
function pageTitle(name, x, text) {
  return visual({ name, x, y: 12, z: 2000, w: 1100, h: 64, type: 'textbox',
    objects: { general: [{ properties: { paragraphs: [{ textRuns: [{ value: text, textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '30px', color: '#11203F' } }], horizontalTextAlignment: 'left' }] } }] },
    vco: { background: [{ properties: { show: lit('false') } }], border: [{ properties: { show: lit('false') } }] }
  });
}
function pageSubtitle(name, x, text) {
  return visual({ name, x, y: 76, z: 2000, w: 1100, h: 40, type: 'textbox',
    objects: { general: [{ properties: { paragraphs: [{ textRuns: [{ value: text, textStyle: { fontFamily: 'Segoe UI', fontSize: '17px', color: '#5A5A6E' } }], horizontalTextAlignment: 'left' }] } }] },
    vco: { background: [{ properties: { show: lit('false') } }], border: [{ properties: { show: lit('false') } }] }
  });
}
function kpi(name, x, w, m, accent, title) {
  return visual({ name, x, y: 98, z: 100, w, h: 108, type: 'cardVisual',
    roles: { Data: [m] }, objects: cardObjects(accent), vco: titleObj(title) });
}

// ===================== PAGE 1: Overview =====================
const p1 = [];
// top accent bar
p1.push(visual({ name: 'accentbar', x: 0, y: 0, z: 0, w: 1280, h: 6, type: 'shape',
  objects: {
    shape: [{ properties: { tileShape: str('rectangle') } }],
    fill: [{ properties: { fillColor: { solid: { color: str('#0B6E4F') } }, transparency: lit('0D') }, selector: { id: 'default' } }],
    outline: [{ properties: { show: lit('false') }, selector: { id: 'default' } }]
  },
  vco: {
    background: [{ properties: { show: lit('false') } }],
    border: [{ properties: { show: lit('false') } }],
    padding: [{ properties: { top: lit('0D'), bottom: lit('0D'), left: lit('0D'), right: lit('0D') } }]
  }
}));
// title textbox
p1.push(visual({ name: 'title1', x: 48, y: 12, z: 1000, w: 700, h: 58, type: 'textbox',
  objects: { general: [{ properties: { paragraphs: [{ textRuns: [{ value: 'NYC Taxi — Revenue Overview', textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '30px', color: '#11203F' } }], horizontalTextAlignment: 'left' }] } }] },
  vco: { background: [{ properties: { show: lit('false') } }], border: [{ properties: { show: lit('false') } }] }
}));
// subtitle
p1.push(visual({ name: 'subtitle1', x: 48, y: 76, z: 1000, w: 1100, h: 40, type: 'textbox',
  objects: { general: [{ properties: { paragraphs: [{ textRuns: [{ value: 'Revenue, trips & operational performance by zone, rate type and payment', textStyle: { fontFamily: 'Segoe UI', fontSize: '17px', color: '#5A5A6E' } }], horizontalTextAlignment: 'left' }] } }] },
  vco: { background: [{ properties: { show: lit('false') } }], border: [{ properties: { show: lit('false') } }] }
}));
// slicer (payment type)
p1.push(visual({ name: 'slicer1', x: 1034, y: 16, z: 6000, w: 206, h: 72, type: 'slicer',
  roles: { Values: [column('dim_payment', 'payment_name')] },
  vco: titleObj('Payment Type') }));
// KPI cards
function cardObjects(accent) {
  return {
    accentBar: [{ properties: { show: lit('true'), color: { solid: { color: str(accent) } } } }],
    value: [{ properties: {
      fontSize: lit('30D'),
      bold: lit('true'),
      labelDisplayUnits: lit("'-1'"),
      labelPrecision: lit('1L'),
      horizontalAlignment: str('center')
    }, selector: { id: 'default' } }]
  };
}
p1.push(visual({ name: 'cardRev', x: 48, y: 98, z: 100, w: 232, h: 108, type: 'cardVisual',
  roles: { Data: [REV()] },
  objects: cardObjects(YELLOW),
  vco: titleObj('Total Revenue') }));
p1.push(visual({ name: 'cardTrips', x: 288, y: 98, z: 100, w: 232, h: 108, type: 'cardVisual',
  roles: { Data: [TRIPS()] },
  objects: cardObjects(NAVY),
  vco: titleObj('Total Trips') }));
// combo chart revenue vs trips by month
p1.push(visual({ name: 'combo1', x: 535, y: 96, z: 9000, w: 694, h: 238, type: 'lineStackedColumnComboChart',
  roles: { Category: [column('dim_date', 'month_name')], Y: [REV()], Y2: [TRIPS()] },
  objects: dpByMeasure({ 'fact_trips.Total Revenue': YELLOW, 'fact_trips.Total Trips': NAVY }),
  vco: titleObj('Monthly Revenue & Trips') }));
// treemap trips by borough/zone
p1.push(visual({ name: 'treemap1', x: 48, y: 216, z: 7000, w: 456, h: 176, type: 'treemap',
  roles: { Group: [column('dim_zone', 'borough')], Details: [column('dim_zone', 'zone')], Values: [TRIPS()] },
  vco: titleObj('Trips by Borough & Zone') }));
// bar chart trips by rate code
p1.push(visual({ name: 'barRate', x: 48, y: 400, z: 10000, w: 456, h: 288, type: 'barChart',
  roles: { Category: [column('dim_ratecode', 'ratecode_name')], Y: [TRIPS()] },
  objects: dpDefault(BLUE),
  vco: titleObj('Trips by Rate Type') }));
// column chart revenue by borough
p1.push(visual({ name: 'colBorough', x: 560, y: 376, z: 12000, w: 280, h: 296, type: 'clusteredColumnChart',
  roles: { Category: [column('dim_zone', 'borough')], Y: [REV()] },
  objects: dpDefault(YELLOW),
  vco: titleObj('Revenue by Borough') }));
// azure map revenue by borough
p1.push(visual({ name: 'map1', x: 856, y: 376, z: 8000, w: 372, h: 296, type: 'azureMap',
  roles: { Category: [column('dim_zone', 'borough')], Size: [REV()], Tooltips: [TRIPS()] },
  vco: titleObj('Revenue Heatmap by Borough') }));

writePage('overview', 'Overview', 1280, 720, p1);

// ===================== PAGE: Tipping & Payment Insights =====================
const pt = [];
pt.push(accentBar('tip_accent'));
pt.push(pageTitle('tip_title', 48, 'Tipping & Payment Insights'));
pt.push(pageSubtitle('tip_sub', 48, 'How customers pay and tip across payment types, rate types, zones and time'));
pt.push(kpi('tip_kpi1', 48, 232, TIPS(), YELLOW, 'Total Tips'));
pt.push(kpi('tip_kpi2', 288, 232, AVG(), NAVY, 'Avg Fare'));
pt.push(kpi('tip_kpi3', 528, 232, PASS(), BLUE, 'Total Passengers'));
pt.push(visual({ name: 'tip_line', x: 784, y: 98, z: 50, w: 448, h: 238, type: 'lineChart',
  roles: { Category: [column('dim_date', 'month_name')], Y: [TIPS()] },
  objects: dpDefault(YELLOW), vco: titleObj('Tips Trend by Month') }));
pt.push(visual({ name: 'tip_bar', x: 48, y: 224, z: 50, w: 384, h: 230, type: 'barChart',
  roles: { Category: [column('dim_payment', 'payment_name')], Y: [TIPS()] },
  objects: dpDefault(YELLOW), vco: titleObj('Tips by Payment Type') }));
pt.push(visual({ name: 'tip_col', x: 448, y: 224, z: 50, w: 384, h: 230, type: 'clusteredColumnChart',
  roles: { Category: [column('dim_zone', 'borough')], Y: [AVG()] },
  objects: dpDefault(NAVY), vco: titleObj('Avg Fare by Borough') }));
pt.push(visual({ name: 'tip_donut', x: 848, y: 224, z: 50, w: 384, h: 230, type: 'donutChart',
  roles: { Category: [column('dim_ratecode', 'ratecode_name')], Y: [TIPS()] },
  vco: titleObj('Tips by Rate Type') }));
pt.push(visual({ name: 'tip_table', x: 48, y: 466, z: 50, w: 560, h: 222, type: 'tableEx',
  roles: { Values: [column('dim_vendor', 'vendor_name'), TRIPS(), TIPS(), AVG()] },
  objects: { columnHeaders: [{ properties: { autoSizeColumnWidth: lit('true'), columnAdjustment: str('growToFit') } }] },
  vco: titleObj('Vendor Performance') }));
pt.push(visual({ name: 'tip_passcol', x: 624, y: 466, z: 50, w: 608, h: 222, type: 'clusteredColumnChart',
  roles: { Category: [column('dim_payment', 'payment_name')], Y: [PASS()] },
  objects: dpDefault(GREEN), vco: titleObj('Passengers by Payment Type') }));
writePage('tipping', 'Tipping & Payments', 1280, 720, pt);

// ===================== PAGE: Trip Patterns & Zone Demand =====================
const pp = [];
pp.push(accentBar('pat_accent'));
pp.push(pageTitle('pat_title', 48, 'Trip Patterns & Zone Demand'));
pp.push(pageSubtitle('pat_sub', 48, 'When and where trips happen — by day, week, borough and service type'));
pp.push(kpi('pat_kpi1', 48, 232, TRIPS(), BLUE, 'Total Trips'));
pp.push(kpi('pat_kpi2', 288, 232, REV(), YELLOW, 'Total Revenue'));
pp.push(kpi('pat_kpi3', 528, 232, AVG(), NAVY, 'Avg Fare'));
pp.push(visual({ name: 'pat_day', x: 784, y: 98, z: 50, w: 448, h: 238, type: 'clusteredColumnChart',
  roles: { Category: [column('dim_date', 'day_name')], Y: [TRIPS()] },
  objects: dpDefault(BLUE), vco: titleObj('Trips by Day of Week') }));
pp.push(visual({ name: 'pat_week', x: 48, y: 224, z: 50, w: 560, h: 230, type: 'lineChart',
  roles: { Category: [column('dim_date', 'week')], Y: [REV()] },
  objects: dpDefault(YELLOW), vco: titleObj('Revenue by Week') }));
pp.push(visual({ name: 'pat_service', x: 624, y: 224, z: 50, w: 300, h: 230, type: 'donutChart',
  roles: { Category: [column('fact_trips', 'service_type')], Y: [TRIPS()] },
  vco: titleObj('Trips by Service Type') }));
pp.push(visual({ name: 'pat_borough', x: 936, y: 224, z: 50, w: 296, h: 230, type: 'barChart',
  roles: { Category: [column('dim_zone', 'borough')], Y: [REV()] },
  objects: dpDefault(YELLOW), vco: titleObj('Revenue by Borough') }));
pp.push(visual({ name: 'pat_map', x: 48, y: 466, z: 50, w: 560, h: 222, type: 'azureMap',
  roles: { Category: [column('dim_zone', 'borough')], Size: [TRIPS()], Tooltips: [REV()] },
  vco: titleObj('Trip Density by Borough') }));
pp.push(visual({ name: 'pat_matrix', x: 624, y: 466, z: 50, w: 608, h: 222, type: 'pivotTable',
  roles: { Rows: [column('dim_zone', 'borough'), column('dim_zone', 'service_zone')], Values: [TRIPS(), REV()] },
  objects: { columnHeaders: [{ properties: { autoSizeColumnWidth: lit('true'), columnAdjustment: str('growToFit') } }] } }));
writePage('patterns', 'Trip Patterns', 1280, 720, pp);

// ===================== PAGE: ML Insights (Zone Segmentation) =====================
const pm = [];
pm.push(accentBar('ml_accent'));
pm.push(pageTitle('ml_title', 48, 'Zone Segmentation — Machine Learning'));
pm.push(pageSubtitle('ml_sub', 48, 'KMeans clustering groups pickup zones into revenue & demand tiers from trips, fares, distance and tipping'));
pm.push(kpi('ml_kpi1', 48, 232, MLZONES(), BLUE, 'Segmented Zones'));
pm.push(kpi('ml_kpi2', 288, 232, MLREV(), YELLOW, 'Segment Revenue'));
pm.push(kpi('ml_kpi3', 528, 232, MLTIP(), GREEN, 'Avg Tip %'));
pm.push(visual({ name: 'ml_revseg', x: 784, y: 98, z: 50, w: 448, h: 238, type: 'clusteredColumnChart',
  roles: { Category: [mlCol('cluster_label')], Y: [MLREV()] },
  objects: dpDefault(YELLOW), vco: titleObj('Revenue by Segment') }));
pm.push(visual({ name: 'ml_zonebar', x: 48, y: 224, z: 50, w: 360, h: 230, type: 'barChart',
  roles: { Category: [mlCol('cluster_label')], Y: [MLZONES()] },
  objects: dpDefault(BLUE), vco: titleObj('Zones per Segment') }));
pm.push(visual({ name: 'ml_tripsdonut', x: 424, y: 224, z: 50, w: 360, h: 230, type: 'donutChart',
  roles: { Category: [mlCol('cluster_label')], Y: [MLTRIPS()] },
  vco: titleObj('Trips Share by Segment') }));
pm.push(visual({ name: 'ml_scatter', x: 800, y: 350, z: 50, w: 432, h: 338, type: 'scatterChart',
  roles: { Category: [mlCol('zone')], Series: [mlCol('cluster_label')],
           X: [mlCol('avg_fare')], Y: [mlCol('avg_tip_pct')], Size: [MLREV()] },
  vco: titleObj('Segment Map: Avg Fare vs Tip % (bubble = revenue)') }));
pm.push(visual({ name: 'ml_table', x: 48, y: 466, z: 50, w: 736, h: 222, type: 'pivotTable',
  roles: { Rows: [mlCol('cluster_label'), mlCol('borough')], Values: [MLZONES(), MLREV(), MLTRIPS(), MLTIP()] },
  objects: { columnHeaders: [{ properties: { autoSizeColumnWidth: lit('true'), columnAdjustment: str('growToFit') } }] },
  vco: titleObj('Segment Breakdown by Borough') }));
writePage('ml', 'ML Insights', 1280, 720, pm);

// ===================== PAGE 2: Detail =====================
const p2 = [];
p2.push(visual({ name: 'accentbar2', x: 0, y: 0, z: 0, w: 1280, h: 6, type: 'shape',
  objects: {
    shape: [{ properties: { tileShape: str('rectangle') } }],
    fill: [{ properties: { fillColor: { solid: { color: str('#0B6E4F') } }, transparency: lit('0D') }, selector: { id: 'default' } }],
    outline: [{ properties: { show: lit('false') }, selector: { id: 'default' } }]
  },
  vco: { background: [{ properties: { show: lit('false') } }], border: [{ properties: { show: lit('false') } }],
    padding: [{ properties: { top: lit('0D'), bottom: lit('0D'), left: lit('0D'), right: lit('0D') } }] }
}));
p2.push(visual({ name: 'title2', x: 63, y: 12, z: 2000, w: 600, h: 58, type: 'textbox',
  objects: { general: [{ properties: { paragraphs: [{ textRuns: [{ value: 'Taxi Operations Detail', textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '30px', color: '#11203F' } }], horizontalTextAlignment: 'left' }] } }] },
  vco: { background: [{ properties: { show: lit('false') } }], border: [{ properties: { show: lit('false') } }] }
}));
p2.push(visual({ name: 'matrix1', x: 63, y: 87, z: 0, w: 1155, h: 595, type: 'pivotTable',
  roles: {
    Rows: [column('dim_vendor', 'vendor_name'), column('dim_zone', 'borough'), column('dim_zone', 'service_zone')],
    Values: [TRIPS(), TIPS(), AVG(), REV()]
  },
  objects: {
    columnHeaders: [{ properties: { autoSizeColumnWidth: lit('true'), columnAdjustment: str('growToFit') } }]
  }
}));
writePage('detail', 'Detail', 1280, 720, p2);

// ===================== PAGE 3: Tooltip =====================
const p3 = [];
p3.push(visual({ name: 'donut1', x: 0, y: 0, z: 0, w: 320, h: 240, type: 'donutChart',
  roles: { Category: [column('dim_payment', 'payment_name')], Y: [REV()] },
  vco: titleObj('Revenue by Payment Type') }));
p3.push(visual({ name: 'cardTip', x: 56, y: 104, z: 1000, w: 208, h: 48, type: 'cardVisual',
  roles: { Data: [REV()] } }));
writePage('tooltip', 'Tooltip', 320, 240, p3, { displayOption: 'FitToPage', visibility: 'HiddenInViewMode' });

// ===================== pages.json =====================
fs.writeFileSync(path.join(PAGES, 'pages.json'), JSON.stringify({
  "$schema": PAGESMETA,
  pageOrder: ['overview', 'tipping', 'patterns', 'ml', 'detail', 'tooltip'],
  activePageName: 'overview'
}, null, 2));

// ===================== Custom Theme =====================
const THEME_NAME = 'TaxiRevenue-a1b2c3d4.json';
const theme = {
  name: THEME_NAME,
  dataColors: [YELLOW, NAVY, BLUE, GREEN, RED, '#95C8F0', '#DD915F', '#9A64A0', '#6EA4E3', '#707DA1'],
  background: '#FFFFFF',
  foreground: '#1A1A2E',
  tableAccent: NAVY,
  textClasses: {
    title: { fontFace: "'Segoe UI Semibold'", color: '#1A1A2E' },
    callout: { fontFace: "'Segoe UI'", color: '#1A1A2E' }
  },
  visualStyles: {
    '*': {
      '*': {
        title: [{ show: true, fontFamily: "'Segoe UI Semibold'", fontSize: 12, bold: true, fontColor: { solid: { color: '#1A1A2E' } } }],
        background: [{ show: true, color: { solid: { color: '#FFFFFF' } }, transparency: 0 }],
        border: [{ show: true, color: { solid: { color: '#E3E3EC' } }, radius: 8, width: 1 }],
        dropShadow: [{ show: true, color: { solid: { color: '#21232C' } }, position: 'Outer', preset: 'BottomRight' }]
      }
    },
    page: {
      '*': {
        background: [{ color: { solid: { color: '#EFF1F5' } }, transparency: 0 }],
        outspace: [{ color: { solid: { color: '#EFF1F5' } }, transparency: 0 }]
      }
    }
  }
};
const RES = path.join(REPORT, 'StaticResources', 'RegisteredResources');
fs.mkdirSync(RES, { recursive: true });
fs.writeFileSync(path.join(RES, THEME_NAME), JSON.stringify(theme, null, 2));

// report.json with base + custom theme registration
const reportJson = {
  "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/1.0.0/schema.json",
  layoutOptimization: "None",
  themeCollection: {
    baseTheme: { name: "CY24SU10", reportVersionAtImport: "5.55", type: "SharedResources" },
    customTheme: { name: THEME_NAME, reportVersionAtImport: "5.55", type: "RegisteredResources" }
  },
  resourcePackages: [
    { name: "RegisteredResources", type: "RegisteredResources", items: [ { name: THEME_NAME, path: THEME_NAME, type: "CustomTheme" } ] }
  ]
};
fs.writeFileSync(path.join(DEF, 'report.json'), JSON.stringify(reportJson, null, 2));

console.log('Generated PBIR pages: overview, detail, tooltip');
