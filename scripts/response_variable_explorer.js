var DEFAULTYEAR = "2005";
var SAMPLE_SCALE_METERS = 30;
var CLEAR_LABEL = "(*clear*)";

var GRASSLAND_PROB_IC = ee.ImageCollection(
    "projects/global-pasture-watch/assets/ggc-30m/v1/nat-semi-grassland_p"
);
var HMI_IMG = ee.Image(
    "projects/hm-30x30/assets/output/v20240801/HMv20240801_2022s_AA_300"
);
var HII_IC = ee
    .ImageCollection("projects/HII/v1/hii")
    .filterDate("2001-01-01", "2021-01-01");

var PROBABILITY_INTEGRITY_START_YEAR = 2001;
var PROBABILITY_INTEGRITY_END_YEAR = 2020;
var GRASSLAND_PROB_THRESHOLD = 60;
var HMI_THRESHOLD = 0.1;
var HII_THRESHOLD = 0.08;

function noTwoConsecutiveZerosFromAnnualBinary(buildAnnualBinary) {
    var years = ee.List.sequence(
        PROBABILITY_INTEGRITY_START_YEAR,
        PROBABILITY_INTEGRITY_END_YEAR
    );
    var annualBinaryIC = ee.ImageCollection.fromImages(
        years.map(function (year) {
            year = ee.Number(year);
            return ee
                .Image(buildAnnualBinary(year))
                .rename("g")
                .set("year", year);
        })
    );
    var list = annualBinaryIC.toList(annualBinaryIC.size());
    return ee.ImageCollection.fromImages(
        ee.List.sequence(0, ee.Number(list.size()).subtract(2)).map(
            function (i) {
                i = ee.Number(i);
                return ee.Image(list.get(i)).or(ee.Image(list.get(i.add(1))));
            }
        )
    )
        .reduce(ee.Reducer.min())
        .eq(1);
}

var PROBABILITY_INTEGRITY_INDEX = noTwoConsecutiveZerosFromAnnualBinary(
    function (year) {
        return GRASSLAND_PROB_IC.filterDate(
            ee.Date.fromYMD(year, 1, 1),
            ee.Date.fromYMD(year.add(1), 1, 1)
        )
            .first()
            .select(0)
            .gte(GRASSLAND_PROB_THRESHOLD);
    }
)
    .and(
        noTwoConsecutiveZerosFromAnnualBinary(function (year) {
            return HII_IC.filterDate(
                ee.Date.fromYMD(year, 1, 1),
                ee.Date.fromYMD(year.add(1), 1, 1)
            )
                .mean()
                .divide(7000)
                .lt(HII_THRESHOLD);
        })
    )
    .and(HMI_IMG.lte(HMI_THRESHOLD))
    .selfMask()
    .toByte();

function probabilityIntegrityIndex() {
    return PROBABILITY_INTEGRITY_INDEX;
}

function makeLayerDefinition(name, build, defaultRange) {
    return {
        name: name,
        build: function (year) {
            return ee.Image(build(year)).rename("B0");
        },
        defaultRange: defaultRange
    };
}

var LAYER_DEFINITIONS = [
    makeLayerDefinition(
        "Grassland Reference Sites",
        probabilityIntegrityIndex,
        { min: 0, max: 1 }
    )
];

var legend_styles = {
    black_to_red: ["000000", "005aff", "43c8c8", "fff700", "ff0000"],
    blue_to_green: ["440154", "414287", "218e8d", "5ac864", "fde725"],
    cividis: ["00204d", "414d6b", "7c7b78", "b9ac70", "ffea46"],
    viridis: ["440154", "355e8d", "20928c", "70cf57", "fde725"],
    blues: ["f7fbff", "c6dbef", "6baed6", "2171b5", "08306b"],
    reds: ["fff5f0", "fcbba1", "fb6a4a", "cb181d", "67000d"],
    turbo: ["321543", "2eb4f2", "affa37", "f66c19", "7a0403"]
};
var default_legend_style = "blue_to_green";

