"use strict";

const DATA_PATH = "data/housing_permits_web_2026-08-09.geojson";
const DAY_MS = 24 * 60 * 60 * 1000;
const UNIT_CATEGORY_COLOURS = {
  "1 unit": { fill: "#2f80c3", stroke: "#1d5f96" },
  "2-6 units": { fill: "#e17c25", stroke: "#ad5813" },
  "7+ units": { fill: "#8b5bb5", stroke: "#654087" },
  other: { fill: "#858982", stroke: "#5f625d" }
};

const numberFormatter = new Intl.NumberFormat("en-CA");
const displayDateFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

const elements = {
  mapNote: document.querySelector("#map-note"),
  permitCount: document.querySelector("#permit-count"),
  netUnitCount: document.querySelector("#net-unit-count"),
  largePermitCount: document.querySelector("#large-permit-count"),
  startDate: document.querySelector("#start-date"),
  endDate: document.querySelector("#end-date"),
  startRange: document.querySelector("#start-range"),
  endRange: document.querySelector("#end-range"),
  selectedStart: document.querySelector("#selected-start"),
  selectedEnd: document.querySelector("#selected-end"),
  minimumDate: document.querySelector("#minimum-date"),
  maximumDate: document.querySelector("#maximum-date"),
  dataDateRange: document.querySelector("#data-date-range"),
  rangeSelection: document.querySelector("#range-selection"),
  histogram: document.querySelector("#date-histogram"),
  resetDates: document.querySelector("#reset-dates"),
  unitCategoryFilters: [...document.querySelectorAll('input[name="unit-category"]')],
  sourceDatasetFilters: [...document.querySelectorAll('input[name="source-dataset"]')]
};

const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true
});

L.control.zoom({ position: "topleft" }).addTo(map);

// L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
//   subdomains: "abcd",
//   maxZoom: 20,
//   attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
// }).addTo(map);


L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  opacity: 0.9,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);


// A feature group exposes getBounds(), allowing the initial view to come directly from
// the permit markers rather than from a hard-coded city centre.
const markerLayer = L.featureGroup().addTo(map);
let permits = [];
let datasetStart;
let datasetEnd;
let totalDays = 0;
let histogramBins = [];
let resizeFrame;

// Leaflet records its container size when it initializes. Keep that measurement current
// if the flex/grid layout changes later (for example, at the mobile breakpoint).
const mapPane = document.querySelector(".map-pane");
const mapResizeObserver = new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
});
mapResizeObserver.observe(mapPane);

function afterPageLayout(callback) {
  let sizeWasInvalidated = false;
  let callbackRan = false;

  const runCallback = () => {
    if (callbackRan) return;
    callbackRan = true;
    callback();
  };

  const invalidateAfterLayout = () => {
    if (sizeWasInvalidated) return;
    sizeWasInvalidated = true;
    map.invalidateSize({ pan: false });

    // Fit on the following paint. The timer also covers browsers that throttle frames.
    requestAnimationFrame(runCallback);
    window.setTimeout(runCallback, 32);
  };

  // map.js is loaded after the stylesheets and markup. Two frames allow the final
  // flex/grid dimensions to settle without waiting on unrelated CDN load events.
  requestAnimationFrame(() => requestAnimationFrame(invalidateAfterLayout));
  window.setTimeout(invalidateAfterLayout, 80);
}

function parseDate(dateString) {
  // Adding midnight UTC avoids date shifts when the page runs in another time zone.
  return new Date(`${dateString}T00:00:00Z`);
}

function dateToDay(date) {
  return Math.round((date.getTime() - datasetStart.getTime()) / DAY_MS);
}

