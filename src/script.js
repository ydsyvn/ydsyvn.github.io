// Wrap in an IFFE (Immediately Invoked Function Expression) to avoid polluting global scope
(function () {
  "use strict"; // Enable strict mode

  // --- Global State ---
  const state = {
    holdsData: null, // Holds library { image_dimensions, holds: [...] }
    boulders: [], // Array of saved boulder objects
    currentBoulder: null, // The boulder currently being edited/viewed { id, name, ..., moves: [{hold_id, move_number}], start_holds:[], finish_holds:[] }
    selectedHoldId: null, // The ID of the visually selected hold
    viewBox: { x: 0, y: 0, width: 800, height: 600 }, // Default/Initial SVG viewBox
    panzoomInstance: null, // To store the panzoom library instance
    isDataLoaded: false, // Flag to track if holds data is loaded
  };

  // --- DOM Element Cache ---
  const elements = {
    wallSvg: document.getElementById("wall-svg"),
    clickTargetsLayer: document.getElementById("click-targets-layer"), // For invisible click zones
    visibleHoldsLayer: document.getElementById("visible-holds-layer"), // For visible polygons
    sequenceLayer: document.getElementById("sequence-layer"),
    wallContainer: document.getElementById("wall-container"),
    backgroundImage: document.getElementById("wall-background-image"), // SVG image element
    boulderNameInput: document.getElementById("boulder-name"),
    boulderGradeSelect: document.getElementById("boulder-grade"),
    boulderStyleSelect: document.getElementById("boulder-style"),
    boulderDescriptionInput: document.getElementById("boulder-description"),
    btnImportBoulders: document.getElementById("btn-import-boulders"),
    btnNewBoulder: document.getElementById("btn-new-boulder"),
    btnSaveBoulder: document.getElementById("btn-save-boulder"),
    btnExportAll: document.getElementById("btn-export-all"),
    btnMarkStart: document.getElementById("btn-mark-start"),
    btnMarkFinish: document.getElementById("btn-mark-finish"),
    btnRemoveHold: document.getElementById("btn-remove-hold"),
    btnResetView: document.getElementById("btn-reset-view"),
    boulderItems: document.getElementById("boulder-items"),
    boulderCountSpan: document.getElementById("boulder-count"),
    importFileInput: document.getElementById("import-file-input"),
    toast: document.getElementById("toast"),
    boulderInfoPanel: document.getElementById("boulder-info"),
    holdActionsPanel: document.getElementById("hold-actions"),
    selectedHoldInfo: document.getElementById("selected-hold-info"),
  };

  // --- Constants ---
  // Path relative to the HTML file (src/index.html)
  const ANNOTATIONS_URL = "../full_annotations.json";

  // --- Initialization ---
  async function init() {
    attachEventListeners();
    loadBouldersFromStorage(); // Load saved boulders first
    createNewBoulder(); // Set up initial state structure
    updateUI(); // Update UI before loading data
    await loadHoldsDataFromUrl(ANNOTATIONS_URL); // Attempt to load data automatically
    // Final UI update after potential data load
    updateUI();
  }

  // --- Holds Data Loading & Rendering ---

  async function loadHoldsDataFromUrl(url) {
    showToast("Loading holds data...", 2000);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `HTTP error! status: ${response.status} - ${response.statusText}`
        );
      }
      const data = await response.json();

      // Validation
      if (!data.holds || !data.image_dimensions || !Array.isArray(data.holds)) {
        throw new Error(
          'Invalid holds data format. Required: "image_dimensions", "holds" (array).'
        );
      }

      processLoadedHoldsData(data);
      showToast("Holds data loaded successfully", 2000);
    } catch (error) {
      console.error("Error fetching or parsing holds JSON:", error);
      showToast(
        `Error loading holds data: ${error.message}. Check file path and format.`,
        6000
      );
      state.holdsData = null; // Reset state on error
      state.isDataLoaded = false;
      clearAllSvgLayers(); // Clear everything if load fails
      if (state.panzoomInstance) state.panzoomInstance.destroy();
      state.panzoomInstance = null;
      // Display error message in boulder list area
      elements.boulderItems.innerHTML =
        '<p style="color: red;">Failed to load holds data. Please check console.</p>';
    } finally {
      updateUI(); // Final UI update
    }
  }

  // Common logic for processing loaded holds data
  function processLoadedHoldsData(data) {
    state.holdsData = data;
    state.isDataLoaded = true;

    // Update SVG viewBox based on loaded data
    const dims = state.holdsData.image_dimensions;
    state.viewBox = {
      x: 0,
      y: 0,
      width: dims.width || 800,
      height: dims.height || 600,
    };
    elements.wallSvg.setAttribute(
      "viewBox",
      `0 0 ${state.viewBox.width} ${state.viewBox.height}`
    );

    // Render the invisible click targets based on bounding boxes
    renderClickTargets();
    // Render visible polygons only for the current boulder/selection (initially none)
    updateVisibleHolds();
    // Render sequence markers (initially none)
    renderSequence();

    // Initialize panzoom AFTER SVG dimensions are set
    initPanzoom();

    // Reset to a new boulder state after loading holds
    createNewBoulder();
  }

  // Renders ONLY the invisible click target rectangles based on bounding boxes
  function renderClickTargets() {
    clearLayer(elements.clickTargetsLayer); // Clear previous targets
    if (!state.isDataLoaded) return;

    const fragment = document.createDocumentFragment();
    state.holdsData.holds.forEach((hold) => {
      // Requires bounding_box data for click targets
      if (!hold.bounding_box) {
        console.warn(
          `Hold ${hold.id} missing bounding_box, cannot create click target.`
        );
        return;
      }
      const bbox = hold.bounding_box;
      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect"
      );
      rect.setAttribute("x", bbox.x - bbox.width / 2);
      rect.setAttribute("y", bbox.y - bbox.height / 2);
      rect.setAttribute("width", bbox.width);
      rect.setAttribute("height", bbox.height);
      rect.setAttribute("class", "hold-click-target"); // Style targets as invisible
      rect.setAttribute("data-id", hold.id); // Store ID for click handling

      // Attach click listener to the invisible target
      rect.addEventListener("click", (e) => {
        e.stopPropagation(); // Prevent event bubbling
        handleHoldClick(hold.id); // Handle the click using the hold's ID
      });
      fragment.appendChild(rect);
    });
    elements.clickTargetsLayer.appendChild(fragment);
  }

  // Renders VISIBLE polygons ONLY for relevant holds (selected + in current boulder)
  function updateVisibleHolds() {
    clearLayer(elements.visibleHoldsLayer); // Clear previously visible holds
    if (!state.isDataLoaded) return;

    const visibleHoldIds = new Set();

    // Add holds from the current boulder
    if (state.currentBoulder) {
      state.currentBoulder.moves.forEach((move) =>
        visibleHoldIds.add(move.hold_id)
      );
      // Include start/finish holds explicitly
      state.currentBoulder.start_holds.forEach((id) => visibleHoldIds.add(id));
      state.currentBoulder.finish_holds.forEach((id) => visibleHoldIds.add(id));
    }

    // Add the currently selected hold (even if not in boulder yet)
    if (state.selectedHoldId) {
      visibleHoldIds.add(state.selectedHoldId);
    }

    const fragment = document.createDocumentFragment();
    visibleHoldIds.forEach((holdId) => {
      const holdData = state.holdsData.holds.find((h) => h.id === holdId);
      if (holdData) {
        try {
          // Create the visible polygon element using segmentation data
          const polygon = createVisibleHoldPolygon(holdData);

          // Apply selection class if this is the currently selected hold
          if (holdId === state.selectedHoldId) {
            polygon.classList.add("selected");
          }
          // Add in-boulder class for potential distinct styling
          if (
            state.currentBoulder &&
            state.currentBoulder.moves.some((m) => m.hold_id === holdId)
          ) {
            polygon.classList.add("in-boulder");
          }

          fragment.appendChild(polygon);
        } catch (error) {
          // Log error if a specific visible polygon fails to render
          console.warn(
            `Skipping visible hold polygon ${holdId}: ${error.message}`
          );
        }
      }
    });
    elements.visibleHoldsLayer.appendChild(fragment); // Add all visible polygons at once
  }

  // Creates just the visible polygon SVG element for a given hold's data
  function createVisibleHoldPolygon(hold) {
    const polygon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polygon"
    );
    polygon.setAttribute("class", "visible-hold-polygon"); // Apply specific class for styling
    polygon.setAttribute("data-id", hold.id); // Store ID if needed

    // Validate segmentation data
    if (
      !hold.segmentation ||
      !Array.isArray(hold.segmentation) ||
      hold.segmentation.length < 3
    ) {
      throw new Error(`Invalid segmentation data for hold ${hold.id}`);
    }
    // Convert points array to SVG points string
    const points = hold.segmentation
      .map((point) => {
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          typeof point[0] !== "number" ||
          typeof point[1] !== "number"
        ) {
          throw new Error(
            `Invalid point format in segmentation for hold ${hold.id}`
          );
        }
        return point.join(",");
      })
      .join(" ");

    polygon.setAttribute("points", points);
    polygon.setAttribute("fill", getHoldColor(hold.hold_type)); // Set fill color based on type

    // Add click listener *also* to the visible polygon
    // This handles cases where the polygon might slightly obscure the target rectangle
    polygon.addEventListener("click", (e) => {
      e.stopPropagation();
      handleHoldClick(hold.id);
    });

    return polygon;
  }

  // Utility to clear all child elements from an SVG layer
  function clearLayer(layerElement) {
    if (layerElement) {
      while (layerElement.firstChild) {
        layerElement.removeChild(layerElement.firstChild);
      }
    }
  }
  // Utility to clear all dynamic SVG layers
  function clearAllSvgLayers() {
    clearLayer(elements.clickTargetsLayer);
    clearLayer(elements.visibleHoldsLayer);
    clearLayer(elements.sequenceLayer);
  }

  // Get color based on hold type (used for visible polygons)
  function getHoldColor(type) {
    const typeLower = type?.toLowerCase() || "other";
    switch (typeLower) {
      case "jug":
        return "#4CAF50"; // Base color; opacity set in CSS
      case "crimp":
        return "#F44336";
      case "sloper":
        return "#2196F3";
      case "pinch":
        return "#FF9800";
      default:
        return "#9C27B0"; // Other/Unknown
    }
  }

  // --- Pan & Zoom (using panzoom library) ---
  function initPanzoom() {
    if (state.panzoomInstance) {
      state.panzoomInstance.destroy(); // Clean up previous instance if reloading
    }
    if (!elements.wallContainer || !elements.wallSvg) {
      console.error("Panzoom target elements not found");
      return;
    }

    // Panzoom targets the main SVG element
    const panzoomTarget = elements.wallSvg;

    try {
      state.panzoomInstance = Panzoom(panzoomTarget, {
        maxScale: 10, // Max zoom level
        minScale: 0.1, // Min zoom level (adjust as needed)
        contain: "outside", // Allow slight panning beyond initial bounds
        canvas: true, // Optimize SVG rendering performance
        excludeClass: "panzoom-exclude", // Add to elements never handled by panzoom
        // Filter mouse clicks to allow selection without starting pan
        filterMouseButton: function (event) {
          const targetElement = event.target;
          // Check if click is on an interactive element (target or visible polygon)
          const isInteractiveHold =
            targetElement.classList.contains("hold-click-target") ||
            targetElement.classList.contains("visible-hold-polygon");
          // Block pan start ONLY if it's a left click AND NOT on an interactive hold element
          return event.button !== 0 || isInteractiveHold;
        },
        // Prevent default touch actions (like scrolling) when interacting with SVG
        handleStartEvent: (e) => {
          if (e.touches) e.preventDefault();
        },
      });

      // Enable zooming with mouse wheel / trackpad pinch
      elements.wallContainer.addEventListener(
        "wheel",
        (event) => {
          if (!state.panzoomInstance || !state.isDataLoaded) return;
          event.preventDefault(); // Prevent page scrolling
          state.panzoomInstance.zoomWithWheel(event);
        },
        { passive: false }
      ); // Need passive: false to allow preventDefault

      // Attach reset view button listener
      elements.btnResetView.addEventListener("click", resetView);

      // Set initial view (centered and scaled to fit)
      resetView();
    } catch (error) {
      console.error("Failed to initialize Panzoom:", error);
      showToast("Error initializing zoom/pan.", 4000);
    }
  }

  // Resets the SVG view to be centered and fit within the container
  function resetView() {
    if (state.panzoomInstance && state.isDataLoaded) {
      // Get container dimensions
      const containerRect = elements.wallContainer.getBoundingClientRect();
      // Get SVG intrinsic dimensions from viewBox
      const svgWidth = state.viewBox.width;
      const svgHeight = state.viewBox.height;

      // Calculate scale needed to fit the SVG within the container
      const scale = Math.min(
        containerRect.width / svgWidth,
        containerRect.height / svgHeight
      );

      // Calculate translation needed to center the scaled SVG
      const targetX = (containerRect.width - svgWidth * scale) / 2;
      const targetY = (containerRect.height - svgHeight * scale) / 2;

      // Apply reset, zoom, and pan without animation for immediate effect
      state.panzoomInstance.reset(); // Clear previous transforms first
      state.panzoomInstance.zoom(scale, { animate: false });
      // Pan to the calculated absolute top-left position
      state.panzoomInstance.pan(targetX, targetY, {
        animate: false,
        relative: false,
      });

      // showToast("View Reset", 1500); // Optional: Feedback can be annoying if clicked often
    }
  }

  // --- Boulder Management ---

  // Load boulders from browser's local storage
  function loadBouldersFromStorage() {
    try {
      const savedBoulders = localStorage.getItem("boulderApp_boulders");
      state.boulders = savedBoulders ? JSON.parse(savedBoulders) : [];
    } catch (error) {
      console.error("Error loading boulders from localStorage:", error);
      state.boulders = [];
      showToast(
        "Could not load saved boulders. Storage might be corrupt.",
        4000
      );
    }
    renderBoulderList(); // Update the list display
  }

  // Save the current list of boulders to local storage
  function saveBouldersToStorage() {
    try {
      localStorage.setItem(
        "boulderApp_boulders",
        JSON.stringify(state.boulders)
      );
    } catch (error) {
      console.error("Error saving boulders to localStorage:", error);
      showToast("Error saving boulders: Storage might be full.", 5000);
    }
  }

  // Initialize a new, empty boulder object in the state
  function createNewBoulder() {
    deselectHold(); // Deselect any active hold first

    state.currentBoulder = {
      id: `b-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`, // Unique ID
      name: "",
      grade: "V4",
      style: "Technical",
      description: "", // Defaults
      moves: [],
      start_holds: [],
      finish_holds: [], // Empty arrays
    };

    // Reset input fields
    elements.boulderNameInput.value = "";
    elements.boulderGradeSelect.value = state.currentBoulder.grade;
    elements.boulderStyleSelect.value = state.currentBoulder.style;
    elements.boulderDescriptionInput.value = "";

    // Update SVG state only if holds data is loaded
    if (state.isDataLoaded) {
      updateVisibleHolds(); // Show no holds for the new boulder
      renderSequence(); // Clear sequence markers
    }
    renderBoulderList(); // Update list highlighting
    updateUI(); // Update button states
    console.log("Created new boulder:", state.currentBoulder.id);
  }

  // Save the currently edited boulder to the state list and local storage
  function saveCurrentBoulder() {
    if (!state.currentBoulder || !state.isDataLoaded) {
      showToast(
        "Cannot save: Load holds data and start a boulder first.",
        3000
      );
      return;
    }
    // Update boulder properties from input fields
    state.currentBoulder.name =
      elements.boulderNameInput.value.trim() ||
      `Unnamed ${state.currentBoulder.id.slice(-4)}`;
    state.currentBoulder.grade = elements.boulderGradeSelect.value;
    state.currentBoulder.style = elements.boulderStyleSelect.value;
    state.currentBoulder.description =
      elements.boulderDescriptionInput.value.trim();

    // Validation checks
    if (state.currentBoulder.moves.length === 0)
      return showToast("Cannot save: Add holds to the boulder.", 3000);
    if (state.currentBoulder.start_holds.length === 0)
      return showToast("Cannot save: Mark Start hold(s).", 3000);
    if (state.currentBoulder.finish_holds.length === 0)
      return showToast("Cannot save: Mark Finish hold(s).", 3000);

    // Create a deep copy to save (prevents issues with references)
    const boulderToSave = JSON.parse(JSON.stringify(state.currentBoulder));
    // Find if boulder already exists in the list
    const existingIndex = state.boulders.findIndex(
      (b) => b.id === boulderToSave.id
    );

    if (existingIndex >= 0) {
      // Update existing boulder
      state.boulders[existingIndex] = boulderToSave;
      showToast(`Boulder "${boulderToSave.name}" updated.`, 2000);
    } else {
      // Add new boulder
      state.boulders.push(boulderToSave);
      showToast(`Boulder "${boulderToSave.name}" saved.`, 2000);
    }

    saveBouldersToStorage(); // Persist changes
    renderBoulderList(); // Update the list display
    updateUI(); // Update button states (e.g., disable save until changed again)
  }

  // Load a saved boulder into the editor state
  function loadBoulder(boulderId) {
    const boulderToLoad = state.boulders.find((b) => b.id === boulderId);
    if (!boulderToLoad || !state.isDataLoaded) {
      return showToast(
        "Cannot load: Boulder not found or holds data missing.",
        3000
      );
    }

    deselectHold(); // Clear any current selection before loading

    // Load a deep copy into the current editing state
    state.currentBoulder = JSON.parse(JSON.stringify(boulderToLoad));

    // Update input fields to match the loaded boulder
    elements.boulderNameInput.value = state.currentBoulder.name;
    elements.boulderGradeSelect.value = state.currentBoulder.grade;
    elements.boulderStyleSelect.value = state.currentBoulder.style;
    elements.boulderDescriptionInput.value =
      state.currentBoulder.description || "";

    // Update the visual representation on the wall
    updateVisibleHolds(); // Show holds for the loaded boulder
    renderSequence(); // Show sequence markers for the loaded boulder
    renderBoulderList(); // Highlight the loaded boulder in the list
    updateUI(); // Update button states
    showToast(`Loaded: ${state.currentBoulder.name}`, 2000);
  }

  // Delete a boulder from the list and local storage
  function deleteBoulder(boulderId) {
    const boulderIndex = state.boulders.findIndex((b) => b.id === boulderId);
    if (boulderIndex === -1) return; // Boulder not found

    const boulderName = state.boulders[boulderIndex].name || "Unnamed Boulder";
    // Confirmation dialog
    if (confirm(`Delete boulder "${boulderName}"?\nThis cannot be undone.`)) {
      const deletedBoulderId = state.boulders[boulderIndex].id;
      state.boulders.splice(boulderIndex, 1); // Remove from the array

      // If the deleted boulder was the one being edited, start a new one
      if (
        state.currentBoulder &&
        state.currentBoulder.id === deletedBoulderId
      ) {
        createNewBoulder(); // This handles UI updates correctly
      } else {
        // Otherwise, just update the list and UI
        renderBoulderList();
        updateUI();
      }
      saveBouldersToStorage(); // Save the changes
      showToast(`Boulder "${boulderName}" deleted.`, 2000);
    }
  }

  // --- Import / Export ---

  // Handles 'ordered_holds' from JSON and converts to internal 'moves' structure
  function importBouldersFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        // Basic validation of imported structure
        if (!data || !Array.isArray(data.boulders)) {
          throw new Error(
            'Invalid import file format. Expected JSON with a "boulders" array.'
          );
        }

        let importedCount = 0;
        let skippedCount = 0;
        const currentBoulderIds = new Set(state.boulders.map((b) => b.id));

        data.boulders.forEach((importedBoulder) => {
          // Validate the imported boulder structure based on the JSON format
          if (
            importedBoulder &&
            importedBoulder.id &&
            Array.isArray(importedBoulder.ordered_holds) &&
            Array.isArray(importedBoulder.start_holds) &&
            Array.isArray(importedBoulder.finish_holds)
          ) {
            if (!currentBoulderIds.has(importedBoulder.id)) {
              // Convert 'ordered_holds' array into the internal 'moves' array format
              const internalMoves = importedBoulder.ordered_holds.map(
                (holdId, index) => ({
                  hold_id: holdId,
                  move_number: index + 1, // Move numbers are 1-based
                })
              );

              // Create the boulder object in the format expected by the internal state
              const boulderForState = {
                id: importedBoulder.id,
                name: importedBoulder.name || "Unnamed Imported",
                grade: importedBoulder.grade || "V?",
                style: importedBoulder.style || "Other",
                description: importedBoulder.description || "",
                start_holds: importedBoulder.start_holds,
                finish_holds: importedBoulder.finish_holds,
                moves: internalMoves, // Use the transformed moves array
              };

              state.boulders.push(boulderForState); // Add the transformed object
              currentBoulderIds.add(importedBoulder.id);
              importedCount++;
            } else {
              skippedCount++;
            } // Skip duplicates
          } else {
            console.warn(
              "Skipping invalid boulder structure during import:",
              importedBoulder
            );
            skippedCount++; // Skip invalid format
          }
        });

        if (importedCount > 0) {
          saveBouldersToStorage(); // Save the updated list
          renderBoulderList(); // Refresh the display
          updateUI(); // Update buttons
        }
        showToast(
          `Imported ${importedCount} boulders. Skipped ${skippedCount} (duplicates/invalid).`,
          4000
        );
      } catch (error) {
        console.error("Error parsing import JSON:", error);
        showToast(`Import error: ${error.message}`, 5000);
      }
    };
    reader.onerror = () =>
      showToast(`Error reading import file: ${reader.error}`, 5000);
    reader.readAsText(file);
  }

  // Exports all boulders currently in the state to a JSON file
  function exportAllBoulders() {
    if (!state.isDataLoaded)
      return showToast("Cannot export: Holds data not loaded.", 3000);
    if (state.boulders.length === 0)
      return showToast("No boulders saved to export.", 3000);

    // Create the export structure (without the full holds library)
    const exportData = {
      wall_info: {
        // Include wall dimensions for context
        dimensions: state.holdsData.image_dimensions,
      },
      boulders: state.boulders.map((boulder) => ({
        // Map internal state to export format
        id: boulder.id,
        name: boulder.name,
        grade: boulder.grade,
        style: boulder.style,
        description: boulder.description,
        start_holds: boulder.start_holds,
        finish_holds: boulder.finish_holds,
        // Convert internal 'moves' back to 'ordered_holds' for export consistency
        ordered_holds: boulder.moves
          .sort((a, b) => a.move_number - b.move_number) // Ensure order
          .map((m) => m.hold_id), // Extract just the IDs
      })),
    };

    // Create and trigger download
    try {
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `boulder_export_${
        new Date().toISOString().split("T")[0]
      }.json`; // Dated filename
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Exported ${state.boulders.length} boulders.`, 2500);
    } catch (error) {
      console.error("Export failed:", error);
      showToast("Failed to export boulders.", 4000);
    }
  }

  // --- Hold Interaction ---

  // Central handler for clicks on hold targets or visible polygons
  function handleHoldClick(holdId) {
    if (!state.currentBoulder || !state.isDataLoaded) return; // Ignore clicks if not ready

    const isAlreadyInBoulder = state.currentBoulder.moves.some(
      (m) => m.hold_id === holdId
    );
    const isSelected = state.selectedHoldId === holdId;

    if (isSelected) {
      deselectHold(); // Clicked selected hold: deselect
    } else {
      selectHold(holdId); // Clicked unselected hold: select it
      // If selecting it didn't make it part of the boulder, add it now
      if (!isAlreadyInBoulder) {
        addHoldToBoulder(holdId); // This will also update visible holds
      }
    }
    // UI updates are handled within select/deselect/add functions
  }

  // Selects a hold, updates state and visuals
  function selectHold(holdId) {
    if (state.selectedHoldId === holdId) return; // No change if already selected

    // Deselect previous visually (handled within updateVisibleHolds now)
    // if (state.selectedHoldId) { ... } // No longer needed here

    state.selectedHoldId = holdId; // Update state

    // Update the info display panel
    const holdData = state.holdsData?.holds.find((h) => h.id === holdId);
    elements.selectedHoldInfo.textContent = holdData
      ? `Selected: ID ${holdData.id} (${holdData.hold_type || "N/A"})`
      : `Selected: ID ${holdId}`;

    // Update which holds are visible and apply the 'selected' class
    updateVisibleHolds();
    // Re-render sequence? Usually not necessary on select, but safe
    // renderSequence();
    updateUI(); // Update button states
  }

  // Deselects the currently selected hold
  function deselectHold() {
    if (!state.selectedHoldId) return; // No change if nothing selected

    state.selectedHoldId = null; // Clear state
    elements.selectedHoldInfo.textContent = "Selected Hold: None"; // Update info display

    // Update visible holds - the deselected polygon might disappear
    updateVisibleHolds();
    // renderSequence(); // Sequence doesn't change on deselect
    updateUI(); // Update button states
  }

  // Adds a hold to the current boulder's sequence
  function addHoldToBoulder(holdId) {
    // Prevent adding if no current boulder or already added
    if (
      !state.currentBoulder ||
      state.currentBoulder.moves.some((m) => m.hold_id === holdId)
    )
      return;

    // Determine the next move number
    const nextMoveNumber =
      state.currentBoulder.moves.length > 0
        ? Math.max(...state.currentBoulder.moves.map((m) => m.move_number)) + 1
        : 1;
    // Add to the moves array
    state.currentBoulder.moves.push({
      hold_id: holdId,
      move_number: nextMoveNumber,
    });
    console.log(`Added hold ${holdId} as move ${nextMoveNumber}`);

    // Update visuals: make the polygon visible and render sequence numbers
    updateVisibleHolds();
    renderSequence();
    updateUI(); // Update save button state, etc.
  }

  // Marks the selected hold as a start hold
  function markSelectedAsStart() {
    // Ensure a hold is selected and part of the current boulder
    if (
      !state.selectedHoldId ||
      !state.currentBoulder ||
      !state.currentBoulder.moves.some(
        (m) => m.hold_id === state.selectedHoldId
      )
    )
      return;
    const holdId = state.selectedHoldId;

    // Add to start_holds if not already there
    if (!state.currentBoulder.start_holds.includes(holdId)) {
      state.currentBoulder.start_holds.push(holdId);
    }
    // Remove from finish_holds (a hold can't be both start and finish)
    state.currentBoulder.finish_holds =
      state.currentBoulder.finish_holds.filter((id) => id !== holdId);

    renderSequence(); // Update S/F markers
    showToast(`Hold ${holdId} marked as Start`, 1500);
    updateUI(); // Update save button state if needed
  }

  // Marks the selected hold as a finish hold
  function markSelectedAsFinish() {
    // Ensure a hold is selected and part of the current boulder
    if (
      !state.selectedHoldId ||
      !state.currentBoulder ||
      !state.currentBoulder.moves.some(
        (m) => m.hold_id === state.selectedHoldId
      )
    )
      return;
    const holdId = state.selectedHoldId;

    // Add to finish_holds if not already there
    if (!state.currentBoulder.finish_holds.includes(holdId)) {
      state.currentBoulder.finish_holds.push(holdId);
    }
    // Remove from start_holds
    state.currentBoulder.start_holds = state.currentBoulder.start_holds.filter(
      (id) => id !== holdId
    );

    renderSequence(); // Update S/F markers
    showToast(`Hold ${holdId} marked as Finish`, 1500);
    updateUI();
  }

  // Removes the selected hold from the current boulder sequence
  function removeSelectedHoldFromBoulder() {
    if (!state.selectedHoldId || !state.currentBoulder) return;
    const holdIdToRemove = state.selectedHoldId;

    // Find the move to remove
    const moveIndex = state.currentBoulder.moves.findIndex(
      (move) => move.hold_id === holdIdToRemove
    );
    if (moveIndex === -1) return; // Should not happen if button enabled correctly

    // Remove from arrays
    state.currentBoulder.moves.splice(moveIndex, 1);
    state.currentBoulder.start_holds = state.currentBoulder.start_holds.filter(
      (id) => id !== holdIdToRemove
    );
    state.currentBoulder.finish_holds =
      state.currentBoulder.finish_holds.filter((id) => id !== holdIdToRemove);

    renumberMoves(); // Adjust move numbers of remaining holds
    deselectHold(); // Deselect the hold that was just removed

    // Update visuals (deselectHold calls updateVisibleHolds and updateUI)
    renderSequence(); // Update sequence numbers
    showToast(`Hold ${holdIdToRemove} removed`, 1500);
  }

  // Renumbers moves sequentially after removal
  function renumberMoves() {
    if (!state.currentBoulder) return;
    state.currentBoulder.moves
      .sort((a, b) => a.move_number - b.move_number) // Preserve relative order
      .forEach((move, index) => {
        move.move_number = index + 1; // Assign 1-based index
      });
  }

  // --- UI Updates & Rendering ---

  // Renders Start, Finish, and move number markers
  function renderSequence() {
    clearLayer(elements.sequenceLayer); // Clear existing markers
    if (!state.currentBoulder || !state.isDataLoaded) return;

    const fragment = document.createDocumentFragment();
    // Iterate only over holds currently in the boulder's sequence
    state.currentBoulder.moves.forEach((move) => {
      const hold = state.holdsData.holds.find((h) => h.id === move.hold_id);
      if (!hold || !hold.bounding_box) return; // Skip if hold data is missing

      // Calculate marker position (e.g., slightly above center)
      const bbox = hold.bounding_box;
      const centerX = bbox.x + bbox.width / 2;
      const centerY = bbox.y + bbox.height * 0.3; // Adjust Y pos if needed

      // Determine marker text and class (S, F, S/F, or move number)
      const isStart = state.currentBoulder.start_holds.includes(move.hold_id);
      const isFinish = state.currentBoulder.finish_holds.includes(move.hold_id);
      let markerText = "";
      let markerClass = "sequence-marker";
      if (isStart && isFinish) {
        markerText = "S/F";
        markerClass += " start finish";
      } else if (isStart) {
        markerText = "S";
        markerClass += " start";
      } else if (isFinish) {
        markerText = "F";
        markerClass += " finish";
      } else {
        markerText = move.move_number.toString();
        markerClass += " move";
      }

      // Create and configure the text element
      const textElement = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      textElement.setAttribute("x", centerX);
      textElement.setAttribute("y", centerY);
      textElement.setAttribute("text-anchor", "middle");
      textElement.setAttribute("dominant-baseline", "middle");
      textElement.setAttribute("class", markerClass);
      // Optional dynamic font size based on viewbox
      const fontSize = Math.max(10, Math.min(30, state.viewBox.width / 40));
      textElement.setAttribute("font-size", `${fontSize}px`);
      textElement.textContent = markerText;
      fragment.appendChild(textElement);
    });
    elements.sequenceLayer.appendChild(fragment); // Add all markers at once
  }

  // Renders the list of saved boulders
  function renderBoulderList() {
    elements.boulderItems.innerHTML = ""; // Clear current list
    elements.boulderCountSpan.textContent = state.boulders.length; // Update count

    // Handle empty states based on data loading
    if (!state.isDataLoaded && state.boulders.length === 0) {
      if (elements.boulderItems.innerHTML === "") {
        elements.boulderItems.innerHTML = "<p>Loading holds data...</p>";
      }
      return;
    } else if (state.boulders.length === 0) {
      elements.boulderItems.innerHTML = "<p>No boulders saved yet.</p>";
      return;
    }

    // Create list items for each saved boulder
    const fragment = document.createDocumentFragment();
    state.boulders
      .sort((a, b) => a.name.localeCompare(b.name)) // Sort alphabetically by name
      .forEach((boulder) => {
        const item = document.createElement("div");
        item.className = "boulder-item";
        item.setAttribute("data-boulder-id", boulder.id);
        // Highlight if it's the currently loaded boulder
        item.classList.toggle(
          "boulder-item-active",
          state.currentBoulder && boulder.id === state.currentBoulder.id
        );

        // Boulder info display
        const info = document.createElement("div");
        info.className = "boulder-item-info";
        info.innerHTML = `<strong>${boulder.name || "Unnamed"}</strong><small>${
          boulder.grade
        } | ${boulder.style} | ${boulder.moves?.length || 0} holds</small>`;

        // Action buttons (Load, Delete)
        const actions = document.createElement("div");
        actions.className = "boulder-item-actions";
        const loadBtn = document.createElement("button");
        loadBtn.textContent = "Load";
        loadBtn.className = "secondary";
        loadBtn.onclick = (e) => {
          e.stopPropagation();
          loadBoulder(boulder.id);
        }; // Load on click
        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "danger";
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          deleteBoulder(boulder.id);
        }; // Delete on click

        actions.appendChild(loadBtn);
        actions.appendChild(deleteBtn);
        item.appendChild(info);
        item.appendChild(actions);
        // Allow clicking anywhere on the item to load it
        item.onclick = () => {
          loadBoulder(boulder.id);
        };

        fragment.appendChild(item);
      });
    elements.boulderItems.appendChild(fragment); // Add all items at once
  }

  // Updates the enabled/disabled state of buttons and visibility of panels
  function updateUI() {
    const hasData = state.isDataLoaded;
    const hasCurrent = !!state.currentBoulder;
    const hasSelection = !!state.selectedHoldId;
    // Determine if the selected hold is actually part of the current boulder's moves
    const isHoldInCurrentBoulder =
      hasSelection &&
      hasCurrent &&
      state.currentBoulder.moves.some(
        (m) => m.hold_id === state.selectedHoldId
      );

    // Show/hide main panels based on data loaded state
    elements.boulderInfoPanel.style.display = hasData ? "block" : "none";
    elements.holdActionsPanel.style.display = hasData ? "block" : "none";

    // Enable/disable buttons based on current state
    elements.btnExportAll.disabled = state.boulders.length === 0 || !hasData;
    // Save button requires a valid boulder with start/finish/moves
    elements.btnSaveBoulder.disabled = !(
      hasCurrent &&
      hasData &&
      state.currentBoulder.moves.length > 0 &&
      state.currentBoulder.start_holds.length > 0 &&
      state.currentBoulder.finish_holds.length > 0
    );
    // Hold action buttons require a selected hold that's part of the current boulder
    elements.btnMarkStart.disabled = !isHoldInCurrentBoulder;
    elements.btnMarkFinish.disabled = !isHoldInCurrentBoulder;
    elements.btnRemoveHold.disabled = !isHoldInCurrentBoulder;
    // Pan/zoom reset requires the library instance
    elements.btnResetView.disabled = !state.panzoomInstance;
    // Core actions require data to be loaded
    elements.btnNewBoulder.disabled = !hasData;
    elements.btnImportBoulders.disabled = !hasData;

    // Update highlighting in the boulder list
    elements.boulderItems.querySelectorAll(".boulder-item").forEach((item) => {
      item.classList.toggle(
        "boulder-item-active",
        state.currentBoulder &&
          item.getAttribute("data-boulder-id") === state.currentBoulder.id
      );
    });

    // Update placeholder text in boulder list based on load state and content
    if (
      !hasData &&
      state.boulders.length === 0 &&
      !elements.boulderItems.querySelector('p[style*="color: red"]')
    ) {
      elements.boulderItems.innerHTML = "<p>Loading holds data...</p>";
    } else if (hasData && state.boulders.length === 0) {
      elements.boulderItems.innerHTML =
        "<p>No boulders saved yet. Click holds to start!</p>";
    }
  }

  // --- Toast Notifications ---
  let toastTimeout;
  function showToast(message, duration = 3000) {
    if (!elements.toast) return; // Ensure toast element exists
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(toastTimeout); // Clear existing timer if any
    // Set timer to hide toast after duration
    toastTimeout = setTimeout(() => {
      elements.toast.classList.remove("show");
    }, duration);
  }

  // --- Event Listeners Setup ---
  function attachEventListeners() {
    // Import Boulders Button
    elements.btnImportBoulders.addEventListener("click", () => {
      if (!state.isDataLoaded) return showToast("Load holds data first!", 3000); // Guard
      elements.importFileInput.click(); // Open file dialog
    });
    // Handle file selection for import
    elements.importFileInput.addEventListener("change", (event) => {
      importBouldersFromFile(event.target.files[0]);
      event.target.value = null; // Reset input to allow re-importing same file
    });

    // Core Boulder Actions
    elements.btnNewBoulder.addEventListener("click", createNewBoulder);
    elements.btnSaveBoulder.addEventListener("click", saveCurrentBoulder);
    elements.btnExportAll.addEventListener("click", exportAllBoulders);

    // Selected Hold Actions
    elements.btnMarkStart.addEventListener("click", markSelectedAsStart);
    elements.btnMarkFinish.addEventListener("click", markSelectedAsFinish);
    elements.btnRemoveHold.addEventListener(
      "click",
      removeSelectedHoldFromBoulder
    );

    // Update current boulder details automatically on input change
    elements.boulderNameInput.addEventListener("input", () => {
      if (state.currentBoulder)
        state.currentBoulder.name = elements.boulderNameInput.value;
    });
    elements.boulderGradeSelect.addEventListener("change", () => {
      if (state.currentBoulder)
        state.currentBoulder.grade = elements.boulderGradeSelect.value;
    });
    elements.boulderStyleSelect.addEventListener("change", () => {
      if (state.currentBoulder)
        state.currentBoulder.style = elements.boulderStyleSelect.value;
    });
    elements.boulderDescriptionInput.addEventListener("input", () => {
      if (state.currentBoulder)
        state.currentBoulder.description =
          elements.boulderDescriptionInput.value;
    });

    // Note: Click listeners for holds are added dynamically in renderClickTargets and createVisibleHoldPolygon
    // Note: Pan/zoom listeners are added in initPanzoom
  }

  // --- Start the App ---
  // Wait for the DOM to be fully loaded before initializing
  document.addEventListener("DOMContentLoaded", init);
})(); // Execute the IFFE
