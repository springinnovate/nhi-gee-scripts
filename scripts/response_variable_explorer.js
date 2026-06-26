var DEFAULT_YEAR = "2005";
var SAMPLE_SCALE_METERS = 30;
var CLEAR_LABEL = "(*clear*)";

function makeLayerDefinition(name, build, defaultRange) {
    return {
        name: name,
        build: function (year) {
            return ee.Image(build(year)).rename("B0");
        },
        defaultRange: defaultRange || { min: 0, max: 1 }
    };
}

var LAYER_DEFINITIONS = [];

var PALETTES = {
    black_to_red: ["000000", "005aff", "43c8c8", "fff700", "ff0000"],
    blue_to_green: ["440154", "414287", "218e8d", "5ac864", "fde725"],
    cividis: ["00204d", "414d6b", "7c7b78", "b9ac70", "ffea46"],
    viridis: ["440154", "355e8d", "20928c", "70cf57", "fde725"],
    blues: ["f7fbff", "c6dbef", "6baed6", "2171b5", "08306b"],
    reds: ["fff5f0", "fcbba1", "fb6a4a", "cb181d", "67000d"],
    turbo: ["321543", "2eb4f2", "affa37", "f66c19", "7a0403"]
};
var DEFAULT_PALETTE = "blue_to_green";

function buildLayerNames() {
    return [CLEAR_LABEL].concat(
        LAYER_DEFINITIONS.map(function (definition) {
            return definition.name;
        })
    );
}

function layerDefinitionByName(name) {
    for (var i = 0; i < LAYER_DEFINITIONS.length; i++) {
        if (LAYER_DEFINITIONS[i].name === name) {
            return LAYER_DEFINITIONS[i];
        }
    }
    return null;
}

function getCachedLayer(context, layerDefinition, year) {
    var key = year + "|" + layerDefinition.name;
    if (!context.layerCache[key]) {
        context.layerCache[key] = layerDefinition.build(year);
    }
    return context.layerCache[key];
}

function detectRange(image, geometry, fallbackRange, callback) {
    var dictionary = image.reduceRegion({
        reducer: ee.Reducer.percentile([10, 90], ["p10", "p90"]),
        geometry: geometry,
        scale: SAMPLE_SCALE_METERS * 100,
        bestEffort: true,
        maxPixels: 1e8,
        tileScale: 4
    });

    ee.data.computeValue(dictionary, function (value) {
        var min = value && value.B0_p10;
        var max = value && value.B0_p90;

        if (min === null || min === undefined || max === null || max === undefined) {
            callback(fallbackRange);
            return;
        }

        if (min === max) {
            callback(fallbackRange);
            return;
        }

        callback({ min: min, max: max });
    });
}

function makeLegendPanel(context) {
    function makeRow(color, label) {
        var colorBox = ui.Label({
            style: {
                backgroundColor: "#" + color,
                padding: "4px 25px 4px 25px",
                margin: "0",
                position: "bottom-center"
            }
        });

        var description = ui.Label({
            value: label,
            style: {
                margin: "0",
                position: "top-center",
                fontSize: "10px",
                padding: 0,
                border: 0,
                textAlign: "center",
                backgroundColor: "rgba(0, 0, 0, 0)"
            }
        });

        return ui.Panel({
            widgets: [colorBox, description],
            layout: ui.Panel.Layout.flow("vertical"),
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        });
    }

    var labels = ["Low", "", "", "", "High"];

    if (context.legendPanel === null) {
        context.legendPanel = ui.Panel({
            layout: ui.Panel.Layout.flow("horizontal"),
            style: {
                position: "top-center",
                padding: "0",
                backgroundColor: "rgba(255, 255, 255, 0.4)"
            }
        });

        context.paletteSelect = ui.Select({
            items: Object.keys(PALETTES),
            value: DEFAULT_PALETTE,
            onChange: function (paletteName) {
                context.visParams.palette = PALETTES[paletteName];
                context.buildLegendPanel();
                context.updateVisParams();
            }
        });

        context.map.add(context.legendPanel);
    } else {
        context.legendPanel.clear();
    }

    context.legendPanel.add(context.paletteSelect);
    for (var i = 0; i < 5; i++) {
        context.legendPanel.add(makeRow(context.visParams.palette[i], labels[i]));
    }
}

