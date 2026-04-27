// Elgeyo Marakwet Landslides Dashboard - GEE Script
/******************************************************************************
 *  ELGEYO MARAKWET LANDSLIDE DASHBOARD — Version 5 (final)
 *
 *  Pre-configured with your uploaded assets:
 *    projects/elegant-shelter-461411-v2/assets/elgeyo_county
 *    projects/elegant-shelter-461411-v2/assets/elgeyo_subcounties
 *    projects/elegant-shelter-461411-v2/assets/elgeyo_wards
 *
 *  Three-tier boundary fallback: your assets > GAUL > hard-coded bbox.
 *****************************************************************************/

// ============================================================================
//   CONFIG — your uploaded assets
// ============================================================================

var USER_ASSET_COUNTY      = 'projects/elegant-shelter-461411-v2/assets/elgeyo_county';
var USER_ASSET_SUBCOUNTIES = 'projects/elegant-shelter-461411-v2/assets/elgeyo_subcounties';
var USER_ASSET_WARDS       = 'projects/elegant-shelter-461411-v2/assets/elgeyo_wards';

// Detect both legacy 'users/...' and modern 'projects/.../assets/...' formats
function looksConfigured(path) {
  if (!path) return false;
  if (path.indexOf('YOUR_USERNAME') >= 0) return false;
  if (path.indexOf('YOUR_PROJECT')  >= 0) return false;
  return (path.indexOf('users/') === 0 || path.indexOf('projects/') === 0);
}

// ============================================================================
// 1. BULLETPROOF BOUNDARY LOADING (3-tier fallback)
// ============================================================================

var FALLBACK_BBOX = ee.Geometry.Rectangle([35.30, 0.30, 35.95, 1.65]);

function loadFromGAUL_level1() {
  var l1 = ee.FeatureCollection('FAO/GAUL/2015/level1');
  var attempts = [
    l1.filter(ee.Filter.eq('ADM1_NAME', 'Elgeyo-Marakwet')),
    l1.filter(ee.Filter.eq('ADM1_NAME', 'Elgeyo Marakwet')),
    l1.filter(ee.Filter.eq('ADM1_NAME', 'Keiyo-Marakwet')),
    l1.filter(ee.Filter.eq('ADM1_NAME', 'Keiyo Marakwet')),
    l1.filter(ee.Filter.eq('ADM0_NAME', 'Kenya'))
      .filter(ee.Filter.stringContains('ADM1_NAME', 'arakwet'))
  ];
  return ee.FeatureCollection(ee.Algorithms.If(
    attempts[0].size().gt(0), attempts[0],
    ee.Algorithms.If(attempts[1].size().gt(0), attempts[1],
    ee.Algorithms.If(attempts[2].size().gt(0), attempts[2],
    ee.Algorithms.If(attempts[3].size().gt(0), attempts[3],
                     attempts[4])))
  ));
}

function loadFromGAUL_level2() {
  var l2 = ee.FeatureCollection('FAO/GAUL/2015/level2');
  var attempts = [
    l2.filter(ee.Filter.eq('ADM1_NAME', 'Elgeyo-Marakwet')),
    l2.filter(ee.Filter.eq('ADM1_NAME', 'Elgeyo Marakwet')),
    l2.filter(ee.Filter.eq('ADM1_NAME', 'Keiyo-Marakwet')),
    l2.filter(ee.Filter.eq('ADM1_NAME', 'Keiyo Marakwet')),
    l2.filter(ee.Filter.eq('ADM0_NAME', 'Kenya'))
      .filter(ee.Filter.stringContains('ADM1_NAME', 'arakwet'))
  ];
  return ee.FeatureCollection(ee.Algorithms.If(
    attempts[0].size().gt(0), attempts[0],
    ee.Algorithms.If(attempts[1].size().gt(0), attempts[1],
    ee.Algorithms.If(attempts[2].size().gt(0), attempts[2],
    ee.Algorithms.If(attempts[3].size().gt(0), attempts[3],
                     attempts[4])))
  ));
}

function tryLoadAsset(path, gaulFallback) {
  if (!looksConfigured(path)) {
    return gaulFallback;
  }
  var asset = ee.FeatureCollection(path);
  return ee.FeatureCollection(ee.Algorithms.If(
    asset.size().gt(0), asset, gaulFallback
  ));
}

