const app = {
  // State
  state: {
    holdsData: null,
    boulders: [],
    currentBoulder: null,
    selectedHolds: new Map(), // holdId -> {type: 'normal'|'start'|'finish', clicks: number}
    viewBox: { x: 0, y: 0, width: 800, height: 600 },
    panzoomInstance: null,
    isDataLoaded: false,
    currentPage: "home",
  },

  // Constants
  ANNOTATIONS_URL: "./full_annotations.json",
  HOLD_TYPES: ["normal", "start", "finish", "none"],

  // Initialize
  async init() {
    this.loadBouldersFromStorage();
    this.updateHomePage();
    await this.loadHoldsData();
    this.attachEventListeners();
  },

  // Page Navigation
  showPage(pageId) {
    document.querySelectorAll(".page").forEach((page) => {
      page.classList.remove("active");
    });
    document.getElementById(`${pageId}-page`).classList.add("active");
    this.state.currentPage = pageId;

    if (pageId === "hold-selection") {
      this.initializeHoldSelection();
    } else if (pageId === "home") {
      this.updateHomePage();
    }
  },

  // Load holds data
  async loadHoldsData() {
    try {
      const response = await fetch(this.ANNOTATIONS_URL);
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      if (!data.holds || !data.image_dimensions) {
        throw new Error("Invalid holds data format");
      }

      this.state.holdsData = data;
      this.state.isDataLoaded = true;

      const dims = data.image_dimensions;
      this.state.viewBox = {
        x: 0,
        y: 0,
        width: dims.width,
        height: dims.height,
      };

      this.updateHomePage();
      this.showToast("Holds data loaded successfully");
    } catch (error) {
      console.error("Error loading holds data:", error);
      this.showToast("Error loading holds data", 5000);
      document.getElementById("boulder-list").innerHTML =
        '<div class="empty-state"><div class="empty-state-text">Failed to load holds data</div></div>';
    }
  },

  // Initialize hold selection page
  initializeHoldSelection() {
    if (!this.state.isDataLoaded) return;

    // Create new boulder
    this.state.currentBoulder = {
      id: `b-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`,
      name: "",
      grade: "V4",
      style: "Technical",
      description: "",
      moves: [],
      start_holds: [],
      finish_holds: [],
    };

    this.state.selectedHolds.clear();

    // Set up SVG
    const svg = document.getElementById("wall-svg");
    svg.setAttribute(
      "viewBox",
      `0 0 ${this.state.viewBox.width} ${this.state.viewBox.height}`
    );

    this.renderClickTargets();
    this.updateVisibleHolds();
    this.updateHoldCounts();

    if (!this.state.panzoomInstance) {
      this.initPanzoom();
    }

    this.resetView();
  },

  // Render click targets
  renderClickTargets() {
    const layer = document.getElementById("click-targets-layer");
    layer.innerHTML = "";

    this.state.holdsData.holds.forEach((hold) => {
      if (!hold.bounding_box) return;

      const bbox = hold.bounding_box;
      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect"
      );
      rect.setAttribute("x", bbox.x - bbox.width / 2);
      rect.setAttribute("y", bbox.y - bbox.height / 2);
      rect.setAttribute("width", bbox.width);
      rect.setAttribute("height", bbox.height);
      rect.setAttribute("class", "hold-click-target");
      rect.setAttribute("data-id", hold.id);

      rect.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleHoldClick(hold.id);
      });

      layer.appendChild(rect);
    });
  },

  // Handle hold clicks with cycling through states
  handleHoldClick(holdId) {
    let holdState = this.state.selectedHolds.get(holdId) || {
      type: "none",
      clicks: 0,
    };
    holdState.clicks = (holdState.clicks + 1) % 4;

    // Cycle through: none -> normal -> start -> finish -> none
    const types = ["none", "normal", "start", "finish"];
    holdState.type = types[holdState.clicks];

    if (holdState.type === "none") {
      this.state.selectedHolds.delete(holdId);
    } else {
      this.state.selectedHolds.set(holdId, holdState);
    }

    this.updateVisibleHolds();
    this.updateHoldCounts();
    this.updateNextButton();
  },

  // Update visible holds
  updateVisibleHolds() {
    const layer = document.getElementById("visible-holds-layer");
    layer.innerHTML = "";

    this.state.selectedHolds.forEach((holdState, holdId) => {
      const holdData = this.state.holdsData.holds.find((h) => h.id === holdId);
      if (!holdData || !holdData.segmentation) return;

      const polygon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polygon"
      );
      const points = holdData.segmentation
        .map((point) => point.join(","))
        .join(" ");

      polygon.setAttribute("points", points);
      polygon.setAttribute("class", `visible-hold-polygon ${holdState.type}`);
      polygon.setAttribute("data-id", holdId);

      polygon.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleHoldClick(holdId);
      });

      layer.appendChild(polygon);
    });

    this.renderSequence();
  },

  // Render sequence markers
  renderSequence() {
    const layer = document.getElementById("sequence-layer");
    layer.innerHTML = "";

    let moveNumber = 1;
    this.state.selectedHolds.forEach((holdState, holdId) => {
      const hold = this.state.holdsData.holds.find((h) => h.id === holdId);
      if (!hold || !hold.bounding_box) return;

      const bbox = hold.bounding_box;
      const text = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      text.setAttribute("x", bbox.x);
      text.setAttribute("y", bbox.y);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("class", "sequence-marker");

      if (holdState.type === "start") {
        text.textContent = "S";
      } else if (holdState.type === "finish") {
        text.textContent = "F";
      } else if (holdState.type === "normal") {
        text.textContent = moveNumber++;
      }

      layer.appendChild(text);
    });
  },

  // Update hold counts
  updateHoldCounts() {
    let normal = 0,
      start = 0,
      finish = 0;

    this.state.selectedHolds.forEach((holdState) => {
      if (holdState.type === "normal") normal++;
      else if (holdState.type === "start") start++;
      else if (holdState.type === "finish") finish++;
    });

    document.getElementById("normal-count").textContent = normal;
    document.getElementById("start-count").textContent = start;
    document.getElementById("finish-count").textContent = finish;
  },

  // Update next button state
  updateNextButton() {
    const hasStart = Array.from(this.state.selectedHolds.values()).some(
      (h) => h.type === "start"
    );
    const hasFinish = Array.from(this.state.selectedHolds.values()).some(
      (h) => h.type === "finish"
    );
    const hasHolds = this.state.selectedHolds.size > 0;

    const nextButton = document.getElementById("next-button");
    if (hasHolds && hasStart && hasFinish) {
      nextButton.classList.remove("disabled");
    } else {
      nextButton.classList.add("disabled");
    }
  },

  // Initialize panzoom
  initPanzoom() {
    const svg = document.getElementById("wall-svg");
    this.state.panzoomInstance = Panzoom(svg, {
      maxScale: 10,
      minScale: 0.5,
      contain: "outside",
      canvas: true,
      excludeClass: "panzoom-exclude",
      handleStartEvent: (e) => {
        if (e.touches) e.preventDefault();
      },
    });

    const container = document.getElementById("wall-container");
    container.addEventListener(
      "wheel",
      (event) => {
        if (!this.state.panzoomInstance) return;
        event.preventDefault();
        this.state.panzoomInstance.zoomWithWheel(event);
      },
      { passive: false }
    );
  },

  // Reset view
  resetView() {
    if (this.state.panzoomInstance && this.state.isDataLoaded) {
      this.state.panzoomInstance.reset();

      const container = document.getElementById("wall-container");
      const containerRect = container.getBoundingClientRect();
      const svgWidth = this.state.viewBox.width;
      const svgHeight = this.state.viewBox.height;

      const scale =
        Math.min(
          containerRect.width / svgWidth,
          containerRect.height / svgHeight
        ) * 0.9;

      this.state.panzoomInstance.zoom(scale, { animate: false });

      const targetX = (containerRect.width - svgWidth * scale) / 2;
      const targetY = (containerRect.height - svgHeight * scale) / 2;

      this.state.panzoomInstance.pan(targetX, targetY, {
        animate: false,
        relative: false,
      });
    }
  },

  // Cancel boulder creation
  cancelBoulderCreation() {
    if (this.state.selectedHolds.size > 0) {
      if (
        confirm("Are you sure you want to cancel? Your progress will be lost.")
      ) {
        this.showPage("home");
      }
    } else {
      this.showPage("home");
    }
  },

  // Proceed to details
  proceedToDetails() {
    if (!this.state.currentBoulder) return;

    // Convert selected holds to boulder format
    const moves = [];
    const startHolds = [];
    const finishHolds = [];
    let moveNumber = 1;

    this.state.selectedHolds.forEach((holdState, holdId) => {
      if (holdState.type === "start") {
        startHolds.push(holdId);
        moves.push({ hold_id: holdId, move_number: moveNumber++ });
      } else if (holdState.type === "finish") {
        finishHolds.push(holdId);
        moves.push({ hold_id: holdId, move_number: moveNumber++ });
      } else if (holdState.type === "normal") {
        moves.push({ hold_id: holdId, move_number: moveNumber++ });
      }
    });

    this.state.currentBoulder.moves = moves;
    this.state.currentBoulder.start_holds = startHolds;
    this.state.currentBoulder.finish_holds = finishHolds;

    this.showPage("boulder-details");
  },

  // Save boulder
  saveBoulder() {
    if (!this.state.currentBoulder) return;

    // Get form values
    this.state.currentBoulder.name =
      document.getElementById("boulder-name").value.trim() ||
      `Boulder ${this.state.boulders.length + 1}`;
    this.state.currentBoulder.grade =
      document.getElementById("boulder-grade").value;
    this.state.currentBoulder.style =
      document.getElementById("boulder-style").value;
    this.state.currentBoulder.description = document
      .getElementById("boulder-description")
      .value.trim();

    // Add to boulders list
    this.state.boulders.push(this.state.currentBoulder);
    this.saveBouldersToStorage();

    this.showToast(`Boulder "${this.state.currentBoulder.name}" saved!`);
    this.showPage("home");

    // Reset form
    document.getElementById("boulder-name").value = "";
    document.getElementById("boulder-description").value = "";
  },

  // Update home page
  updateHomePage() {
    // Update stats
    document.getElementById("total-boulders").textContent =
      this.state.boulders.length;

    // Count recent boulders (last 7 days)
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentCount = this.state.boulders.filter((b) => {
      const boulderTime = parseInt(b.id.split("-")[1]);
      return boulderTime > weekAgo;
    }).length;
    document.getElementById("recent-count").textContent = recentCount;

    // Update export button
    document.getElementById("export-button").disabled =
      this.state.boulders.length === 0;

    // Render boulder list
    this.renderBoulderList();
  },

  // Render boulder list
  renderBoulderList() {
    const container = document.getElementById("boulder-list");

    if (!this.state.isDataLoaded) {
      container.innerHTML =
        '<div class="loading"><div class="loading-spinner"></div><div>Loading holds data...</div></div>';
      return;
    }

    if (this.state.boulders.length === 0) {
      container.innerHTML = `
                  <div class="empty-state">
                      <div class="empty-state-icon">🧗‍♀️</div>
                      <div class="empty-state-text">No boulders yet.<br>Tap "Set New Boulder" to start!</div>
                  </div>
              `;
      return;
    }

    // Sort by most recent
    const sortedBoulders = [...this.state.boulders].sort((a, b) => {
      const timeA = parseInt(a.id.split("-")[1]);
      const timeB = parseInt(b.id.split("-")[1]);
      return timeB - timeA;
    });

    container.innerHTML = sortedBoulders
      .map(
        (boulder) => `
              <div class="boulder-item" onclick="app.viewBoulder('${boulder.id}')">
                  <div class="boulder-info">
                      <div class="boulder-name">${boulder.name}</div>
                      <div class="boulder-details">${boulder.grade} • ${boulder.style} • ${boulder.moves.length} holds</div>
                  </div>
                  <div class="boulder-actions">
                      <button class="icon-button danger" onclick="event.stopPropagation(); app.deleteBoulder('${boulder.id}')">🗑️</button>
                  </div>
              </div>
          `
      )
      .join("");
  },

  // View boulder (for future enhancement)
  viewBoulder(boulderId) {
    const boulder = this.state.boulders.find((b) => b.id === boulderId);
    if (!boulder) return;

    // For now, just show boulder info
    let info = `${boulder.name}\n`;
    info += `Grade: ${boulder.grade}\n`;
    info += `Style: ${boulder.style}\n`;
    info += `Holds: ${boulder.moves.length}\n`;
    if (boulder.description) {
      info += `\nDescription: ${boulder.description}`;
    }

    alert(info);
  },

  // Delete boulder
  deleteBoulder(boulderId) {
    const boulder = this.state.boulders.find((b) => b.id === boulderId);
    if (!boulder) return;

    if (confirm(`Delete "${boulder.name}"?`)) {
      this.state.boulders = this.state.boulders.filter(
        (b) => b.id !== boulderId
      );
      this.saveBouldersToStorage();
      this.updateHomePage();
      this.showToast("Boulder deleted");
    }
  },

  // Import boulders
  importBoulders() {
    document.getElementById("import-file-input").click();
  },

  // Handle file import
  handleFileImport(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || !Array.isArray(data.boulders)) {
          throw new Error("Invalid file format");
        }

        let imported = 0;
        const existingIds = new Set(this.state.boulders.map((b) => b.id));

        data.boulders.forEach((importedBoulder) => {
          if (
            !existingIds.has(importedBoulder.id) &&
            Array.isArray(importedBoulder.ordered_holds) &&
            Array.isArray(importedBoulder.start_holds) &&
            Array.isArray(importedBoulder.finish_holds)
          ) {
            const moves = importedBoulder.ordered_holds.map(
              (holdId, index) => ({
                hold_id: holdId,
                move_number: index + 1,
              })
            );

            this.state.boulders.push({
              id: importedBoulder.id,
              name: importedBoulder.name || "Imported Boulder",
              grade: importedBoulder.grade || "V?",
              style: importedBoulder.style || "Other",
              description: importedBoulder.description || "",
              moves: moves,
              start_holds: importedBoulder.start_holds,
              finish_holds: importedBoulder.finish_holds,
            });

            imported++;
          }
        });

        if (imported > 0) {
          this.saveBouldersToStorage();
          this.updateHomePage();
          this.showToast(`Imported ${imported} boulders`);
        } else {
          this.showToast("No new boulders to import");
        }
      } catch (error) {
        console.error("Import error:", error);
        this.showToast("Error importing file");
      }
    };
    reader.readAsText(file);
  },

  // Export all boulders
  exportAllBoulders() {
    if (this.state.boulders.length === 0) return;

    const exportData = {
      wall_info: {
        dimensions: this.state.holdsData?.image_dimensions || {},
      },
      boulders: this.state.boulders.map((boulder) => ({
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

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `boulders_${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showToast(`Exported ${this.state.boulders.length} boulders`);
  },

  // Local storage
  loadBouldersFromStorage() {
    try {
      const saved = localStorage.getItem("boulderApp_boulders");
      this.state.boulders = saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error("Error loading from storage:", error);
      this.state.boulders = [];
    }
  },

  saveBouldersToStorage() {
    try {
      localStorage.setItem(
        "boulderApp_boulders",
        JSON.stringify(this.state.boulders)
      );
    } catch (error) {
      console.error("Error saving to storage:", error);
      this.showToast("Error saving data");
    }
  },

  // Toast notifications
  showToast(message, duration = 3000) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
    }, duration);
  },

  // Event listeners
  attachEventListeners() {
    document
      .getElementById("import-file-input")
      .addEventListener("change", (e) => {
        this.handleFileImport(e.target.files[0]);
        e.target.value = "";
      });
  },
};

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => app.init());
