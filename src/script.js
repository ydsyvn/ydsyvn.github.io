// Wrap in an IFFE
(function () {
  "use strict";

  // --- Global State ---
  const state = {
    holdsData: null,
    boulders: [],
    currentBoulder: null,
    selectedHoldId: null,
    viewBox: { x: 0, y: 0, width: 800, height: 600 },
    panzoomInstance: null,
    isDataLoaded: false,
  };

  // --- DOM Element Cache ---
  const elements = {
    wallSvg: document.getElementById("wall-svg"),
    holdsLayer: document.getElementById("holds-layer"),
    sequenceLayer: document.getElementById("sequence-layer"),
    wallContainer: document.getElementById("wall-container"),
    backgroundImage: document.getElementById("wall-background-image"), // Get the image element
    boulderNameInput: document.getElementById("boulder-name"),
    boulderGradeSelect: document.getElementById("boulder-grade"),
    boulderStyleSelect: document.getElementById("boulder-style"),
    boulderDescriptionInput: document.getElementById("boulder-description"),
    // btnLoadData: NO LONGER NEEDED
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
    // holdsFileInput: NO LONGER NEEDED
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
    createNewBoulder(); // Set up initial state
    updateUI(); // Update UI before loading data
    await loadHoldsDataFromUrl(ANNOTATIONS_URL); // Attempt to load data automatically
    // Update UI again after loading attempt
    updateUI();
  }

  // --- Holds Data Loading & Rendering ---

  // NEW: Load holds data from URL using fetch
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

      // Validation (same as before)
      if (!data.holds || !data.image_dimensions || !Array.isArray(data.holds)) {
        throw new Error(
          'Invalid holds data format. Required: "image_dimensions", "holds" (array).'
        );
      }

      processLoadedHoldsData(data); // Use a common processing function
      showToast("Holds data loaded successfully", 2000);
    } catch (error) {
      console.error("Error fetching or parsing holds JSON:", error);
      showToast(
        `Error loading holds data: ${error.message}. Check file path and format.`,
        6000
      );
      state.holdsData = null; // Reset state on error
      state.isDataLoaded = false;
      clearHoldsAndSequence();
      if (state.panzoomInstance) state.panzoomInstance.destroy();
      state.panzoomInstance = null;
      // Display error message in boulder list area
      elements.boulderItems.innerHTML =
        '<p style="color: red;">Failed to load holds data. Please check console.</p>';
    } finally {
      updateUI(); // Final UI update
    }
  }

  // Common logic for processing loaded holds data (from file or URL)
  function processLoadedHoldsData(data) {
    state.holdsData = data;
    state.isDataLoaded = true;

    // Update SVG viewBox
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

    // The SVG <image> element's width/height="100%" should handle scaling relative to the viewBox.
    // No need to set image style width/height explicitly here.

    renderHolds();
    initPanzoom(); // Initialize panzoom AFTER dimensions are set

    // Reset current boulder state as holds context has changed
    createNewBoulder();
  }

  // --- (renderHolds, createHoldElement, clearHoldsAndSequence, getHoldColor functions remain the same) ---
  function renderHolds() {
    clearHoldsAndSequence(); // Clear layers first

    if (!state.isDataLoaded || !state.holdsData.holds) return;

    const fragment = document.createDocumentFragment(); // Use fragment for performance
    state.holdsData.holds.forEach((hold) => {
      try {
        const holdGroup = createHoldElement(hold);
        fragment.appendChild(holdGroup);
      } catch (error) {
        console.warn(
          `Skipping hold ${hold.id} due to rendering error: ${error.message}`
        );
      }
    });
    elements.holdsLayer.appendChild(fragment);

    // Render sequence for the (potentially empty) current boulder
    renderSequence();
    updateHoldAppearance();
  }

  function createHoldElement(hold) {
    const holdGroup = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g"
    );
    holdGroup.setAttribute("id", `hold-${hold.id}`);
    holdGroup.setAttribute("class", "hold");
    holdGroup.setAttribute("data-id", hold.id);

    const polygon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polygon"
    );
    // Validate segmentation data before using
    if (
      !hold.segmentation ||
      !Array.isArray(hold.segmentation) ||
      hold.segmentation.length < 3
    ) {
      throw new Error(`Invalid segmentation data for hold ${hold.id}`);
    }
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
    polygon.setAttribute("fill", getHoldColor(hold.hold_type));

    holdGroup.appendChild(polygon);

    holdGroup.addEventListener("click", (e) => {
      e.stopPropagation();
      handleHoldClick(hold.id);
    });

    return holdGroup;
  }

  function clearHoldsAndSequence() {
    elements.holdsLayer.innerHTML = "";
    elements.sequenceLayer.innerHTML = "";
  }

  function getHoldColor(type) {
    const typeLower = type?.toLowerCase() || "other";
    switch (typeLower) {
      case "jug":
        return "#4CAF50"; // Keep base color, adjust opacity in CSS
      case "crimp":
        return "#F44336";
      case "sloper":
        return "#2196F3";
      case "pinch":
        return "#FF9800";
      default:
        return "#9C27B0";
    }
  }

  // --- Pan & Zoom (using panzoom library) ---
  function initPanzoom() {
    if (state.panzoomInstance) {
      state.panzoomInstance.destroy();
    }
    if (!elements.wallContainer || !elements.wallSvg) {
      console.error("Panzoom target elements not found");
      return;
    }

    // Panzoom targets the SVG element directly now
    const panzoomTarget = elements.wallSvg;

    try {
      state.panzoomInstance = Panzoom(panzoomTarget, {
        maxScale: 10,
        minScale: 0.1, // Adjust minScale as needed
        contain: "outside",
        canvas: true, // Optimize SVG rendering
        // Make sure panzoom doesn't prevent clicks on holds (g elements)
        excludeClass: "panzoom-exclude", // Add this class to elements you *never* want panzoom to handle
        // Filter clicks - allow left clicks to pass through for hold selection
        filterMouseButton: function (event) {
          // Allow clicks on the hold 'g' elements (or their children like polygon)
          // Block pan start ONLY if clicking directly on SVG or background image/rect
          const targetElement = event.target;
          const isHoldClick = targetElement.closest(".hold"); // Check if click is on a hold or its children
          return event.button !== 0 || isHoldClick; // If left button AND NOT hold click, block pan; otherwise allow event
        },
        handleStartEvent: (e) => {
          // Prevent default only for touch to avoid page scroll during pan/zoom
          if (e.touches) e.preventDefault();
        },
      });

      elements.wallContainer.addEventListener(
        "wheel",
        (event) => {
          if (!state.panzoomInstance || !state.isDataLoaded) return;
          // Prevent page scroll while zooming SVG
          event.preventDefault();
          state.panzoomInstance.zoomWithWheel(event);
        },
        { passive: false }
      ); // Need passive: false to preventDefault

      elements.btnResetView.addEventListener("click", resetView);

      // Initial zoom to fit roughly
      // state.panzoomInstance.zoomToFit(elements.wallContainer);
      resetView(); // Start centered and fitted
    } catch (error) {
      console.error("Failed to initialize Panzoom:", error);
      showToast("Error initializing zoom/pan.", 4000);
    }
  }

  function resetView() {
    if (state.panzoomInstance) {
      // Get container dimensions
      const containerRect = elements.wallContainer.getBoundingClientRect();
      // Get SVG intrinsic dimensions from viewBox
      const svgWidth = state.viewBox.width;
      const svgHeight = state.viewBox.height;

      // Calculate scale to fit
      const scale = Math.min(
        containerRect.width / svgWidth,
        containerRect.height / svgHeight
      );

      // Calculate centering translation
      // Pan argument is delta from current top-left, so calculate target top-left and find difference
      const targetX = (containerRect.width - svgWidth * scale) / 2;
      const targetY = (containerRect.height - svgHeight * scale) / 2;

      // Reset and then pan/zoom to calculated values
      state.panzoomInstance.reset(); // Reset first to clear existing transforms
      state.panzoomInstance.zoom(scale, { animate: false });
      state.panzoomInstance.pan(targetX, targetY, {
        animate: false,
        relative: false,
      }); // Pan to absolute target position

      showToast("View Reset", 1500);
    }
  }

  // --- Boulder Management (loadBouldersFromStorage, saveBouldersToStorage, createNewBoulder, saveCurrentBoulder, loadBoulder, deleteBoulder remain largely the same) ---
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
    renderBoulderList();
  }

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

  function createNewBoulder() {
    deselectHold();

    state.currentBoulder = {
      id: `b-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`,
      name: "",
      grade: "V4",
      style: "Technical",
      description: "",
      moves: [],
      start_holds: [],
      finish_holds: [],
    };

    elements.boulderNameInput.value = "";
    elements.boulderGradeSelect.value = state.currentBoulder.grade;
    elements.boulderStyleSelect.value = state.currentBoulder.style;
    elements.boulderDescriptionInput.value = "";

    if (state.isDataLoaded) {
      // Only render if data is present
      renderSequence();
      updateHoldAppearance();
    }
    renderBoulderList();
    updateUI();
    console.log("Created new boulder:", state.currentBoulder.id);
  }

  function saveCurrentBoulder() {
    if (!state.currentBoulder || !state.isDataLoaded) {
      showToast(
        "Cannot save: Load holds data and start a boulder first.",
        3000
      );
      return;
    }
    state.currentBoulder.name =
      elements.boulderNameInput.value.trim() ||
      `Unnamed ${state.currentBoulder.id.slice(-4)}`;
    state.currentBoulder.grade = elements.boulderGradeSelect.value;
    state.currentBoulder.style = elements.boulderStyleSelect.value;
    state.currentBoulder.description =
      elements.boulderDescriptionInput.value.trim();

    if (state.currentBoulder.moves.length === 0)
      return showToast("Cannot save: Add holds.", 3000);
    if (state.currentBoulder.start_holds.length === 0)
      return showToast("Cannot save: Mark Start hold(s).", 3000);
    if (state.currentBoulder.finish_holds.length === 0)
      return showToast("Cannot save: Mark Finish hold(s).", 3000);

    const boulderToSave = JSON.parse(JSON.stringify(state.currentBoulder));
    const existingIndex = state.boulders.findIndex(
      (b) => b.id === boulderToSave.id
    );
    if (existingIndex >= 0) {
      state.boulders[existingIndex] = boulderToSave;
      showToast(`Boulder "${boulderToSave.name}" updated.`, 2000);
    } else {
      state.boulders.push(boulderToSave);
      showToast(`Boulder "${boulderToSave.name}" saved.`, 2000);
    }
    saveBouldersToStorage();
    renderBoulderList();
    updateUI();
  }

  function loadBoulder(boulderId) {
    const boulderToLoad = state.boulders.find((b) => b.id === boulderId);
    if (!boulderToLoad || !state.isDataLoaded) {
      return showToast(
        "Cannot load: Boulder not found or holds data missing.",
        3000
      );
    }
    deselectHold();
    state.currentBoulder = JSON.parse(JSON.stringify(boulderToLoad));
    elements.boulderNameInput.value = state.currentBoulder.name;
    elements.boulderGradeSelect.value = state.currentBoulder.grade;
    elements.boulderStyleSelect.value = state.currentBoulder.style;
    elements.boulderDescriptionInput.value =
      state.currentBoulder.description || "";
    renderSequence();
    updateHoldAppearance();
    renderBoulderList();
    updateUI();
    showToast(`Loaded: ${state.currentBoulder.name}`, 2000);
  }

  function deleteBoulder(boulderId) {
    const boulderIndex = state.boulders.findIndex((b) => b.id === boulderId);
    if (boulderIndex === -1) return;
    const boulderName = state.boulders[boulderIndex].name || "Unnamed Boulder";
    if (confirm(`Delete boulder "${boulderName}"?\nThis cannot be undone.`)) {
      const deletedBoulderId = state.boulders[boulderIndex].id;
      state.boulders.splice(boulderIndex, 1);
      if (
        state.currentBoulder &&
        state.currentBoulder.id === deletedBoulderId
      ) {
        createNewBoulder();
      }
      saveBouldersToStorage();
      renderBoulderList();
      showToast(`Boulder "${boulderName}" deleted.`, 2000);
      updateUI();
    }
  }

  // --- Import / Export ---

  function importBouldersFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        // Validate the overall structure slightly more flexibly
        if (!data || !Array.isArray(data.boulders)) {
          throw new Error(
            'Invalid import file format. Expected JSON with a "boulders" array.'
          );
        }

        let importedCount = 0;
        let skippedCount = 0;
        const currentBoulderIds = new Set(state.boulders.map((b) => b.id));

        data.boulders.forEach((importedBoulder) => {
          // --- Transformation Logic ---
          // Validate the imported boulder structure based on the JSON format
          if (
            importedBoulder &&
            importedBoulder.id &&
            Array.isArray(importedBoulder.ordered_holds) && // Check for ordered_holds array
            Array.isArray(importedBoulder.start_holds) && // Check start_holds
            Array.isArray(importedBoulder.finish_holds) // Check finish_holds
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
                name: importedBoulder.name || "Unnamed Imported", // Use default if name missing
                grade: importedBoulder.grade || "V?", // Use default
                style: importedBoulder.style || "Other", // Use default
                description: importedBoulder.description || "",
                start_holds: importedBoulder.start_holds, // Assume valid array from check above
                finish_holds: importedBoulder.finish_holds, // Assume valid array from check above
                moves: internalMoves, // Use the newly created moves array
              };

              state.boulders.push(boulderForState); // Add the *transformed* boulder object
              currentBoulderIds.add(importedBoulder.id);
              importedCount++;
            } else {
              // Skip if boulder ID already exists
              skippedCount++;
            }
          } else {
            // Log skipped boulders due to invalid structure in the JSON file
            console.warn(
              "Skipping invalid boulder structure during import:",
              importedBoulder
            );
            skippedCount++;
          }
          // --- End Transformation Logic ---
        });

        if (importedCount > 0) {
          saveBouldersToStorage(); // Save the newly merged list
          renderBoulderList(); // Update the displayed list
          updateUI(); // Update button states etc.
        }
        showToast(
          `Imported ${importedCount} boulders. Skipped ${skippedCount} (duplicates or invalid format).`,
          4000
        );
      } catch (error) {
        console.error("Error parsing import JSON:", error);
        showToast(`Import error: ${error.message}`, 5000);
      }
    };
    reader.onerror = () => {
      showToast(`Error reading import file: ${reader.error}`, 5000);
    };
    reader.readAsText(file);
  }

  // UPDATED Export: Removed holds_library
  function exportAllBoulders() {
    if (!state.isDataLoaded)
      return showToast("Cannot export: Holds data not loaded.", 3000);
    if (state.boulders.length === 0)
      return showToast("No boulders saved to export.", 3000);

    // Create the export structure WITHOUT holds_library
    const exportData = {
      wall_info: {
        // Keep wall info for context
        dimensions: state.holdsData.image_dimensions,
      },
      // REMOVED: holds_library: state.holdsData.holds,
      boulders: state.boulders.map((boulder) => ({
        // Keep boulder structure the same
        id: boulder.id,
        name: boulder.name,
        grade: boulder.grade,
        style: boulder.style,
        description: boulder.description,
        start_holds: boulder.start_holds,
        finish_holds: boulder.finish_holds,
        ordered_holds: boulder.moves
          .sort((a, b) => a.move_number - b.move_number)
          .map((m) => m.hold_id),
      })),
    };

    try {
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `boulder_export_${
        new Date().toISOString().split("T")[0]
      }.json`;
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

  // --- Hold Interaction (handleHoldClick, selectHold, deselectHold, addHoldToBoulder, markSelectedAsStart, markSelectedAsFinish, removeSelectedHoldFromBoulder, renumberMoves functions remain the same) ---
  function handleHoldClick(holdId) {
    if (!state.currentBoulder || !state.isDataLoaded) return;
    const isAlreadyInBoulder = state.currentBoulder.moves.some(
      (m) => m.hold_id === holdId
    );
    const isSelected = state.selectedHoldId === holdId;

    if (isSelected) deselectHold();
    else {
      selectHold(holdId);
      if (!isAlreadyInBoulder) addHoldToBoulder(holdId);
    }
    updateUI();
  }

  function selectHold(holdId) {
    deselectHold();
    state.selectedHoldId = holdId;
    const holdElement = document.getElementById(`hold-${holdId}`);
    if (holdElement) holdElement.classList.add("selected");
    const holdData = state.holdsData?.holds.find((h) => h.id === holdId);
    elements.selectedHoldInfo.textContent = holdData
      ? `Selected: ID ${holdData.id} (${holdData.hold_type || "N/A"})`
      : `Selected: ID ${holdId}`;
    updateUI();
  }

  function deselectHold() {
    if (state.selectedHoldId) {
      const holdElement = document.getElementById(
        `hold-${state.selectedHoldId}`
      );
      if (holdElement) holdElement.classList.remove("selected");
    }
    state.selectedHoldId = null;
    elements.selectedHoldInfo.textContent = "Selected Hold: None";
    updateUI();
  }

  function addHoldToBoulder(holdId) {
    if (
      !state.currentBoulder ||
      state.currentBoulder.moves.some((m) => m.hold_id === holdId)
    )
      return;
    const nextMoveNumber =
      state.currentBoulder.moves.length > 0
        ? Math.max(...state.currentBoulder.moves.map((m) => m.move_number)) + 1
        : 1;
    state.currentBoulder.moves.push({
      hold_id: holdId,
      move_number: nextMoveNumber,
    });
    console.log(`Added hold ${holdId} as move ${nextMoveNumber}`);
    renderSequence();
    updateHoldAppearance();
    updateUI();
  }

  function markSelectedAsStart() {
    if (
      !state.selectedHoldId ||
      !state.currentBoulder ||
      !state.currentBoulder.moves.some(
        (m) => m.hold_id === state.selectedHoldId
      )
    )
      return;
    const holdId = state.selectedHoldId;
    if (!state.currentBoulder.start_holds.includes(holdId))
      state.currentBoulder.start_holds.push(holdId);
    state.currentBoulder.finish_holds =
      state.currentBoulder.finish_holds.filter((id) => id !== holdId);
    renderSequence();
    showToast(`Hold ${holdId} marked as Start`, 1500);
    updateUI();
  }

  function markSelectedAsFinish() {
    if (
      !state.selectedHoldId ||
      !state.currentBoulder ||
      !state.currentBoulder.moves.some(
        (m) => m.hold_id === state.selectedHoldId
      )
    )
      return;
    const holdId = state.selectedHoldId;
    if (!state.currentBoulder.finish_holds.includes(holdId))
      state.currentBoulder.finish_holds.push(holdId);
    state.currentBoulder.start_holds = state.currentBoulder.start_holds.filter(
      (id) => id !== holdId
    );
    renderSequence();
    showToast(`Hold ${holdId} marked as Finish`, 1500);
    updateUI();
  }

  function removeSelectedHoldFromBoulder() {
    if (!state.selectedHoldId || !state.currentBoulder) return;
    const holdIdToRemove = state.selectedHoldId;
    const moveIndex = state.currentBoulder.moves.findIndex(
      (move) => move.hold_id === holdIdToRemove
    );
    if (moveIndex === -1) return;
    state.currentBoulder.moves.splice(moveIndex, 1);
    state.currentBoulder.start_holds = state.currentBoulder.start_holds.filter(
      (id) => id !== holdIdToRemove
    );
    state.currentBoulder.finish_holds =
      state.currentBoulder.finish_holds.filter((id) => id !== holdIdToRemove);
    renumberMoves();
    deselectHold(); // Deselect after removal
    renderSequence();
    updateHoldAppearance();
    showToast(`Hold ${holdIdToRemove} removed`, 1500);
    updateUI();
  }

  function renumberMoves() {
    if (!state.currentBoulder) return;
    state.currentBoulder.moves
      .sort((a, b) => a.move_number - b.move_number)
      .forEach((move, index) => (move.move_number = index + 1));
  }

  // --- UI Updates & Rendering (renderSequence, updateHoldAppearance, renderBoulderList, updateUI functions remain the same) ---
  function renderSequence() {
    elements.sequenceLayer.innerHTML = "";
    if (!state.currentBoulder || !state.isDataLoaded) return;
    const fragment = document.createDocumentFragment();
    state.currentBoulder.moves.forEach((move) => {
      const hold = state.holdsData.holds.find((h) => h.id === move.hold_id);
      if (!hold || !hold.bounding_box) return;
      const bbox = hold.bounding_box;
      const centerX = bbox.x + bbox.width / 2;
      const centerY = bbox.y + bbox.height * 0.3; // Adjust Y position
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
      const textElement = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      textElement.setAttribute("x", centerX);
      textElement.setAttribute("y", centerY);
      textElement.setAttribute("text-anchor", "middle");
      textElement.setAttribute("dominant-baseline", "middle");
      textElement.setAttribute("class", markerClass);
      const fontSize = Math.max(10, Math.min(30, state.viewBox.width / 40));
      textElement.setAttribute("font-size", `${fontSize}px`);
      textElement.textContent = markerText;
      fragment.appendChild(textElement);
    });
    elements.sequenceLayer.appendChild(fragment);
  }

  function updateHoldAppearance() {
    if (!state.isDataLoaded) return;
    const holdsInCurrentBoulder = state.currentBoulder
      ? new Set(state.currentBoulder.moves.map((m) => m.hold_id))
      : new Set();
    elements.holdsLayer.querySelectorAll(".hold").forEach((holdElement) => {
      const holdId = holdElement.getAttribute("data-id");
      holdElement.classList.toggle(
        "in-boulder",
        holdsInCurrentBoulder.has(holdId)
      );
      holdElement.classList.toggle(
        "not-in-boulder",
        !holdsInCurrentBoulder.has(holdId)
      );
    });
  }

  function renderBoulderList() {
    elements.boulderItems.innerHTML = "";
    elements.boulderCountSpan.textContent = state.boulders.length;
    if (!state.isDataLoaded && state.boulders.length === 0) {
      // Keep "Loading..." or error message if data hasn't loaded
      if (elements.boulderItems.innerHTML === "") {
        // Avoid overwriting error message
        elements.boulderItems.innerHTML =
          "<p>Load holds data to view/create boulders.</p>";
      }
      return;
    } else if (state.boulders.length === 0) {
      elements.boulderItems.innerHTML = "<p>No boulders saved yet.</p>";
      return;
    }

    const fragment = document.createDocumentFragment();
    state.boulders
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((boulder) => {
        const item = document.createElement("div");
        item.className = "boulder-item";
        item.setAttribute("data-boulder-id", boulder.id);
        item.classList.toggle(
          "boulder-item-active",
          state.currentBoulder && boulder.id === state.currentBoulder.id
        );
        const info = document.createElement("div");
        info.className = "boulder-item-info";
        info.innerHTML = `<strong>${boulder.name || "Unnamed"}</strong><small>${
          boulder.grade
        } | ${boulder.style} | ${boulder.moves?.length || 0} holds</small>`;
        const actions = document.createElement("div");
        actions.className = "boulder-item-actions";
        const loadBtn = document.createElement("button");
        loadBtn.textContent = "Load";
        loadBtn.className = "secondary";
        loadBtn.onclick = (e) => {
          e.stopPropagation();
          loadBoulder(boulder.id);
        };
        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "danger";
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          deleteBoulder(boulder.id);
        };
        actions.appendChild(loadBtn);
        actions.appendChild(deleteBtn);
        item.appendChild(info);
        item.appendChild(actions);
        item.onclick = () => {
          loadBoulder(boulder.id);
        };
        fragment.appendChild(item);
      });
    elements.boulderItems.appendChild(fragment);
  }

  function updateUI() {
    const hasData = state.isDataLoaded;
    const hasCurrent = !!state.currentBoulder;
    const hasSelection = !!state.selectedHoldId;
    const isHoldInCurrentBoulder =
      hasSelection &&
      hasCurrent &&
      state.currentBoulder.moves.some(
        (m) => m.hold_id === state.selectedHoldId
      );

    elements.boulderInfoPanel.style.display = hasData ? "block" : "none";
    elements.holdActionsPanel.style.display = hasData ? "block" : "none";

    elements.btnExportAll.disabled = state.boulders.length === 0 || !hasData; // Also disable if no data
    elements.btnSaveBoulder.disabled = !(
      hasCurrent &&
      hasData &&
      state.currentBoulder.moves.length > 0 &&
      state.currentBoulder.start_holds.length > 0 &&
      state.currentBoulder.finish_holds.length > 0
    );
    elements.btnMarkStart.disabled = !isHoldInCurrentBoulder;
    elements.btnMarkFinish.disabled = !isHoldInCurrentBoulder;
    elements.btnRemoveHold.disabled = !isHoldInCurrentBoulder;
    elements.btnResetView.disabled = !state.panzoomInstance;
    // Disable boulder actions if data not loaded
    elements.btnNewBoulder.disabled = !hasData;
    elements.btnImportBoulders.disabled = !hasData;

    elements.boulderItems.querySelectorAll(".boulder-item").forEach((item) => {
      item.classList.toggle(
        "boulder-item-active",
        state.currentBoulder &&
          item.getAttribute("data-boulder-id") === state.currentBoulder.id
      );
    });

    // Update boulder list placeholder text based on data load state
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
    if (!elements.toast) return; // Guard against race conditions
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      elements.toast.classList.remove("show");
    }, duration);
  }

  // --- Event Listeners Setup ---
  function attachEventListeners() {
    // REMOVED: Load holds button listener

    elements.btnImportBoulders.addEventListener("click", () => {
      if (!state.isDataLoaded) return showToast("Load holds data first!", 3000);
      elements.importFileInput.click();
    });
    elements.importFileInput.addEventListener("change", (event) => {
      importBouldersFromFile(event.target.files[0]);
      event.target.value = null;
    });

    elements.btnNewBoulder.addEventListener("click", createNewBoulder);
    elements.btnSaveBoulder.addEventListener("click", saveCurrentBoulder);
    elements.btnExportAll.addEventListener("click", exportAllBoulders);

    elements.btnMarkStart.addEventListener("click", markSelectedAsStart);
    elements.btnMarkFinish.addEventListener("click", markSelectedAsFinish);
    elements.btnRemoveHold.addEventListener(
      "click",
      removeSelectedHoldFromBoulder
    );

    // Update current boulder details on input change (check if currentBoulder exists)
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
  }

  // --- Start the App ---
  document.addEventListener("DOMContentLoaded", init);
})(); // Execute the IFFE