function formatPointValue(value) {
    return typeof value === "number"
        ? String(Math.round(value * 100) / 100)
        : String(value);
}

var leftMap = ui.root.widgets().get(0);
var rightMap = ui.Map();
var linker = ui.Map.Linker([leftMap, rightMap]);
var splitPanel = ui.SplitPanel({
    firstPanel: linker.get(0),
    secondPanel: linker.get(1),
    orientation: "horizontal",
    wipe: true,
    style: { stretch: "both" }
});
ui.root.widgets().reset([splitPanel]);

var panelList = [];
[
    [leftMap, "left"],
    [rightMap, "right"]
].forEach(function (mapSide) {
    var context = {
        layerCache: {},
        currentYear: parseInt(DEFAULT_YEAR, 10),
        lastLayer: null,
        raster: null,
        datasetName: null,
        activeLayerDefinition: null,
        pointValue: null,
        lastPointLayer: null,
        map: mapSide[0],
        legendPanel: null,
        paletteSelect: null,
        renderId: 0,
        visParams: {
            min: 0,
            max: 1,
            palette: PALETTES[DEFAULT_PALETTE]
        }
    };

    function updateVisParams() {
        if (context.lastLayer !== null) {
            context.lastLayer.setVisParams(context.visParams);
        }
    }

    context.updateVisParams = updateVisParams;
    context.buildLegendPanel = function () {
        makeLegendPanel(context);
    };

    var minValue = ui.Textbox({
        value: "n/a",
        onChange: function (value) {
            context.visParams.min = +value;
            updateVisParams();
        }
    });
    var maxValue = ui.Textbox({
        value: "n/a",
        onChange: function (value) {
            context.visParams.max = +value;
            updateVisParams();
        }
    });
    minValue.setDisabled(true);
    maxValue.setDisabled(true);

    function clearLayer() {
        if (context.lastLayer !== null) {
            context.map.remove(context.lastLayer);
            context.lastLayer = null;
        }
        if (context.lastPointLayer !== null) {
            context.map.remove(context.lastPointLayer);
            context.lastPointLayer = null;
        }
        context.raster = null;
        context.datasetName = null;
        context.activeLayerDefinition = null;
        minValue.setValue("n/a", false);
        maxValue.setValue("n/a", false);
        minValue.setDisabled(true);
        maxValue.setDisabled(true);
        context.pointValue.setValue("nothing clicked");
    }

    function loadLayer(layerName, done) {
        done = done || function () {};

        if (layerName === CLEAR_LABEL) {
            clearLayer();
            done();
            return;
        }

        var layerDefinition = layerDefinitionByName(layerName);
        if (layerDefinition === null) {
            done();
            return;
        }

        var image = getCachedLayer(context, layerDefinition, context.currentYear);
        var renderId = ++context.renderId;

        if (context.lastLayer !== null) {
            context.map.remove(context.lastLayer);
            context.lastLayer = null;
        }

        context.raster = image;
        context.datasetName = layerDefinition.name;
        context.activeLayerDefinition = layerDefinition;
        context.visParams.palette =
            PALETTES[context.paletteSelect.getValue() || DEFAULT_PALETTE];
        context.buildLegendPanel();

        detectRange(
            image,
            context.map.getBounds(true),
            layerDefinition.defaultRange,
            function (range) {
                if (renderId !== context.renderId) {
                    done();
                    return;
                }

                context.visParams = {
                    min: range.min,
                    max: range.max,
                    palette: context.visParams.palette
                };
                context.lastLayer = context.map.addLayer(
                    image,
                    context.visParams,
                    layerDefinition.name
                );
                minValue.setValue(String(context.visParams.min), false);
                maxValue.setValue(String(context.visParams.max), false);
                minValue.setDisabled(false);
                maxValue.setDisabled(false);
                done();
            }
        );
    }

    context.map.style().set("cursor", "crosshair");

    var panel = ui.Panel({
        layout: ui.Panel.Layout.flow("vertical"),
        style: {
            position: "middle-" + mapSide[1],
            backgroundColor: "rgba(255, 255, 255, 0.4)"
        }
    });

    var select = ui.Select({
        items: buildLayerNames(),
        placeholder: "Choose a dataset...",
        onChange: function (layerName, self) {
            self.setDisabled(true);
            loadLayer(layerName, function () {
                self.setDisabled(false);
            });
        }
    });

    var activeYear = ui.Textbox({
        value: DEFAULT_YEAR,
        style: { width: "200px" },
        onChange: function (value) {
            context.currentYear = parseInt(value, 10);
            var selected = select.getValue();
            if (selected && selected !== CLEAR_LABEL) {
                loadLayer(selected);
            }
        }
    });

    context.pointValue = ui.Textbox({ value: "nothing clicked" });

    var rangeButton = ui.Button("Detect Range", function (self) {
        if (context.raster === null || context.activeLayerDefinition === null) {
            return;
        }

        self.setDisabled(true);
        var label = self.getLabel();
        self.setLabel("Detecting...");

        detectRange(
            context.raster,
            context.map.getBounds(true),
            context.activeLayerDefinition.defaultRange,
            function (range) {
                minValue.setValue(String(range.min), false);
                maxValue.setValue(String(range.max), true);
                self.setLabel(label);
                self.setDisabled(false);
            }
        );
    });

    panel.add(
        ui.Label({
            value: "Current Year",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(activeYear);
    panel.add(
        ui.Label({
            value: mapSide[1] + " controls",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(select);
    panel.add(
        ui.Label({
            value: "min",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(minValue);
    panel.add(
        ui.Label({
            value: "max",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(maxValue);
    panel.add(rangeButton);
    panel.add(
        ui.Label({
            value: "picked point",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(context.pointValue);

    panelList.push([panel, minValue, maxValue, context]);
    context.map.add(panel);
    context.map.setControlVisibility(false);
    context.map.setControlVisibility({ mapTypeControl: true });
    context.buildLegendPanel();
});

var cloneToRight = ui.Button("Use this range in both windows", function () {
    panelList[1][1].setValue(panelList[0][1].getValue(), false);
    panelList[1][2].setValue(panelList[0][2].getValue(), true);
});

var cloneToLeft = ui.Button("Use this range in both windows", function () {
    panelList[0][1].setValue(panelList[1][1].getValue(), false);
    panelList[0][2].setValue(panelList[1][2].getValue(), true);
});

panelList.forEach(function (panelArray) {
    var map = panelArray[3].map;
    map.onClick(function (pointInfo) {
        var point = ee.Geometry.Point([pointInfo.lon, pointInfo.lat]);
        var pointCollection = ee.FeatureCollection([ee.Feature(point)]);

        [panelList[0][3], panelList[1][3]].forEach(function (context) {
            if (context.raster === null) {
                return;
            }

            context.pointValue.setValue("sampling...");
            var pointSample = context.raster.sampleRegions({
                collection: pointCollection,
                geometries: true,
                scale: SAMPLE_SCALE_METERS
            });

            ee.data.computeValue(pointSample, function (value) {
                if (value.features.length > 0) {
                    var feature = value.features[0];
                    context.pointValue.setValue(formatPointValue(feature.properties.B0));

                    if (context.lastPointLayer !== null) {
                        context.map.remove(context.lastPointLayer);
                    }

                    context.lastPointLayer = context.map.addLayer(point, {
                        color: "#FF00FF"
                    });
                } else {
                    context.pointValue.setValue("nodata");
                }
            });
        });
    });
});

panelList[0][0].add(cloneToRight);
panelList[1][0].add(cloneToLeft);
