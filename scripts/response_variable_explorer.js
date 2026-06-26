var state = {
  year: 2024
};

function getAnalysisWindow(year) {
  return {
    start: ee.Date.fromYMD(year, 1, 1),
    end: ee.Date.fromYMD(year + 1, 1, 1),
    label: year + '-01-01 to ' + year + '-12-31'
  };
}

function refreshAnalysis(yearValue) {
  state.year = parseInt(yearValue, 10);

  var window = getAnalysisWindow(state.year);

  Map.layers().reset();
  statusLabel.setValue(
    'Ready to explore response variables for ' +
    state.year +
    ' (' +
    window.label +
    ').'
  );
}

function handleYearChange(value) {
  refreshAnalysis(value);
}

var controlPanel = ui.Panel({
  style: {
    width: '320px',
    padding: '12px'
  }
});

var titleLabel = ui.Label({
  value: 'Response Variable Explorer',
  style: {
    fontWeight: 'bold',
    fontSize: '18px',
    margin: '0 0 8px 0'
  }
});

var introLabel = ui.Label({
  value: 'Set the year for annual response-variable summaries.',
  style: {
    margin: '0 0 12px 0'
  }
});

var yearInput = ui.Textbox({
  placeholder: 'YYYY',
  value: String(state.year),
  onChange: handleYearChange,
  style: {
    stretch: 'horizontal'
  }
});

var statusLabel = ui.Label({
  value: '',
  style: {
    margin: '12px 0 0 0',
    color: '#555'
  }
});

controlPanel.add(titleLabel);
controlPanel.add(introLabel);
controlPanel.add(ui.Label('Year'));
controlPanel.add(yearInput);
controlPanel.add(statusLabel);

ui.root.insert(0, controlPanel);
Map.setOptions('SATELLITE');
Map.setCenter(0, 15, 2);

refreshAnalysis(yearInput.getValue());