function changeColorScheme(key, active_context) {
    active_context.visParams.palette = legend_styles[key];
    active_context.build_legend_panel();
    active_context.updateVisParams();
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

    ee.data.computeValue(dictionary, function (val) {
        var min = val && val.B0_p10;
        var max = val && val.B0_p90;

        if (
            min === null ||
            min === undefined ||
            max === null ||
            max === undefined
        ) {
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

function makeLegendPanel(active_context) {
    function makeRow(color, name) {
        var colorBox = ui.Label({
            style: {
                backgroundColor: "#" + color,
                padding: "4px 25px 4px 25px",
                margin: "0 0 0px 0",
                position: "bottom-center"
            }
        });

        var description = ui.Label({
            value: name,
            style: {
                margin: "0 0 0px 0px",
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
            layout: ui.Panel.Layout.Flow("vertical"),
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        });
    }

    var names = ["Low", "", "", "", "High"];

    if (active_context.legend_panel === null) {
        active_context.legend_panel = ui.Panel({
            layout: ui.Panel.Layout.Flow("horizontal"),
            style: {
                position: "top-center",
                padding: "0px",
                backgroundColor: "rgba(255, 255, 255, 0.4)"
            }
        });

        active_context.legend_select = ui.Select({
            items: Object.keys(legend_styles),
            value: default_legend_style,
            onChange: function (key) {
                changeColorScheme(key, active_context);
            }
        });

        active_context.map.add(active_context.legend_panel);
    } else {
        active_context.legend_panel.clear();
    }

    active_context.legend_panel.add(active_context.legend_select);
    for (var i = 0; i < 5; i++) {
        active_context.legend_panel.add(
            makeRow(active_context.visParams.palette[i], names[i])
        );
    }
}

function buildLayerNames() {
    return [CLEAR_LABEL].concat(
        LAYER_DEFINITIONS.map(function (def) {
            return def.name;
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

function getCachedLayer(active_context, layerDefinition, year) {
    var key = year + "|" + layerDefinition.name;
    if (!active_context.layerCache[key]) {
        active_context.layerCache[key] = layerDefinition.build(year);
    }
    return active_context.layerCache[key];
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

var panel_list = [];
[
    [leftMap, "left"],
    [rightMap, "right"]
].forEach(function (mapside) {
    var active_context = {
        layerCache: {},
        currentYear: parseInt(DEFAULTYEAR, 10),
        last_layer: null,
        raster: null,
        datasetName: null,
        activeLayerDefinition: null,
        point_val: null,
        last_point_layer: null,
        map: mapside[0],
        legend_panel: null,
        legend_select: null,
        renderId: 0,
        visParams: {
            min: 0,
            max: 100,
            palette: legend_styles[default_legend_style]
        }
    };

    function updateVisParams() {
        if (active_context.last_layer !== null) {
            active_context.last_layer.setVisParams(active_context.visParams);
        }
    }

    active_context.updateVisParams = updateVisParams;
    active_context.build_legend_panel = function () {
        makeLegendPanel(active_context);
    };

    function clearLayer() {
        if (active_context.last_layer !== null) {
            active_context.map.remove(active_context.last_layer);
            active_context.last_layer = null;
        }
        if (active_context.last_point_layer !== null) {
            active_context.map.remove(active_context.last_point_layer);
            active_context.last_point_layer = null;
        }
        active_context.raster = null;
        active_context.datasetName = null;
        active_context.activeLayerDefinition = null;
        min_val.setValue("n/a", false);
        max_val.setValue("n/a", false);
        min_val.setDisabled(true);
        max_val.setDisabled(true);
        active_context.point_val.setValue("nothing clicked");
    }

    function loadLayer(layerName, done) {
        done = done || function () {};

        if (layerName === CLEAR_LABEL) {
            clearLayer();
            done();
            return;
        }

        var layerDefinition = layerDefinitionByName(layerName);
        var image = getCachedLayer(
            active_context,
            layerDefinition,
            active_context.currentYear
        );
        var renderId = ++active_context.renderId;

        if (active_context.last_layer !== null) {
            active_context.map.remove(active_context.last_layer);
            active_context.last_layer = null;
        }

        active_context.raster = image;
        active_context.datasetName = layerDefinition.name;
        active_context.activeLayerDefinition = layerDefinition;
        active_context.visParams.palette =
            legend_styles[
                active_context.legend_select.getValue() || default_legend_style
            ];
        active_context.build_legend_panel();

        detectRange(
            image,
            active_context.map.getBounds(true),
            layerDefinition.defaultRange,
            function (range) {
                if (renderId !== active_context.renderId) {
                    done();
                    return;
                }

                active_context.visParams = {
                    min: range.min,
                    max: range.max,
                    palette: active_context.visParams.palette
                };
                active_context.last_layer = active_context.map.addLayer(
                    image,
                    active_context.visParams,
                    layerDefinition.name
                );
                min_val.setValue(String(active_context.visParams.min), false);
                max_val.setValue(String(active_context.visParams.max), false);
                min_val.setDisabled(false);
                max_val.setDisabled(false);
                done();
            }
        );
    }

    active_context.map.style().set("cursor", "crosshair");

    var panel = ui.Panel({
        layout: ui.Panel.Layout.flow("vertical"),
        style: {
            position: "middle-" + mapside[1],
            backgroundColor: "rgba(255, 255, 255, 0.4)"
        }
    });

    var controls_label = ui.Label({
        value: mapside[1] + " controls",
        style: { backgroundColor: "rgba(0, 0, 0, 0)" }
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

    var active_year = ui.Textbox({
        value: DEFAULTYEAR,
        style: { width: "200px" },
        onChange: function (value) {
            active_context.currentYear = parseInt(value, 10);
            var selected = select.getValue();
            if (selected && selected !== CLEAR_LABEL) {
                loadLayer(selected);
            }
        }
    });

    var min_val = ui.Textbox({
        value: "n/a",
        onChange: function (value) {
            active_context.visParams.min = +value;
            updateVisParams();
        }
    });
    min_val.setDisabled(true);

    var max_val = ui.Textbox({
        value: "n/a",
        onChange: function (value) {
            active_context.visParams.max = +value;
            updateVisParams();
        }
    });
    max_val.setDisabled(true);

    active_context.point_val = ui.Textbox({ value: "nothing clicked" });

    var range_button = ui.Button("Detect Range", function (self) {
        if (
            active_context.raster === null ||
            active_context.activeLayerDefinition === null
        ) {
            return;
        }

        self.setDisabled(true);
        var label = self.getLabel();
        self.setLabel("Detecting...");

        detectRange(
            active_context.raster,
            active_context.map.getBounds(true),
            active_context.activeLayerDefinition.defaultRange,
            function (range) {
                min_val.setValue(String(range.min), false);
                max_val.setValue(String(range.max), true);
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
    panel.add(active_year);
    panel.add(controls_label);
    panel.add(select);
    panel.add(
        ui.Label({
            value: "min",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(min_val);
    panel.add(
        ui.Label({
            value: "max",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(max_val);
    panel.add(range_button);
    panel.add(
        ui.Label({
            value: "picked point",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(active_context.point_val);

    panel_list.push([panel, min_val, max_val, active_context]);
    active_context.map.add(panel);
    active_context.map.setControlVisibility(false);
    active_context.map.setControlVisibility({ mapTypeControl: true });
    active_context.build_legend_panel();
});

var clone_to_right = ui.Button("Use this range in both windows", function () {
    panel_list[1][1].setValue(panel_list[0][1].getValue(), false);
    panel_list[1][2].setValue(panel_list[0][2].getValue(), true);
});

var clone_to_left = ui.Button("Use this range in both windows", function () {
    panel_list[0][1].setValue(panel_list[1][1].getValue(), false);
    panel_list[0][2].setValue(panel_list[1][2].getValue(), true);
});

panel_list.forEach(function (panel_array) {
    var map = panel_array[3].map;
    map.onClick(function (obj) {
        var point = ee.Geometry.Point([obj.lon, obj.lat]);

        [panel_list[0][3], panel_list[1][3]].forEach(function (active_context) {
            if (active_context.raster === null) {
                return;
            }

            active_context.point_val.setValue("sampling...");
            var point_sample = active_context.raster.sampleRegions({
                collection: ee.FeatureCollection(point),
                geometries: true,
                scale: SAMPLE_SCALE_METERS
            });

            ee.data.computeValue(point_sample, function (val) {
                if (val.features.length > 0) {
                    var feature = val.features[0];
                    active_context.point_val.setValue(
                        formatPointValue(feature.properties.B0)
                    );

                    if (active_context.last_point_layer !== null) {
                        active_context.map.remove(
                            active_context.last_point_layer
                        );
                    }

                    active_context.last_point_layer =
                        active_context.map.addLayer(point, {
                            color: "#FF00FF"
                        });
                } else {
                    active_context.point_val.setValue("nodata");
                }
            });
        });
    });
});

panel_list[0][0].add(clone_to_right);
panel_list[1][0].add(clone_to_left);