var gaulCounty       = loadFromGAUL_level1();
var gaulSubCounties  = loadFromGAUL_level2();

var elgeyoCounty      = tryLoadAsset(USER_ASSET_COUNTY,      gaulCounty);
var elgeyoSubCounties = tryLoadAsset(USER_ASSET_SUBCOUNTIES, gaulSubCounties);
var elgeyoWards       = tryLoadAsset(USER_ASSET_WARDS, elgeyoSubCounties);

var countyGeom = ee.Geometry(ee.Algorithms.If(
  elgeyoCounty.size().gt(0),
  elgeyoCounty.geometry(),
  FALLBACK_BBOX
));
var studyArea = countyGeom;

// ============================================================================
// 2. STARTUP DIAGNOSTICS
// ============================================================================

print('=== STARTUP DIAGNOSTICS ===');
print('USER_ASSET_COUNTY:',      USER_ASSET_COUNTY);
print('Configured to use uploaded asset?', looksConfigured(USER_ASSET_COUNTY));
print('elgeyoCounty features:',     elgeyoCounty.size());
print('elgeyoSubCounties features:', elgeyoSubCounties.size());
print('elgeyoWards features:',       elgeyoWards.size());

// ============================================================================
// 3. EVENT METADATA
// ============================================================================

var eventDate = ee.Date('2025-10-31');

var affectedSites = ee.FeatureCollection([
  ee.Feature(ee.Geometry.Point([35.64426, 1.12864]),
             {name: 'Chesongoch (Murkutwa)',  deaths: 26, missing: 25}),
  ee.Feature(ee.Geometry.Point([35.660, 1.115]),
             {name: 'Kamoko village',          deaths: 8,  missing: 0}),
  ee.Feature(ee.Geometry.Point([35.670, 1.105]),
             {name: 'Moror village',           deaths: 5,  missing: 0}),
  ee.Feature(ee.Geometry.Point([35.650, 1.135]),
             {name: 'Endo Ward',               deaths: 19, missing: 0}),
  ee.Feature(ee.Geometry.Point([35.630, 1.165]),
             {name: 'Sambirir Ward',           deaths: 4,  missing: 0}),
  ee.Feature(ee.Geometry.Point([35.610, 1.200]),
             {name: 'Embobut Ward',            deaths: 3,  missing: 0}),
  ee.Feature(ee.Geometry.Point([35.54115, 0.76202]),
             {name: 'Kipkenda Village',        deaths: 2,  missing: 0})
]);

// ============================================================================
// 4. SAFE WRAPPERS FOR SENTINEL-2
// ============================================================================

function maskS2(img) {
  var qa = img.select('QA60');
  var mask = qa.bitwiseAnd(1 << 10).eq(0)
              .and(qa.bitwiseAnd(1 << 11).eq(0));
  return img.updateMask(mask).divide(10000)
            .copyProperties(img, ['system:time_start']);
}

function safeS2Composite(startDate, endDate, cloudPct) {
  var col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(studyArea)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloudPct))
    .map(maskS2);
  return ee.Image(ee.Algorithms.If(
    col.size().gt(0),
    col.median().clip(studyArea),
    ee.Image.constant([0, 0, 0, 0])
      .rename(['B2', 'B3', 'B4', 'B8'])
      .clip(studyArea)
  ));
}

function safeNDVI(startDate, endDate, cloudPct, bandName) {
  var col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(studyArea)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloudPct))
    .map(maskS2)
    .map(function(img) {
      return img.normalizedDifference(['B8', 'B4']).rename(bandName);
    });
  return ee.Image(ee.Algorithms.If(
    col.size().gt(0),
    col.median().rename(bandName).clip(studyArea),
    ee.Image.constant(0.4).rename(bandName).clip(studyArea)
  ));
}

// ============================================================================
// 5. INPUT LAYERS
// ============================================================================

var srtm   = ee.Image('USGS/SRTMGL1_003');
var slope  = ee.Terrain.slope(srtm).rename('slope');
var elev   = srtm.rename('elev');
var curvature = elev.convolve(ee.Kernel.laplacian8()).rename('curvature');