function dayToDate(day) {
  return new Date(datasetStart.getTime() + Number(day) * DAY_MS);
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(date) {
  return displayDateFormatter.format(date);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Circle area grows logarithmically with net_units. Capping the input at 250 units keeps
// unusually large projects visible without allowing them to obscure nearby permits.
function radiusForUnits(value) {
  const units = Math.max(1, safeNumber(value));
  const cappedUnits = Math.min(units, 250);
  const minimumRadius = 4;
  const maximumRadius = 12;
  const minimumLog = Math.log1p(1);
  const maximumLog = Math.log1p(250);
  const scaledArea = (Math.log1p(cappedUnits) - minimumLog) / (maximumLog - minimumLog);
  return Math.sqrt(
    minimumRadius ** 2 + scaledArea * (maximumRadius ** 2 - minimumRadius ** 2)
  );
}

// unit_category controls colour; the neutral fallback makes unexpected future values legible.
function styleForFeature(properties) {
  const palette = UNIT_CATEGORY_COLOURS[properties.unit_category] || UNIT_CATEGORY_COLOURS.other;
  return {
    radius: radiusForUnits(properties.net_units),
    fillColor: palette.fill,
    color: palette.stroke,
    weight: 1,
    opacity: 0.9,
    fillOpacity: 0.7
  };
}

function makePopup(properties) {
  const wrapper = document.createElement("div");
  const title = document.createElement("h3");
  title.className = "popup-address";
  title.textContent = properties.full_address ?? "—";
  wrapper.appendChild(title);

  const rows = [
    ["Description", properties.DESCRIPTION],
    ["Address", properties.full_address],
    ["Current use", properties.CURRENT_USE],
    ["Proposed use", properties.PROPOSED_USE],
    ["Permit type", properties.PERMIT_TYPE],
    ["Permit number", properties.PERMIT_NUM],
    ["Source dataset", properties.source_dataset],
    ["Application date", properties.APPLICATION_DATE],
    ["Completed date", properties.COMPLETED_DATE],
    ["Net units", properties.net_units]

  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    const key = document.createElement("span");
    const displayedValue = document.createElement("span");
    row.className = "popup-row";
    key.className = "popup-key";
    displayedValue.className = "popup-value";
    key.textContent = label;
    displayedValue.textContent = value ?? "—";
    row.append(key, displayedValue);
    wrapper.appendChild(row);
  });

  return wrapper;
}

// Recalculate the three cards from only the permits matching every active filter.
function updateSummary(filteredPermits) {
  const totals = filteredPermits.reduce(
    (summary, permit) => {
      summary.netUnits += safeNumber(permit.properties.net_units);
      if (permit.properties.unit_category === "7+ units") summary.largePermits += 1;
      return summary;
    },
    { netUnits: 0, largePermits: 0 }
  );

  elements.permitCount.textContent = numberFormatter.format(filteredPermits.length);
  elements.netUnitCount.textContent = numberFormatter.format(totals.netUnits);
  elements.largePermitCount.textContent = numberFormatter.format(totals.largePermits);
}

function updateHistogram(startDate, endDate) {
  histogramBins.forEach((bin) => {
    const inRange = bin.end >= startDate && bin.start <= endDate;
    bin.element.classList.toggle("outside-range", !inRange);
  });
}

function updateControlDisplay(startDay, endDay) {
  const startDate = dayToDate(startDay);
  const endDate = dayToDate(endDay);
  const startPercent = totalDays ? (startDay / totalDays) * 100 : 0;
  const endPercent = totalDays ? (endDay / totalDays) * 100 : 100;

  elements.startDate.value = toISODate(startDate);
  elements.endDate.value = toISODate(endDate);
  elements.selectedStart.textContent = formatDate(startDate);
  elements.selectedEnd.textContent = formatDate(endDate);
  elements.rangeSelection.style.left = `${startPercent}%`;
  elements.rangeSelection.style.width = `${endPercent - startPercent}%`;
  updateHistogram(startDate, endDate);
}

// Filtering removes non-matching Leaflet layers, so hidden markers cannot open popups.
// All conditions are evaluated against the already-loaded permit records, and the same
// visible array drives the summary cards so the map and totals remain aligned.
function applyFilters() {
  const startDay = Number(elements.startRange.value);
  const endDay = Number(elements.endRange.value);
  const startTime = dayToDate(startDay).getTime();
  const endTime = dayToDate(endDay).getTime();
  const selectedUnitCategories = new Set(
    elements.unitCategoryFilters.filter((input) => input.checked).map((input) => input.value)
  );
  const selectedSourceDatasets = new Set(
    elements.sourceDatasetFilters.filter((input) => input.checked).map((input) => input.value)
  );
  const visiblePermits = [];

  markerLayer.clearLayers();
  permits.forEach((permit) => {
    const matchesDate = permit.applicationTime >= startTime && permit.applicationTime <= endTime;
    const matchesUnitCategory = selectedUnitCategories.has(permit.properties.unit_category);
    const matchesSourceDataset = selectedSourceDatasets.has(permit.properties.source_dataset);

    if (matchesDate && matchesUnitCategory && matchesSourceDataset) {
      markerLayer.addLayer(permit.marker);
      visiblePermits.push(permit);
    }
  });

  updateControlDisplay(startDay, endDay);
  updateSummary(visiblePermits);
}

function handleRangeInput(changedControl) {
  let startDay = Number(elements.startRange.value);
  let endDay = Number(elements.endRange.value);

  if (startDay > endDay) {
    if (changedControl === elements.startRange) {
      endDay = startDay;
      elements.endRange.value = endDay;
    } else {
      startDay = endDay;
      elements.startRange.value = startDay;
    }
  }

  elements.startRange.style.zIndex = startDay >= totalDays - 2 ? "4" : "3";
  elements.endRange.style.zIndex = "3";
  applyFilters();
}

function handleDateInput(changedInput) {
  if (!changedInput.value) return;

  let startDate = parseDate(elements.startDate.value);
  let endDate = parseDate(elements.endDate.value);

  if (startDate > endDate) {
    if (changedInput === elements.startDate) endDate = startDate;
    else startDate = endDate;
  }

  elements.startRange.value = dateToDay(startDate);
  elements.endRange.value = dateToDay(endDate);
  handleRangeInput(changedInput === elements.startDate ? elements.startRange : elements.endRange);
}

function buildHistogram() {
  const monthlyCounts = new Map();

  permits.forEach((permit) => {
    const date = new Date(permit.applicationTime);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    monthlyCounts.set(key, (monthlyCounts.get(key) || 0) + 1);
  });

  const maximumCount = Math.max(...monthlyCounts.values());
  elements.histogram.replaceChildren();
  histogramBins = [];

  // The source rows are not date-sorted, so sort the YYYY-MM keys before drawing bars.
  [...monthlyCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([key, count]) => {
    const [year, month] = key.split("-").map(Number);
    const element = document.createElement("span");
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    element.className = "histogram-bar";
    element.style.height = `${Math.max(8, (count / maximumCount) * 100)}%`;
    element.title = `${key}: ${numberFormatter.format(count)} permits`;
    elements.histogram.appendChild(element);
    histogramBins.push({ start, end, element });
  });
}

function configureDateControls() {
  totalDays = dateToDay(datasetEnd);
  const minimum = toISODate(datasetStart);
  const maximum = toISODate(datasetEnd);

  [elements.startRange, elements.endRange].forEach((input) => {
    input.min = 0;
    input.max = totalDays;
    input.step = 1;
  });
  elements.startRange.value = 0;
  elements.endRange.value = totalDays;

  [elements.startDate, elements.endDate].forEach((input) => {
    input.min = minimum;
    input.max = maximum;
  });

  elements.minimumDate.textContent = datasetStart.getUTCFullYear();
  elements.maximumDate.textContent = datasetEnd.getUTCFullYear();
  elements.dataDateRange.textContent = `${formatDate(datasetStart)} to ${formatDate(datasetEnd)}`;

  elements.startRange.addEventListener("input", () => handleRangeInput(elements.startRange));
  elements.endRange.addEventListener("input", () => handleRangeInput(elements.endRange));
  elements.startDate.addEventListener("input", () => handleDateInput(elements.startDate));
  elements.endDate.addEventListener("input", () => handleDateInput(elements.endDate));
  elements.resetDates.addEventListener("click", () => {
    elements.startRange.value = 0;
    elements.endRange.value = totalDays;
    applyFilters();
  });

  [...elements.unitCategoryFilters, ...elements.sourceDatasetFilters].forEach((input) => {
    input.addEventListener("change", applyFilters);
  });
}

// Load the local GeoJSON file. This requires an HTTP server rather than opening index.html
// directly, because browsers generally block fetch requests from file:// pages.
fetch(DATA_PATH)
  .then((response) => {
    if (!response.ok) throw new Error(`The data request returned ${response.status}.`);
    return response.json();
  })
  .then((geojson) => {
    if (geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
      throw new Error(`${DATA_PATH} is not a GeoJSON FeatureCollection.`);
    }

    permits = geojson.features.map((feature) => {
      if (feature.geometry?.type !== "Point") {
        throw new Error("This map expects every feature geometry to be a Point.");
      }

      // GeoJSON Point coordinates are stored as [longitude, latitude]. Leaflet expects
      // [latitude, longitude], so read and reverse the two values explicitly here.
      const [longitude, latitude] = feature.geometry.coordinates;
      const latLng = [latitude, longitude];
      const properties = feature.properties || {};

      // Each permit is a Leaflet circle marker styled from unit_category and net_units.
      const marker = L.circleMarker(latLng, styleForFeature(properties));
      marker.bindPopup(() => makePopup(properties), { maxHeight: 340 });

      return {
        properties,
        applicationTime: parseDate(properties.APPLICATION_DATE).getTime(),
        marker
      };
    });

    const applicationTimes = permits.map((permit) => permit.applicationTime);
    datasetStart = new Date(Math.min(...applicationTimes));
    datasetEnd = new Date(Math.max(...applicationTimes));

    configureDateControls();
    buildHistogram();
    applyFilters();

    // The first filter pass populates the feature group with every permit. Only fit after
    // the complete page layout and Leaflet's refreshed container measurement are painted.
    afterPageLayout(() => {
      const permitBounds = markerLayer.getBounds();
      if (permitBounds.isValid()) {
        map.fitBounds(permitBounds, {
          padding: [28, 28],
          maxZoom: 13,
          animate: false
        });
      }
      elements.mapNote.classList.add("is-hidden");
    });
  })
  .catch((error) => {
    console.error(error);
    elements.mapNote.textContent = `Could not load ${DATA_PATH}. Run this folder from a local web server and refresh the page.`;
    elements.mapNote.classList.add("is-error");
  });
