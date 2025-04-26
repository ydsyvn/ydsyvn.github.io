// Wrap in an IFFE (Immediately Invoked Function Expression) to avoid polluting global scope
(function() {
    'use strict'; // Enable strict mode

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
        wallSvg: document.getElementById('wall-svg'),
        svgBg: document.getElementById('svg-bg'),
        holdsLayer: document.getElementById('holds-layer'),
        sequenceLayer: document.getElementById('sequence-layer'),
        wallContainer: document.getElementById('wall-container'),
        boulderNameInput: document.getElementById('boulder-name'),
        boulderGradeSelect: document.getElementById('boulder-grade'),
        boulderStyleSelect: document.getElementById('boulder-style'),
        boulderDescriptionInput: document.getElementById('boulder-description'),
        btnLoadData: document.getElementById('btn-load-data'),
        btnImportBoulders: document.getElementById('btn-import-boulders'),
        btnNewBoulder: document.getElementById('btn-new-boulder'),
        btnSaveBoulder: document.getElementById('btn-save-boulder'),
        btnExportAll: document.getElementById('btn-export-all'),
        btnMarkStart: document.getElementById('btn-mark-start'),
        btnMarkFinish: document.getElementById('btn-mark-finish'),
        btnRemoveHold: document.getElementById('btn-remove-hold'),
        btnResetView: document.getElementById('btn-reset-view'),
        boulderItems: document.getElementById('boulder-items'),
        boulderCountSpan: document.getElementById('boulder-count'),
        holdsFileInput: document.getElementById('holds-file-input'),
        importFileInput: document.getElementById('import-file-input'),
        toast: document.getElementById('toast'),
        boulderInfoPanel: document.getElementById('boulder-info'),
        holdActionsPanel: document.getElementById('hold-actions'),
        selectedHoldInfo: document.getElementById('selected-hold-info'),
    };

    // --- Initialization ---
    function init() {
        loadBouldersFromStorage(); // Load saved boulders first
        attachEventListeners();
        createNewBoulder(); // Set up initial state (even if no data loaded)
        updateUI(); // Initial UI state
        showToast('App ready. Load holds data to begin.', 2000);
    }

    // --- Holds Data Loading & Rendering ---
    function loadHoldsDataFromFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.holds || !data.image_dimensions || !Array.isArray(data.holds)) {
                    throw new Error('Invalid holds data format. Required: "image_dimensions", "holds" (array).');
                }
                state.holdsData = data;
                state.isDataLoaded = true;

                // Update SVG viewBox
                const dims = state.holdsData.image_dimensions;
                state.viewBox = { x: 0, y: 0, width: dims.width || 800, height: dims.height || 600 };
                elements.wallSvg.setAttribute('viewBox', `0 0 ${state.viewBox.width} ${state.viewBox.height}`);

                renderHolds();
                initPanzoom(); // Initialize panzoom AFTER dimensions are set and holds rendered

                // Reset current boulder state as holds have changed
                createNewBoulder();
                showToast('Holds data loaded successfully');

            } catch (error) {
                console.error("Error parsing holds JSON:", error);
                showToast(`Error loading holds data: ${error.message}`, 5000);
                state.holdsData = null; // Reset state on error
                state.isDataLoaded = false;
                clearHoldsAndSequence();
                if (state.panzoomInstance) state.panzoomInstance.destroy(); // Clean up panzoom
                state.panzoomInstance = null;
            } finally {
                updateUI(); // Always update UI after attempt
            }
        };
        reader.onerror = function() {
            showToast(`Error reading file: ${reader.error}`, 5000);
            state.holdsData = null;
            state.isDataLoaded = false;
            clearHoldsAndSequence();
            updateUI();
        };
        reader.readAsText(file);
    }

    function renderHolds() {
        clearHoldsAndSequence(); // Clear layers first

        if (!state.isDataLoaded || !state.holdsData.holds) return;

        const fragment = document.createDocumentFragment(); // Use fragment for performance
        state.holdsData.holds.forEach(hold => {
            try {
                const holdGroup = createHoldElement(hold);
                fragment.appendChild(holdGroup);
            } catch (error) {
                 console.warn(`Skipping hold ${hold.id} due to rendering error: ${error.message}`);
            }
        });
        elements.holdsLayer.appendChild(fragment);

        // Render sequence for the (potentially empty) current boulder
        renderSequence();
        updateHoldAppearance();
    }

    function createHoldElement(hold) {
        const holdGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        holdGroup.setAttribute('id', `hold-${hold.id}`);
        holdGroup.setAttribute('class', 'hold');
        holdGroup.setAttribute('data-id', hold.id);

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        // Validate segmentation data before using
        if (!hold.segmentation || !Array.isArray(hold.segmentation) || hold.segmentation.length < 3) {
             throw new Error(`Invalid segmentation data for hold ${hold.id}`);
        }
        const points = hold.segmentation.map(point => {
             if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number') {
                throw new Error(`Invalid point format in segmentation for hold ${hold.id}`);
             }
             return point.join(',');
         }).join(' ');

        polygon.setAttribute('points', points);
        polygon.setAttribute('fill', getHoldColor(hold.hold_type));
        // Stroke width might need adjustment based on viewBox size for visibility
        // polygon.setAttribute('stroke-width', state.viewBox.width / 800); // Example scaling

        holdGroup.appendChild(polygon);

        // Click listener - use 'click' which libraries usually handle well
        holdGroup.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering panzoom drag potentially
            handleHoldClick(hold.id);
        });
        // Add touchstart for faster response on mobile, but ensure panzoom doesn't block it
        // holdGroup.addEventListener('touchstart', (e) => {
        //      e.stopPropagation();
        //      handleHoldClick(hold.id);
        // }, { passive: true }); // Passive if not needing preventDefault


        return holdGroup;
    }

    function clearHoldsAndSequence() {
        elements.holdsLayer.innerHTML = '';
        elements.sequenceLayer.innerHTML = '';
    }

    function getHoldColor(type) {
        const typeLower = type?.toLowerCase() || 'other';
        switch (typeLower) {
            case 'jug': return '#4CAF50B3'; // Green
            case 'crimp': return '#F44336B3'; // Red
            case 'sloper': return '#2196F3B3'; // Blue
            case 'pinch': return '#FF9800B3'; // Orange
            default: return '#9C27B0B3'; // Purple (Other)
        }
    }

    // --- Pan & Zoom (using panzoom library) ---
    function initPanzoom() {
        if (state.panzoomInstance) {
            state.panzoomInstance.destroy(); // Destroy existing if reloading data
        }
         if (!elements.wallContainer || !elements.wallSvg) {
            console.error("Panzoom target elements not found");
            return;
        }

        // Ensure SVG has dimensions set from viewBox before initializing
        const dims = state.viewBox;
        elements.wallSvg.style.width = `${dims.width}px`;
        elements.wallSvg.style.height = `${dims.height}px`;


        try {
            state.panzoomInstance = Panzoom(elements.wallSvg, {
                maxScale: 10,
                minScale: 0.1,
                contain: 'outside', // Allows panning outside initial bounds slightly
                canvas: true,      // IMPORTANT: Optimizes for SVG rendering performance
                // Exclude buttons within the SVG parent from triggering pan/zoom drag
                exclude: Array.from(elements.wallContainer.querySelectorAll('button')),
                // Filter clicks on holds vs background
                // Returning true allows the click event to propagate
                 filterMouseButton: function(event) {
                    // Allow primary button clicks (0) to pass through for hold selection
                    return event.button !== 0; // Block pan on left click
                },
                // We handle hold clicks separately, prevent panzoom interfering
                // touchAction: 'none' set in CSS handles touch conflicts generally
            });

             // Center the initial view if SVG is smaller than container
             // state.panzoomInstance.pan(
             //    (elements.wallContainer.clientWidth - state.viewBox.width * state.panzoomInstance.getScale()) / 2,
             //    (elements.wallContainer.clientHeight - state.viewBox.height * state.panzoomInstance.getScale()) / 2
             // );
            elements.wallContainer.addEventListener('wheel', (event) => {
                 if (!state.panzoomInstance) return;
                 state.panzoomInstance.zoomWithWheel(event);
             });
             // Add listener to reset button
             elements.btnResetView.addEventListener('click', resetView);

         } catch (error) {
             console.error("Failed to initialize Panzoom:", error);
             showToast("Error initializing zoom/pan.", 4000);
         }
    }

    function resetView() {
        if (state.panzoomInstance) {
            state.panzoomInstance.reset();
            // Optional: Zoom to fit after reset if needed
            // state.panzoomInstance.zoomToFit(elements.wallContainer);
            showToast("View Reset", 1500);
        }
    }


    // --- Boulder Management ---
    function loadBouldersFromStorage() {
        try {
            const savedBoulders = localStorage.getItem('boulderApp_boulders');
            state.boulders = savedBoulders ? JSON.parse(savedBoulders) : [];
        } catch (error) {
            console.error('Error loading boulders from localStorage:', error);
            state.boulders = [];
            showToast('Could not load saved boulders. Storage might be corrupt.', 4000);
            // Optional: Offer to clear storage?
            // localStorage.removeItem('boulderApp_boulders');
        }
        renderBoulderList();
    }

    function saveBouldersToStorage() {
        try {
            localStorage.setItem('boulderApp_boulders', JSON.stringify(state.boulders));
        } catch (error) {
            console.error('Error saving boulders to localStorage:', error);
            showToast('Error saving boulders: Storage might be full.', 5000);
        }
    }

    function createNewBoulder() {
        deselectHold(); // Deselect any hold

        state.currentBoulder = {
            id: `b-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`,
            name: '',
            grade: 'V4',
            style: 'Technical',
            description: '',
            moves: [], // { hold_id: string, move_number: int }
            start_holds: [],
            finish_holds: []
        };

        // Reset input fields
        elements.boulderNameInput.value = '';
        elements.boulderGradeSelect.value = state.currentBoulder.grade;
        elements.boulderStyleSelect.value = state.currentBoulder.style;
        elements.boulderDescriptionInput.value = '';

        renderSequence();
        updateHoldAppearance();
        renderBoulderList(); // Update list highlighting
        updateUI();
        console.log("Created new boulder:", state.currentBoulder.id);
    }

    function saveCurrentBoulder() {
        if (!state.currentBoulder || !state.isDataLoaded) {
            showToast('Cannot save: Load holds data and start a boulder first.', 3000);
            return;
        }

        // Update data from inputs
        state.currentBoulder.name = elements.boulderNameInput.value.trim() || `Unnamed ${state.currentBoulder.id.slice(-4)}`;
        state.currentBoulder.grade = elements.boulderGradeSelect.value;
        state.currentBoulder.style = elements.boulderStyleSelect.value;
        state.currentBoulder.description = elements.boulderDescriptionInput.value.trim();

        // Validation
        if (state.currentBoulder.moves.length === 0) return showToast('Cannot save: Add holds to the boulder.', 3000);
        if (state.currentBoulder.start_holds.length === 0) return showToast('Cannot save: Mark Start hold(s).', 3000);
        if (state.currentBoulder.finish_holds.length === 0) return showToast('Cannot save: Mark Finish hold(s).', 3000);

        // Add or update in the main list (using a deep copy)
        const boulderToSave = JSON.parse(JSON.stringify(state.currentBoulder));
        const existingIndex = state.boulders.findIndex(b => b.id === boulderToSave.id);

        if (existingIndex >= 0) {
            state.boulders[existingIndex] = boulderToSave;
            showToast(`Boulder "${boulderToSave.name}" updated.`, 2000);
        } else {
            state.boulders.push(boulderToSave);
            showToast(`Boulder "${boulderToSave.name}" saved.`, 2000);
        }

        saveBouldersToStorage();
        renderBoulderList();
        updateUI(); // Update save button state etc.
    }

    function loadBoulder(boulderId) {
        const boulderToLoad = state.boulders.find(b => b.id === boulderId);
        if (!boulderToLoad || !state.isDataLoaded) {
            return showToast("Cannot load: Boulder not found or holds data missing.", 3000);
        }

        deselectHold(); // Clear selection

        // Load a deep copy for editing
        state.currentBoulder = JSON.parse(JSON.stringify(boulderToLoad));

        // Update input fields
        elements.boulderNameInput.value = state.currentBoulder.name;
        elements.boulderGradeSelect.value = state.currentBoulder.grade;
        elements.boulderStyleSelect.value = state.currentBoulder.style;
        elements.boulderDescriptionInput.value = state.currentBoulder.description || '';

        renderSequence();
        updateHoldAppearance();
        renderBoulderList(); // Highlight loaded boulder
        updateUI();
        showToast(`Loaded: ${state.currentBoulder.name}`, 2000);
    }

    function deleteBoulder(boulderId) {
        const boulderIndex = state.boulders.findIndex(b => b.id === boulderId);
        if (boulderIndex === -1) return;

        const boulderName = state.boulders[boulderIndex].name || 'Unnamed Boulder';

        if (confirm(`Delete boulder "${boulderName}"?\nThis cannot be undone.`)) {
            const deletedBoulderId = state.boulders[boulderIndex].id;
            state.boulders.splice(boulderIndex, 1); // Remove

            // If the deleted one was active, create a new one
            if (state.currentBoulder && state.currentBoulder.id === deletedBoulderId) {
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
                 // Basic validation of imported structure
                if (!data || !Array.isArray(data.boulders)) {
                    throw new Error('Invalid import file format. Expected JSON with a "boulders" array.');
                }

                let importedCount = 0;
                let skippedCount = 0;
                const currentBoulderIds = new Set(state.boulders.map(b => b.id));

                data.boulders.forEach(importedBoulder => {
                    // Minimal validation of boulder structure
                    if (importedBoulder && importedBoulder.id && importedBoulder.moves) {
                        if (!currentBoulderIds.has(importedBoulder.id)) {
                            state.boulders.push(JSON.parse(JSON.stringify(importedBoulder))); // Add deep copy
                            currentBoulderIds.add(importedBoulder.id); // Add to set to prevent duplicates within the imported file itself
                            importedCount++;
                        } else {
                            skippedCount++;
                        }
                    } else {
                         console.warn("Skipping invalid boulder structure during import:", importedBoulder);
                         skippedCount++;
                    }
                });

                if (importedCount > 0) {
                    saveBouldersToStorage();
                    renderBoulderList();
                    updateUI();
                }
                showToast(`Imported ${importedCount} boulders. Skipped ${skippedCount} (duplicates or invalid).`, 4000);

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


    function exportAllBoulders() {
        if (!state.isDataLoaded) return showToast('Load holds data before exporting.', 3000);
        if (state.boulders.length === 0) return showToast('No boulders saved to export.', 3000);

        // Create the export structure
        const exportData = {
            // Include wall info and the holds library for context
            wall_info: {
                dimensions: state.holdsData.image_dimensions,
                // Add other relevant wall info if available/needed
            },
            holds_library: state.holdsData.holds, // The full holds definition
            // The list of boulders
            boulders: state.boulders.map(boulder => ({
                // Include only the necessary boulder data + hold IDs
                id: boulder.id,
                name: boulder.name,
                grade: boulder.grade,
                style: boulder.style,
                description: boulder.description,
                start_holds: boulder.start_holds, // Array of hold IDs
                finish_holds: boulder.finish_holds, // Array of hold IDs
                // Provide holds in numbered order
                ordered_holds: boulder.moves
                                    .sort((a, b) => a.move_number - b.move_number)
                                    .map(m => m.hold_id),
                 // Optionally include the detailed move list if needed elsewhere
                 // moves_detailed: boulder.moves,
            }))
        };

        try {
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Consistent filename for easy replacement
            a.download = `boulder_export_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(`Exported ${state.boulders.length} boulders.`, 2500);
        } catch (error) {
            console.error("Export failed:", error);
            showToast('Failed to export boulders.', 4000);
        }
    }

    // --- Hold Interaction ---
    function handleHoldClick(holdId) {
        if (!state.currentBoulder || !state.isDataLoaded) return; // Need active boulder & data

        const isAlreadyInBoulder = state.currentBoulder.moves.some(m => m.hold_id === holdId);
        const isSelected = state.selectedHoldId === holdId;

        if (isSelected) {
            // Clicked the selected hold again - deselect it
            deselectHold();
        } else {
            // Select the new hold
            selectHold(holdId);
            // If it's not already part of the sequence, add it now
            if (!isAlreadyInBoulder) {
                addHoldToBoulder(holdId);
            }
        }
        updateUI();
    }

    function selectHold(holdId) {
        deselectHold(); // Clear previous selection first

        state.selectedHoldId = holdId;
        const holdElement = document.getElementById(`hold-${holdId}`);
        if (holdElement) {
            holdElement.classList.add('selected');
        }

         // Update selected hold info display
         const holdData = state.holdsData?.holds.find(h => h.id === holdId);
         elements.selectedHoldInfo.textContent = holdData
             ? `Selected Hold: ID ${holdData.id} (Type: ${holdData.hold_type || 'Unknown'})`
             : `Selected Hold: ID ${holdId} (Data not found)`;

        updateUI();
    }

    function deselectHold() {
        if (state.selectedHoldId) {
            const holdElement = document.getElementById(`hold-${state.selectedHoldId}`);
            if (holdElement) {
                holdElement.classList.remove('selected');
            }
        }
        state.selectedHoldId = null;
        elements.selectedHoldInfo.textContent = 'Selected Hold: None'; // Clear info display
        updateUI();
    }

    function addHoldToBoulder(holdId) {
        if (!state.currentBoulder || state.currentBoulder.moves.some(m => m.hold_id === holdId)) {
            return; // Should not happen if called from handleHoldClick correctly
        }

        const nextMoveNumber = (state.currentBoulder.moves.length > 0)
            ? Math.max(...state.currentBoulder.moves.map(m => m.move_number)) + 1
            : 1;

        state.currentBoulder.moves.push({ hold_id: holdId, move_number: nextMoveNumber });
        console.log(`Added hold ${holdId} as move ${nextMoveNumber}`);

        renderSequence();
        updateHoldAppearance(); // Make sure it's not dimmed
        updateUI();
    }

    function markSelectedAsStart() {
        if (!state.selectedHoldId || !state.currentBoulder) return;
        const holdId = state.selectedHoldId;
        if (!state.currentBoulder.moves.some(m => m.hold_id === holdId)) return; // Must be in boulder

        // Add to start_holds if not present
        if (!state.currentBoulder.start_holds.includes(holdId)) {
            state.currentBoulder.start_holds.push(holdId);
        }
        // Remove from finish_holds (cannot be both start and finish in this logic)
        state.currentBoulder.finish_holds = state.currentBoulder.finish_holds.filter(id => id !== holdId);

        renderSequence(); // Update markers
        showToast(`Hold ${holdId} marked as Start`, 1500);
        updateUI();
    }

    function markSelectedAsFinish() {
        if (!state.selectedHoldId || !state.currentBoulder) return;
        const holdId = state.selectedHoldId;
         if (!state.currentBoulder.moves.some(m => m.hold_id === holdId)) return;

        // Add to finish_holds if not present
        if (!state.currentBoulder.finish_holds.includes(holdId)) {
            state.currentBoulder.finish_holds.push(holdId);
        }
        // Remove from start_holds
        state.currentBoulder.start_holds = state.currentBoulder.start_holds.filter(id => id !== holdId);

        renderSequence();
        showToast(`Hold ${holdId} marked as Finish`, 1500);
        updateUI();
    }

    function removeSelectedHoldFromBoulder() {
        if (!state.selectedHoldId || !state.currentBoulder) return;
        const holdIdToRemove = state.selectedHoldId;

        // Find the move index
        const moveIndex = state.currentBoulder.moves.findIndex(move => move.hold_id === holdIdToRemove);
        if (moveIndex === -1) return; // Not actually in the boulder's moves

        // Remove from moves, start, and finish lists
        state.currentBoulder.moves.splice(moveIndex, 1);
        state.currentBoulder.start_holds = state.currentBoulder.start_holds.filter(id => id !== holdIdToRemove);
        state.currentBoulder.finish_holds = state.currentBoulder.finish_holds.filter(id => id !== holdIdToRemove);

        renumberMoves(); // Renumber remaining moves
        deselectHold(); // Deselect the removed hold

        renderSequence();
        updateHoldAppearance();
        showToast(`Hold ${holdIdToRemove} removed from boulder`, 1500);
        updateUI();
    }

    function renumberMoves() {
        if (!state.currentBoulder) return;
        state.currentBoulder.moves
            .sort((a, b) => a.move_number - b.move_number) // Keep relative order
            .forEach((move, index) => {
                move.move_number = index + 1;
            });
        console.log("Renumbered moves:", state.currentBoulder.moves);
    }

    // --- UI Updates & Rendering ---
    function renderSequence() {
        elements.sequenceLayer.innerHTML = ''; // Clear previous markers
        if (!state.currentBoulder || !state.isDataLoaded) return;

        const fragment = document.createDocumentFragment();
        state.currentBoulder.moves.forEach(move => {
            const hold = state.holdsData.holds.find(h => h.id === move.hold_id);
            if (!hold || !hold.bounding_box) return; // Skip if hold data missing

            const bbox = hold.bounding_box;
            const centerX = bbox.x + bbox.width / 2;
            // Adjust position: slightly above center seems good
            const centerY = bbox.y + (bbox.height * 0.3); // Y is from top in SVG

            const isStart = state.currentBoulder.start_holds.includes(move.hold_id);
            const isFinish = state.currentBoulder.finish_holds.includes(move.hold_id);

            let markerText = '';
            let markerClass = 'sequence-marker';

            if (isStart && isFinish) { markerText = 'S/F'; markerClass += ' start finish'; }
            else if (isStart) { markerText = 'S'; markerClass += ' start'; }
            else if (isFinish) { markerText = 'F'; markerClass += ' finish'; }
            else { markerText = move.move_number.toString(); markerClass += ' move'; }

            const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textElement.setAttribute('x', centerX);
            textElement.setAttribute('y', centerY);
            textElement.setAttribute('text-anchor', 'middle');
            textElement.setAttribute('dominant-baseline', 'middle');
            textElement.setAttribute('class', markerClass);
            // Adjust font size dynamically? Maybe base it on viewbox width for consistency?
            const fontSize = Math.max(10, Math.min(30, state.viewBox.width / 40)); // Example dynamic sizing
            textElement.setAttribute('font-size', `${fontSize}px`);
            textElement.textContent = markerText;

            fragment.appendChild(textElement);
        });
        elements.sequenceLayer.appendChild(fragment);
    }

    function updateHoldAppearance() {
        if (!state.isDataLoaded) return;

        const holdsInCurrentBoulder = state.currentBoulder
            ? new Set(state.currentBoulder.moves.map(m => m.hold_id))
            : new Set(); // Empty set if no current boulder

        elements.holdsLayer.querySelectorAll('.hold').forEach(holdElement => {
            const holdId = holdElement.getAttribute('data-id');
            if (holdsInCurrentBoulder.has(holdId)) {
                holdElement.classList.remove('not-in-boulder');
                holdElement.classList.add('in-boulder');
            } else {
                holdElement.classList.remove('in-boulder');
                holdElement.classList.add('not-in-boulder');
            }
        });
    }

    function renderBoulderList() {
        elements.boulderItems.innerHTML = ''; // Clear list
        elements.boulderCountSpan.textContent = state.boulders.length;

        if (state.boulders.length === 0) {
            elements.boulderItems.innerHTML = '<p>No boulders saved yet.</p>';
            return;
        }

        const fragment = document.createDocumentFragment();
        state.boulders
            .sort((a,b) => a.name.localeCompare(b.name)) // Sort alphabetically
            .forEach(boulder => {
                const item = document.createElement('div');
                item.className = 'boulder-item';
                item.setAttribute('data-boulder-id', boulder.id);
                 if (state.currentBoulder && boulder.id === state.currentBoulder.id) {
                    item.classList.add('boulder-item-active');
                }

                const info = document.createElement('div');
                info.className = 'boulder-item-info';
                info.innerHTML = `
                    <strong>${boulder.name || 'Unnamed'}</strong>
                    <small>${boulder.grade} | ${boulder.style} | ${boulder.moves?.length || 0} holds</small>
                `;

                const actions = document.createElement('div');
                actions.className = 'boulder-item-actions';

                const loadBtn = document.createElement('button');
                loadBtn.textContent = 'Load';
                loadBtn.className = 'secondary';
                loadBtn.onclick = (e) => { e.stopPropagation(); loadBoulder(boulder.id); };

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.className = 'danger';
                deleteBtn.onclick = (e) => { e.stopPropagation(); deleteBoulder(boulder.id); };

                actions.appendChild(loadBtn);
                actions.appendChild(deleteBtn);

                item.appendChild(info);
                item.appendChild(actions);
                item.onclick = () => { loadBoulder(boulder.id); }; // Click anywhere on item to load

                fragment.appendChild(item);
            });
        elements.boulderItems.appendChild(fragment);
    }

    function updateUI() {
        const hasData = state.isDataLoaded;
        const hasCurrent = !!state.currentBoulder;
        const hasSelection = !!state.selectedHoldId;
        const isHoldInCurrentBoulder = hasSelection && hasCurrent && state.currentBoulder.moves.some(m => m.hold_id === state.selectedHoldId);

        // Show/hide panels
        elements.boulderInfoPanel.style.display = hasData ? 'block' : 'none';
        elements.holdActionsPanel.style.display = hasData ? 'block' : 'none';

        // Enable/disable buttons
        elements.btnExportAll.disabled = state.boulders.length === 0;
        elements.btnSaveBoulder.disabled = !(hasCurrent &&
                                           state.currentBoulder.moves.length > 0 &&
                                           state.currentBoulder.start_holds.length > 0 &&
                                           state.currentBoulder.finish_holds.length > 0);

        elements.btnMarkStart.disabled = !isHoldInCurrentBoulder;
        elements.btnMarkFinish.disabled = !isHoldInCurrentBoulder;
        elements.btnRemoveHold.disabled = !isHoldInCurrentBoulder;
        elements.btnResetView.disabled = !state.panzoomInstance;

        // Highlight active boulder in the list
        elements.boulderItems.querySelectorAll('.boulder-item').forEach(item => {
            item.classList.toggle('boulder-item-active', state.currentBoulder && item.getAttribute('data-boulder-id') === state.currentBoulder.id);
        });
    }

    // --- Toast Notifications ---
    let toastTimeout;
    function showToast(message, duration = 3000) {
        elements.toast.textContent = message;
        elements.toast.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            elements.toast.classList.remove('show');
        }, duration);
    }

    // --- Event Listeners Setup ---
    function attachEventListeners() {
        elements.btnLoadData.addEventListener('click', () => elements.holdsFileInput.click());
        elements.holdsFileInput.addEventListener('change', (event) => {
             loadHoldsDataFromFile(event.target.files[0]);
             event.target.value = null; // Reset input
        });

        elements.btnImportBoulders.addEventListener('click', () => elements.importFileInput.click());
        elements.importFileInput.addEventListener('change', (event) => {
            importBouldersFromFile(event.target.files[0]);
            event.target.value = null; // Reset input
        });


        elements.btnNewBoulder.addEventListener('click', createNewBoulder);
        elements.btnSaveBoulder.addEventListener('click', saveCurrentBoulder);
        elements.btnExportAll.addEventListener('click', exportAllBoulders);

        elements.btnMarkStart.addEventListener('click', markSelectedAsStart);
        elements.btnMarkFinish.addEventListener('click', markSelectedAsFinish);
        elements.btnRemoveHold.addEventListener('click', removeSelectedHoldFromBoulder);

        // Deselect hold if clicking SVG background (handled by panzoom filterMouseButton now)
        // elements.wallSvg.addEventListener('click', (event) => {
        //     if (event.target === elements.wallSvg || event.target === elements.svgBg) {
        //         deselectHold();
        //     }
        // });

        // Update current boulder details on input change
        elements.boulderNameInput.addEventListener('input', () => { if(state.currentBoulder) state.currentBoulder.name = elements.boulderNameInput.value; });
        elements.boulderGradeSelect.addEventListener('change', () => { if(state.currentBoulder) state.currentBoulder.grade = elements.boulderGradeSelect.value; });
        elements.boulderStyleSelect.addEventListener('change', () => { if(state.currentBoulder) state.currentBoulder.style = elements.boulderStyleSelect.value; });
        elements.boulderDescriptionInput.addEventListener('input', () => { if(state.currentBoulder) state.currentBoulder.description = elements.boulderDescriptionInput.value; });

    }

    // --- Start the App ---
    // Use DOMContentLoaded to ensure HTML is parsed, although `defer` on script tag helps too
    document.addEventListener('DOMContentLoaded', init);

})(); // Execute the IFFE