var rainsClimatology = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterDate('1991-10-01', '2020-12-31')
  .filter(ee.Filter.calendarRange(10, 12, 'month'))
  .sum().divide(30).rename('OND_avg_mm');

var rainfall7day = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterDate(eventDate.advance(-7, 'day'), eventDate.advance(1, 'day'))
  .sum().rename('rain_7day');

var ndviCurrent = safeNDVI('2024-01-01', '2025-10-30', 60, 'NDVI');

var landCover = ee.ImageCollection('ESA/WorldCover/v200').first();

var smCol = ee.ImageCollection('NASA/SMAP/SPL4SMGP/008')
  .filterDate('2025-09-01', '2025-10-30')
  .select('sm_surface');

var soilMoisture = ee.Image(ee.Algorithms.If(
  smCol.size().gt(0),
  smCol.mean().rename('soil_moisture'),
  ee.Image.constant(0.3).rename('soil_moisture')
));

// ============================================================================
// 6. PREDICTIVE LANDSLIDE SUSCEPTIBILITY MODEL
// ============================================================================

var slopeScore = slope.subtract(15).divide(30).clamp(0, 1).rename('slope_s');
var curvScore  = curvature.multiply(-1).unitScale(-50, 50)
                  .clamp(0, 1).rename('curv_s');
var rainScore  = rainsClimatology.unitScale(150, 400)
                  .clamp(0, 1).rename('rain_s');
var vegScore   = ee.Image(1).subtract(ndviCurrent.unitScale(0, 0.8))
                  .clamp(0, 1).rename('veg_s');

var lcScore = landCover.remap(
  [10,  20,  30,  40,  50,  60,  80,  90,  95,  100],
  [0.2, 0.5, 0.6, 0.8, 0.7, 0.9, 0.0, 0.3, 0.0, 0.4]
).rename('lc_s');

var smScore = soilMoisture.unitScale(0.1, 0.5).clamp(0, 1).rename('sm_s');

var weights = {slope: 0.35, curv: 0.10, rain: 0.20,
               veg: 0.15, lc: 0.15, sm: 0.05};

var riskScore = slopeScore.multiply(weights.slope)
  .add(curvScore.multiply(weights.curv))
  .add(rainScore.multiply(weights.rain))
  .add(vegScore.multiply(weights.veg))
  .add(lcScore.multiply(weights.lc))
  .add(smScore.multiply(weights.sm))
  .rename('risk_score').clip(studyArea);

var riskClass = riskScore
  .where(riskScore.lt(0.3), 1)
  .where(riskScore.gte(0.3).and(riskScore.lt(0.45)), 2)
  .where(riskScore.gte(0.45).and(riskScore.lt(0.6)), 3)
  .where(riskScore.gte(0.6), 4)
  .toInt().rename('risk_class').clip(studyArea);

// ============================================================================
// 7. MODEL VALIDATION
// ============================================================================

var validation = riskScore.reduceRegions({
  collection: affectedSites,
  reducer: ee.Reducer.first(),
  scale: 30
});

// ============================================================================
// 8. SENTINEL-2 BEFORE / AFTER
// ============================================================================

var s2Before = safeS2Composite(eventDate.advance(-90, 'day'), eventDate, 60);
var s2After  = safeS2Composite(eventDate, eventDate.advance(60, 'day'), 80);

var ndviBefore = safeNDVI(eventDate.advance(-90, 'day'), eventDate, 60, 'NDVI_pre');
var ndviAfter  = safeNDVI(eventDate, eventDate.advance(60, 'day'), 80, 'NDVI_post');

var ndviDiff = ndviAfter.subtract(ndviBefore).rename('NDVI_change');
var detectedScars = ndviDiff.lt(-0.25).and(slope.gt(25)).selfMask();

// ============================================================================
// 9. UI
// ============================================================================

ui.root.clear();

var panel = ui.Panel({
  style: {width: '420px', padding: '14px', backgroundColor: '#fafafa'}
});

panel.add(ui.Label({
  value: 'Elgeyo Marakwet Landslide Dashboard',
  style: {fontSize: '20px', fontWeight: 'bold', color: '#4E342E',
          margin: '0 0 4px 0'}
}));
panel.add(ui.Label({
  value: 'Past damage (Nov 2025) + future risk prediction',
  style: {fontSize: '12px', color: '#555', margin: '0 0 10px 0'}
}));

var impact = ui.Panel({
  style: {backgroundColor: '#FFEBEE', padding: '10px', margin: '6px 0',
          border: '1px solid #B71C1C'}
});
impact.add(ui.Label('NOV 2025 IMPACT',
  {fontSize: '11px', fontWeight: 'bold', color: '#B71C1C', margin: '0'}));
impact.add(ui.Label('Confirmed deaths: 26+   |   Missing: 25',
  {fontSize: '12px', margin: '3px 0 0 0'}));
impact.add(ui.Label('Hospitalised: 26+   |   Homes destroyed: 1,000+',
  {fontSize: '12px', margin: '0'}));
impact.add(ui.Label('19 deaths from a single extended family in Endo Ward',
  {fontSize: '11px', margin: '4px 0 0 0', color: '#666',
   fontWeight: 'bold'}));
panel.add(impact);

panel.add(ui.Label('CHOOSE VIEW',
  {fontSize: '12px', fontWeight: 'bold', margin: '14px 0 4px 0'}));

var views = [
  '🔮 PREDICTIVE: future risk (continuous)',
  '🔮 PREDICTIVE: future risk (4 classes)',
  '🔮 PREDICTIVE: extreme-risk zones only',
  '📊 Past damage: detected scars (Nov 2025)',
  '📊 Past damage: NDVI change',
  '🛰 Sentinel-2 BEFORE (true colour)',
  '🛰 Sentinel-2 AFTER (true colour)',
  '🛰 Sentinel-2 AFTER (false colour - bare ground)',
  '⛰ Driver: slope (degrees)',
  '⛰ Driver: slope curvature',
  '🌧 Driver: OND rainfall climatology',
  '🌱 Driver: vegetation (NDVI)',
  '🌍 Driver: land cover',
  '🌧 Recent: 7-day rainfall pre-event'
];

var viewSelector = ui.Select({
  items: views,
  value: views[0],
  style: {stretch: 'horizontal'},
  onChange: function(v) { renderView(v); }
});
panel.add(viewSelector);

var legendPanel = ui.Panel({
  style: {padding: '8px', margin: '10px 0', backgroundColor: '#fff',
          border: '1px solid #ccc'}
});
panel.add(legendPanel);

panel.add(ui.Label('CLICK MAP TO INSPECT',
  {fontSize: '12px', fontWeight: 'bold', margin: '14px 0 4px 0'}));
var inspector = ui.Panel(
  [ui.Label('Click anywhere on the map to see slope, NDVI, rainfall, ' +
            'and predicted risk score for that location.',
            {fontSize: '11px', color: '#777'})],
  ui.Panel.Layout.flow('vertical'),
  {backgroundColor: '#fff', padding: '6px',
   border: '1px solid #ccc', margin: '4px 0'}
);
panel.add(inspector);

panel.add(ui.Label('MODEL VALIDATION',
  {fontSize: '12px', fontWeight: 'bold', margin: '14px 0 4px 0'}));
var validationPanel = ui.Panel({
  style: {backgroundColor: '#E8F5E9', padding: '8px',
          border: '1px solid #4CAF50'}
});
validationPanel.add(ui.Label(
  'Computing risk scores at the actual 2025 disaster sites...',
  {fontSize: '11px', color: '#555'}));
panel.add(validationPanel);

validation.evaluate(function(fc, err) {
  validationPanel.clear();
  if (err) {
    validationPanel.add(ui.Label('Validation error: ' + err,
      {fontSize: '11px', color: '#B71C1C'}));
    return;
  }
  if (!fc || !fc.features || fc.features.length === 0) {
    validationPanel.add(ui.Label(
      'Validation could not run (no features returned).',
      {fontSize: '11px', color: '#B71C1C'}));
    return;
  }
  validationPanel.add(ui.Label(
    'Risk score predicted at sites that were actually hit in Nov 2025:',
    {fontSize: '11px', fontWeight: 'bold', color: '#1B5E20', margin: '0'}));
  fc.features.forEach(function(f) {
    var score = (f.properties && f.properties.risk_score !== undefined)
                ? f.properties.risk_score : null;
    var scoreLbl = (score !== null) ? score.toFixed(3) : 'n/a';
    var cls = (score === null) ? '?' :
              (score < 0.3) ? 'LOW' :
              (score < 0.45) ? 'MODERATE' :
              (score < 0.6) ? 'HIGH' : 'EXTREME';
    var color = (score === null) ? '#888' :
                (score < 0.3) ? '#388E3C' :
                (score < 0.45) ? '#FBC02D' :
                (score < 0.6) ? '#F57C00' : '#B71C1C';
    var name = (f.properties && f.properties.name) ?
               f.properties.name : 'unknown';
    validationPanel.add(ui.Label(
      name + ': ' + scoreLbl + ' (' + cls + ')',
      {fontSize: '11px', color: color, margin: '2px 0 0 0'}));
  });
  validationPanel.add(ui.Label(
    'Higher scores at known sites = better-calibrated model.',
    {fontSize: '10px', color: '#666', margin: '4px 0 0 0',
     fontWeight: 'bold'}));
});

panel.add(ui.Label('PREDICTIVE MODEL',
  {fontSize: '12px', fontWeight: 'bold', margin: '14px 0 4px 0'}));
panel.add(ui.Label(
  'Risk = 0.35×slope + 0.20×rainfall + 0.15×vegetation + 0.15×landcover ' +
  '+ 0.10×curvature + 0.05×soil moisture',
  {fontSize: '10px', color: '#444', margin: '0 0 4px 0'}));

panel.add(ui.Label('DATA SOURCES',
  {fontSize: '12px', fontWeight: 'bold', margin: '14px 0 4px 0'}));
panel.add(ui.Label(
  'Boundaries: HDX 1450-wards (uploaded) or FAO GAUL (fallback)\n' +
  'Optical: Sentinel-2 SR Harmonized\n' +
  'Rainfall: CHIRPS Daily\n' +
  'Elevation: SRTM 30 m\n' +
  'Land cover: ESA WorldCover 10 m\n' +
  'Soil moisture: SMAP L4 9 km',
  {fontSize: '10px', color: '#666', whiteSpace: 'pre', margin: '0'}));

// ============================================================================
// 10. MAP & RENDER
// ============================================================================

var map = ui.Map();
map.setCenter(35.62, 1.05, 10);
map.setOptions('TERRAIN');

function clearLayers() { map.layers().reset(); }

function setLegend(items, title) {
  legendPanel.clear();
  legendPanel.add(ui.Label(title,
    {fontWeight: 'bold', fontSize: '12px', margin: '0 0 4px 0'}));
  items.forEach(function(it) {
    var row = ui.Panel(
      [ui.Label('', {backgroundColor: it.color, padding: '8px',
                     margin: '0 4px 0 0'}),
       ui.Label(it.label, {fontSize: '11px', margin: '2px 0'})],
      ui.Panel.Layout.flow('horizontal')
    );
    legendPanel.add(row);
  });
}

function addContextLayers() {
  var countyOutline = ee.Image().byte()
    .paint({featureCollection: elgeyoCounty, color: 1, width: 3});
  map.addLayer(countyOutline, {palette: ['#4E342E']},
               'County boundary');

  var subOutline = ee.Image().byte()
    .paint({featureCollection: elgeyoSubCounties, color: 1, width: 2});
  map.addLayer(subOutline, {palette: ['#1565C0']},
               'Sub-counties');

  var wardOutline = ee.Image().byte()
    .paint({featureCollection: elgeyoWards, color: 1, width: 1});
  map.addLayer(wardOutline, {palette: ['#888888']},
               'Wards');

  var sitesImg = ee.Image().byte()
    .paint({featureCollection: affectedSites, color: 1});
  map.addLayer(sitesImg, {palette: ['red']},
               'Nov 2025 affected sites');
}

function renderView(choice) {
  clearLayers();

  if (choice === '🔮 PREDICTIVE: future risk (continuous)') {
    map.addLayer(riskScore,
      {min: 0, max: 0.8,
       palette: ['#1A9641', '#A6D96A', '#FFFFBF',
                 '#FDAE61', '#D7191C', '#7B0A0A']},
      'Predicted risk (continuous)');
    setLegend([
      {color: '#1A9641', label: 'Very low risk (0.0)'},
      {color: '#FFFFBF', label: 'Moderate (0.3-0.45)'},
      {color: '#FDAE61', label: 'High (0.45-0.6)'},
      {color: '#D7191C', label: 'Extreme (>0.6)'}
    ], 'Predicted future risk');

  } else if (choice === '🔮 PREDICTIVE: future risk (4 classes)') {
    map.addLayer(riskClass,
      {min: 1, max: 4,
       palette: ['#388E3C', '#FBC02D', '#F57C00', '#B71C1C']},
      'Risk class');
    setLegend([
      {color: '#388E3C', label: '1 - Low'},
      {color: '#FBC02D', label: '2 - Moderate'},
      {color: '#F57C00', label: '3 - High'},
      {color: '#B71C1C', label: '4 - Extreme'}
    ], 'Risk class');

  } else if (choice === '🔮 PREDICTIVE: extreme-risk zones only') {
    map.addLayer(riskScore.gte(0.55).selfMask(),
      {palette: ['#B71C1C']}, 'Extreme-risk zones');
    setLegend([
      {color: '#B71C1C', label: 'Pixels predicted as extreme risk'}
    ], 'Extreme-risk zones');

  } else if (choice === '📊 Past damage: detected scars (Nov 2025)') {
    map.addLayer(s2After, {bands: ['B4','B3','B2'], min: 0, max: 0.3},
                 'Sentinel-2 after (context)');
    map.addLayer(detectedScars, {palette: ['#FF1744']},
                 'Detected scars');
    setLegend([
      {color: '#FF1744',
       label: 'Detected scars (NDVI loss >0.25 + slope >25°)'}
    ], 'Past damage detection');

  } else if (choice === '📊 Past damage: NDVI change') {
    map.addLayer(ndviDiff,
      {min: -0.6, max: 0.3,
       palette: ['#8B0000', '#FF0000', '#FF8800', '#FFFF00',
                 '#FFFFFF', '#90EE90', '#006400']},
      'NDVI change');
    setLegend([
      {color: '#8B0000', label: 'Severe vegetation loss'},
      {color: '#FFFF00', label: 'No change'},
      {color: '#006400', label: 'Vegetation gain'}
    ], 'NDVI change');

  } else if (choice === '🛰 Sentinel-2 BEFORE (true colour)') {
    map.addLayer(s2Before, {bands: ['B4','B3','B2'], min: 0, max: 0.3},
                 'Sentinel-2 BEFORE');
    setLegend([{color: '#3a78d3', label: 'Pre-disaster cover'}],
              'Sentinel-2 true colour');

  } else if (choice === '🛰 Sentinel-2 AFTER (true colour)') {
    map.addLayer(s2After, {bands: ['B4','B3','B2'], min: 0, max: 0.3},
                 'Sentinel-2 AFTER');
    setLegend([{color: '#888', label: 'Brown/grey scars = exposed soil'}],
              'Sentinel-2 true colour');

  } else if (choice === '🛰 Sentinel-2 AFTER (false colour - bare ground)') {
    map.addLayer(s2After, {bands: ['B8','B4','B3'], min: 0, max: 0.4},
                 'Sentinel-2 AFTER false colour');
    setLegend([
      {color: '#FF4444', label: 'Healthy vegetation (red)'},
      {color: '#D2B48C', label: 'Bare soil / debris'}
    ], 'False-colour interpretation');

  } else if (choice === '⛰ Driver: slope (degrees)') {
    map.addLayer(slope.clip(studyArea),
      {min: 0, max: 60,
       palette: ['#00FF00','#FFFF00','#FFA500','#FF0000','#8B0000']},
      'Slope angle');
    setLegend([
      {color: '#00FF00', label: '0-15° (low)'},
      {color: '#FFFF00', label: '15-25°'},
      {color: '#FFA500', label: '25-35° (susceptible)'},
      {color: '#8B0000', label: '>40° (high)'}
    ], 'Slope angle');

  } else if (choice === '⛰ Driver: slope curvature') {
    map.addLayer(curvature.clip(studyArea),
      {min: -50, max: 50,
       palette: ['#0000FF','#FFFFFF','#FF0000']},
      'Slope curvature');
    setLegend([
      {color: '#0000FF', label: 'Concave (water collects)'},
      {color: '#FFFFFF', label: 'Flat'},
      {color: '#FF0000', label: 'Convex (water sheds)'}
    ], 'Slope curvature');

  } else if (choice === '🌧 Driver: OND rainfall climatology') {
    map.addLayer(rainsClimatology.clip(studyArea),
      {min: 100, max: 400,
       palette: ['#FFFFFF','#A0E0FF','#4080FF','#0040C0','#000080']},
      'OND rainfall (long-term)');
    setLegend([
      {color: '#FFFFFF', label: '<100 mm'},
      {color: '#4080FF', label: '~250 mm'},
      {color: '#000080', label: '>400 mm'}
    ], 'OND rainfall climatology');

  } else if (choice === '🌱 Driver: vegetation (NDVI)') {
    map.addLayer(ndviCurrent.clip(studyArea),
      {min: 0, max: 0.8,
       palette: ['#8B4513','#FFFF00','#90EE90','#006400']},
      'NDVI');
    setLegend([
      {color: '#8B4513', label: 'Bare/built (high risk)'},
      {color: '#FFFF00', label: 'Sparse'},
      {color: '#006400', label: 'Dense forest (low risk)'}
    ], 'Vegetation cover');

  } else if (choice === '🌍 Driver: land cover') {
    map.addLayer(landCover.clip(studyArea), {
      bands: ['Map'],
      min: 10, max: 100,
      palette: [
        '006400', 'FFBB22', 'FFFF4C', 'F096FF', 'FA0000',
        'B4B4B4', 'F0F0F0', '0064C8', '0096A0', '00CF75', 'FAE6A0'
      ]
    }, 'ESA WorldCover');
    setLegend([
      {color: '#006400', label: 'Tree cover'},
      {color: '#FFBB22', label: 'Shrubland'},
      {color: '#FFFF4C', label: 'Grassland'},
      {color: '#F096FF', label: 'Cropland'},
      {color: '#FA0000', label: 'Built-up'},
      {color: '#B4B4B4', label: 'Bare/sparse'},
      {color: '#0064C8', label: 'Water'}
    ], 'Land cover (ESA)');

  } else if (choice === '🌧 Recent: 7-day rainfall pre-event') {
    map.addLayer(rainfall7day.clip(studyArea),
      {min: 0, max: 250,
       palette: ['#FFFFFF','#A0E0FF','#4080FF','#0040C0','#000080']},
      '7-day rainfall before event');
    setLegend([
      {color: '#FFFFFF', label: '0 mm'},
      {color: '#4080FF', label: '~150 mm'},
      {color: '#000080', label: '>250 mm'}
    ], '7-day rainfall (mm)');
  }

  addContextLayers();
}

renderView(views[0]);

// ============================================================================
// 11. INSPECTOR
// ============================================================================

map.onClick(function(coords) {
  inspector.clear();
  inspector.add(ui.Label('Loading...', {fontSize: '11px', color: '#777'}));

  var pt = ee.Geometry.Point([coords.lon, coords.lat]);

  ee.Dictionary({
    elev:  srtm.reduceRegion(ee.Reducer.first(), pt, 30).get('elevation'),
    slope: slope.reduceRegion(ee.Reducer.first(), pt, 30).get('slope'),
    ndvi:  ndviCurrent.reduceRegion(ee.Reducer.first(), pt, 10).get('NDVI'),
    rain:  rainfall7day.reduceRegion(ee.Reducer.first(), pt, 5000).get('rain_7day'),
    risk:  riskScore.reduceRegion(ee.Reducer.first(), pt, 30).get('risk_score'),
    cls:   riskClass.reduceRegion(ee.Reducer.first(), pt, 30).get('risk_class')
  }).evaluate(function(d, err) {
    inspector.clear();
    if (err) {
      inspector.add(ui.Label('Error: ' + err,
        {fontSize: '11px', color: '#B71C1C'}));
      return;
    }
    inspector.add(ui.Label('LOCATION INSPECTED',
      {fontSize: '11px', fontWeight: 'bold', color: '#1565C0', margin: '0'}));
    inspector.add(ui.Label(
      coords.lat.toFixed(4) + ', ' + coords.lon.toFixed(4),
      {fontSize: '11px', margin: '0'}));

    inspector.add(ui.Label('Elevation: ' +
      (d.elev !== null ? d.elev.toFixed(0) + ' m' : 'n/a'),
      {fontSize: '11px', margin: '4px 0 0 0'}));
    inspector.add(ui.Label('Slope: ' +
      (d.slope !== null ? d.slope.toFixed(1) + '°' : 'n/a'),
      {fontSize: '11px', margin: '0'}));
    inspector.add(ui.Label('NDVI (vegetation): ' +
      (d.ndvi !== null ? d.ndvi.toFixed(3) : 'n/a'),
      {fontSize: '11px', margin: '0'}));
    inspector.add(ui.Label('7-day rainfall: ' +
      (d.rain !== null ? d.rain.toFixed(1) + ' mm' : 'n/a'),
      {fontSize: '11px', margin: '0'}));

    var riskLbl = (d.risk !== null) ? d.risk.toFixed(3) : 'n/a';
    var clsLbl  = (d.cls === 1) ? 'LOW' : (d.cls === 2) ? 'MODERATE' :
                  (d.cls === 3) ? 'HIGH' : (d.cls === 4) ? 'EXTREME' : '?';
    var clsColor = (d.cls === 1) ? '#388E3C' : (d.cls === 2) ? '#FBC02D' :
                   (d.cls === 3) ? '#F57C00' : (d.cls === 4) ? '#B71C1C' : '#888';

    inspector.add(ui.Label('PREDICTED RISK: ' + riskLbl + ' (' + clsLbl + ')',
      {fontSize: '12px', margin: '6px 0 0 0', fontWeight: 'bold',
       color: clsColor}));
  });
});

// ============================================================================
// 12. CHARTS
// ============================================================================

var rainSeries = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterDate(eventDate.advance(-15, 'day'),
              eventDate.advance(15, 'day'));

var rainChart = ui.Chart.image.series({
  imageCollection: rainSeries,
  region: ee.Geometry.Point([35.64426, 1.12864]).buffer(5000),
  reducer: ee.Reducer.mean(),
  scale: 5000,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'Daily rainfall — 15 days either side of the event',
  vAxis: {title: 'mm'}, hAxis: {title: ''},
  lineWidth: 2, pointSize: 3, colors: ['#1565C0'],
  legend: {position: 'none'}, height: 200
});

panel.add(ui.Label('RAINFALL DRIVER',
  {fontSize: '12px', fontWeight: 'bold', margin: '14px 0 4px 0'}));
panel.add(rainChart);

var deathsChart = ui.Chart.feature.byFeature(affectedSites, 'name', 'deaths')
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Confirmed deaths by location (Nov 2025)',
    vAxis: {title: 'Deaths'},
    hAxis: {title: '', slantedText: true, slantedTextAngle: 30},
    legend: {position: 'none'}, colors: ['#B71C1C'], height: 200
  });
panel.add(deathsChart);

var riskHistogram = ui.Chart.image.histogram({
  image: riskScore,
  region: studyArea,
  scale: 100,
  maxBuckets: 30
}).setOptions({
  title: 'Distribution of risk scores across Elgeyo Marakwet',
  hAxis: {title: 'Risk score'},
  vAxis: {title: 'Pixel count'},
  colors: ['#B71C1C'], legend: {position: 'none'}, height: 200
});
panel.add(ui.Label('FUTURE-RISK DISTRIBUTION',
  {fontSize: '12px', fontWeight: 'bold', margin: '14px 0 4px 0'}));
panel.add(riskHistogram);

// ============================================================================
// 13. ASSEMBLE
// ============================================================================

ui.root.add(ui.SplitPanel({
  firstPanel: panel,
  secondPanel: map,
  orientation: 'horizontal'
}));

print('Dashboard ready. Check the Console output above for diagnostics.');