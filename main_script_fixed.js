        // --- 1. THREE.JS SETUP ---
        const container = document.getElementById('canvas-container');
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1e272e);
        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 10000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        container.appendChild(renderer.domElement);
        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true; controls.screenSpacePanning = true;
        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(200, 500, 200); dirLight.castShadow = true;
        scene.add(dirLight);
        let currentGroup = new THREE.Group();
        currentGroup.rotation.x = -Math.PI / 2;
        scene.add(currentGroup);

        let meshes = {}, simplifiedMeshes = {}, detailedMeshes = {}, showDetailed = false;
        camera.position.set(500, 500, 500); controls.update();

        // --- 2. DATA STATE ---
        let originalXmlDoc = null, allComponents = [], hintMap = {}, useMCADNames = false, originalFileName = "export.idx", loadedOBJFiles = [];
        let incrementHistory = [], currentHistoryStep = -1, baselineComponents = [];
        let manualCount = 0;

        // --- 3. INPUT HANDLERS ---
        document.getElementById('file-input').addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            originalFileName = file.name; document.getElementById('loading').style.display = 'block';
            document.getElementById('inc-file-input').disabled = false;
            incrementHistory = []; currentHistoryStep = -1;
            document.getElementById('history-timeline').style.display = 'none';
            const reader = new FileReader();
            reader.onload = ev => {
                const xml = ev.target.result;
                originalXmlDoc = new DOMParser().parseFromString(xml, "application/xml");
                setTimeout(() => { 
                    processIDX(xml); 
                    baselineComponents = JSON.parse(JSON.stringify(allComponents)); 
                }, 50);
            };
            reader.readAsText(file);
        });

        document.getElementById('inc-file-input').addEventListener('change', async e => {
            const hasManualChanges = allComponents.some(c => c.isModified || c.isManuallyAdded || c.isDeleted);
            if (hasManualChanges && !confirm("Aktuelle Änderungen verwerfen und Inkremente importieren?")) {
                e.target.value = '';
                return;
            }
            const files = Array.from(e.target.files).sort((a, b) => a.lastModified - b.lastModified);
            if (files.length === 0) return;
            document.getElementById('loading').style.display = 'block';
            incrementHistory = [];
            for (const file of files) { 
                incrementHistory.push({ name: file.name, xml: await file.text(), date: new Date().toLocaleString(), changes: [] }); 
            }
            currentHistoryStep = incrementHistory.length - 1;
            
            // Pre-process all steps sequentially to populate the 'changes' array for the UI
            allComponents = JSON.parse(JSON.stringify(baselineComponents));
            for (let i = 0; i < incrementHistory.length; i++) {
                await processIncrementStep(incrementHistory[i].xml, true);
            }
            
            updateHistoryUI();
            await applyHistoryStep(currentHistoryStep);
            e.target.value = ''; // allow reloading the same file
        });

        function toggleAccordion(header) {
            const content = header.nextElementSibling;
            const isCollapsed = header.classList.contains('collapsed');
            if (isCollapsed) { header.classList.remove('collapsed'); content.classList.remove('collapsed'); }
            else { header.classList.add('collapsed'); content.classList.add('collapsed'); }
        }

        
        function updateHistoryUI() {
            const container = document.getElementById('history-timeline'), list = document.getElementById('history-list'), stepText = document.getElementById('hist-step-text');
            const detailsDiv = document.getElementById('history-details');
            const hasManual = allComponents.some(c => c.isManuallyAdded || c.isModified || c.isDeleted);
            if (incrementHistory.length > 0 || hasManual) container.style.display = 'flex'; else container.style.display = 'none';
            const globalRespBtn = document.getElementById('export-resp-btn-global');
            if (globalRespBtn) globalRespBtn.style.display = incrementHistory.length > 0 ? 'block' : 'none';
            list.innerHTML = '';
            const baseBubble = document.createElement('div');
            baseBubble.className = 'history-bubble baseline ' + (currentHistoryStep === -1 ? 'active' : '');
            baseBubble.innerHTML = '<span>🏠</span> Base';
            baseBubble.onclick = async () => { currentHistoryStep = -1; updateHistoryUI(); await applyHistoryStep(-1); };
            list.appendChild(baseBubble);
            incrementHistory.forEach((item, idx) => {
                const bubble = document.createElement('div');
                bubble.className = 'history-bubble ' + (idx === currentHistoryStep ? 'active' : '');
                bubble.title = 'Geladen: ' + (item.date || 'Unbekannt') + '\nÄnderungen:\n' + ((item.changes || []).map(c => typeof c === 'string' ? c : c.text).join('\n') || 'Keine');
                bubble.innerHTML = '<span>📦</span> ' + item.name.replace(/(_filtered)?_increment.idx/i, '') + ' <small style="opacity:0.6; font-size:9px; margin-left:5px;">' + ((item.date || '').split(',')[0] || '') + '</small>';
                bubble.onclick = async () => { currentHistoryStep = idx; updateHistoryUI(); await applyHistoryStep(idx); };
                list.appendChild(bubble);
            });

            const currentBubble = document.createElement('div');
            currentBubble.className = 'history-bubble current ' + (currentHistoryStep === 999 ? 'active' : '');
            currentBubble.innerHTML = '<span>✏️</span> Aktuell';
            currentBubble.onclick = async () => { currentHistoryStep = 999; updateHistoryUI(); await applyHistoryStep(999); };
            list.appendChild(currentBubble);

            stepText.innerText = currentHistoryStep === -1 ? 'Basis-Modell' : (currentHistoryStep === 999 ? 'Aktuelle Änderungen' : 'Schritt ' + (currentHistoryStep + 1) + ' / ' + incrementHistory.length);
            const dBtn = document.getElementById('discard-changes-btn');
            if (dBtn) dBtn.style.display = (currentHistoryStep === 999) ? 'block' : 'none';

            if (detailsDiv) {
                if (currentHistoryStep === -1) {
                    detailsDiv.style.display = 'none';
                } else if (currentHistoryStep >= 0 && currentHistoryStep < incrementHistory.length) {
                    const changes = incrementHistory[currentHistoryStep].changes || [];
                    let html = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">' +
                                    '<strong style="color:#0fbcf9;">Änderungen in Schritt ' + (currentHistoryStep + 1) + ':</strong>' +
                                    '<button onclick="window.exportResponse()" class="action-btn" style="background:#3498db; color:white; font-size:10px; padding:3px 8px;" title="Erstellt eine _response.idx">💾 Response</button>' +
                                '</div>';
                    if (changes.length > 0) {
                        html += '<ul style="margin: 0; padding-left: 0; list-style: none;">';
                        changes.forEach(c => {
                            const text = typeof c === 'string' ? c : c.text;
                            const uid = typeof c === 'string' ? null : c.uid;
                            if (uid) {
                                const status = (window.manualStateResponses && window.manualStateResponses[uid]) || 'accepted';
                                const isRej = status === 'rejected';
                                html += '<li style="margin-bottom:4px; background: rgba(0,0,0,0.2); padding: 4px 6px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">' +
                                    '<div style="color: #d2dae2; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="' + text + '">' + text + '</div>' +
                                    '<div style="display:flex; gap:3px; flex-shrink: 0;">' +
                                        '<button onclick="window.setResponse(\'' + uid + '\', \'accepted\')" style="font-size:10px; border:1px solid #27ae60; padding:2px 6px; cursor:pointer; background: ' + (isRej ? 'transparent' : '#27ae60') + '; color: ' + (isRej ? '#27ae60' : 'white') + '; border-radius: 3px;">Akzeptieren</button>' +
                                        '<button onclick="window.setResponse(\'' + uid + '\', \'rejected\')" style="font-size:10px; border:1px solid #e74c3c; padding:2px 6px; cursor:pointer; background: ' + (isRej ? '#e74c3c' : 'transparent') + '; color: ' + (isRej ? 'white' : '#e74c3c') + '; border-radius: 3px;">Ablehnen</button>' +
                                    '</div>' +
                                '</li>';
                            } else {
                                html += '<li style="margin-bottom:4px; color: #d2dae2; font-size: 11px;">' + text + '</li>';
                            }
                        });
                        html += '</ul>';
                    } else {
                        html += '<div style="margin-top: 10px; color: #a4b0be;">Keine sichtbaren Änderungen.</div>';
                    }
                    detailsDiv.innerHTML = html;
                    detailsDiv.style.display = 'block';
                } else if (currentHistoryStep === 999) {
                    let curHtml = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">' +
                                        '<strong style="color:#f1c40f;">Aktuelle manuelle Änderungen:</strong>' +
                                        '<button onclick="window.exportResponse()" class="action-btn" style="background:#3498db; color:white; font-size:10px; padding:3px 8px;" title="Exportiert ein _response.idx">💾 Response exportieren</button>' +
                                    '</div>' +
                                    '<ul style="margin: 0; padding-left: 0; list-style: none;">';
                    let hasManualChanges = false;
                    allComponents.forEach(c => {
                        let liText = null;
                        if (c.isManuallyAdded) liText = c.name + ' (Manuell hinzugefügt)'; 
                        else if (c.isModified) {
                            let actions = [];
                            if (c.manualDeletedState === true) actions.push('gelöscht');
                            else if (c.manualDeletedState === false) actions.push('wiederhergestellt');
                            const dx = c.x - c.origX, dy = c.y - c.origY, dz = c.z - c.origZ;
                            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001 || Math.abs(dz) > 0.001) {
                                let moves = [];
                                if (Math.abs(dx) > 0.001) moves.push('X: ' + dx.toFixed(2) + 'mm');
                                if (Math.abs(dy) > 0.001) moves.push('Y: ' + dy.toFixed(2) + 'mm');
                                if (Math.abs(dz) > 0.001) moves.push('Z: ' + dz.toFixed(2) + 'mm');
                                actions.push('verschoben (' + moves.join(', ') + ')');
                            }
                            if (actions.length > 0) liText = c.name + ' ' + actions.join(' und ');
                        }
                        if (liText) {
                            hasManualChanges = true;
                            const isActive = window.activeManualChangeUid === c.uid;
                            const bg = isActive ? 'rgba(15, 188, 249, 0.2)' : 'transparent';
                            const brd = isActive ? '1px solid #0fbcf9' : '1px solid transparent';
                            curHtml += '<li style="margin-bottom:4px; display:flex; justify-content:space-between; align-items:center; background:' + bg + '; border:' + brd + '; padding: 2px 5px; border-radius: 4px; cursor: pointer;" onclick="window.toggleManualChangeSelection(\'' + c.uid + '\')">' +
                                '<span>' + liText + '</span>' +
                                '<button onclick="event.stopPropagation(); window.discardManualChange(\'' + c.uid + '\')" style="background:#c0392b; border:none; color:white; padding:2px 6px; border-radius:3px; cursor:pointer; font-size:9px;">X</button>' +
                            '</li>';
                        }
                    });
                    curHtml += '</ul>';
                    if (!hasManualChanges) {
                        curHtml = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">' +
                                        '<strong style="color:#f1c40f;">Aktuelle manuelle Änderungen:</strong>' +
                                        '<button onclick="window.exportResponse()" class="action-btn" style="background:#3498db; color:white; font-size:10px; padding:3px 8px;" title="Exportiert ein _response.idx">💾 Response exportieren</button>' +
                                    '</div>' +
                                    '<div style="margin-top: 10px; color: #a4b0be;">Keine manuellen Änderungen.</div>';
                    }
                    detailsDiv.innerHTML = curHtml;
                    detailsDiv.style.display = 'block';
                }
            }
        }


        window.saveManualState = () => {
            window.manualStateAdds = allComponents.filter(c => c.isManuallyAdded).map(c => JSON.parse(JSON.stringify(c)));
            window.manualStateMods = allComponents.filter(c => c.isModified && !c.isManuallyAdded).map(c => ({uid: c.uid, x: c.x, y: c.y, z: c.z, manualDeletedState: c.manualDeletedState}));
        };

        
        window.toggleManualChangeSelection = (uid) => {
            if (window.activeManualChangeUid === uid) {
                window.activeManualChangeUid = null;
            } else {
                window.activeManualChangeUid = uid;
                handleSelection(uid, false, false);
            }
            build3DScene(allComponents, window.lastBoardThickness || 1.6);
            updateHistoryUI();
        };

        window.discardManualChange = async (uid) => {
            const idx = allComponents.findIndex(c => c.uid === uid);
            if (idx === -1) return;
            const comp = allComponents[idx];
            if (comp.isManuallyAdded) {
                allComponents.splice(idx, 1);
                if (meshes[uid]) { meshes[uid].visible = false; delete meshes[uid]; }
                if (simplifiedMeshes[uid]) delete simplifiedMeshes[uid];
                if (detailedMeshes[uid]) delete detailedMeshes[uid];
                window.saveManualState();
                await applyHistoryStep(999); updateHistoryUI();
            } else {
                comp.x = comp.origX; comp.y = comp.origY; comp.z = comp.origZ;
                comp.isModified = false;
                comp.manualDeletedState = undefined;
                comp.isDeleted = false;
                window.saveManualState();
                await applyHistoryStep(999);
                updateHistoryUI();
            }
        };

        async function applyHistoryStep(stepIdx) {
            window.activeManualChangeUid = null;
            document.getElementById('loading').style.display = 'block';
            allComponents = JSON.parse(JSON.stringify(baselineComponents));
            
            let limit = stepIdx === 999 ? incrementHistory.length : (stepIdx + 1);
            for (let i = 0; i < limit; i++) { 
                let highlight = (stepIdx !== 999) && (i === stepIdx);
                await processIncrementStep(incrementHistory[i].xml, highlight); 
            }
            
            allComponents.forEach(c => { c.origX = c.x; c.origY = c.y; c.origZ = c.z; c.isModified = false; c.manualDeletedState = undefined; });
            
            if (stepIdx === 999) {
                if (window.manualStateAdds) window.manualStateAdds.forEach(c => {
                    const existing = allComponents.findIndex(x => x.uid === c.uid);
                    if (existing !== -1) allComponents[existing] = JSON.parse(JSON.stringify(c));
                    else allComponents.push(JSON.parse(JSON.stringify(c)));
                });
                if (window.manualStateMods) window.manualStateMods.forEach(m => {
                    const c = allComponents.find(x => x.uid === m.uid);
                    console.log("Restoring manual mod:", m.uid, "Found:", !!c);
                    if (c) { 
                        c.isModified = true; c.x = m.x; c.y = m.y; c.z = m.z; 
                        if (m.manualDeletedState !== undefined) {
                            c.isDeleted = m.manualDeletedState;
                            c.manualDeletedState = m.manualDeletedState;
                        }
                    }
                });
                if (window.manualStateResponses) {
                    Object.keys(window.manualStateResponses).forEach(uid => {
                        const c = allComponents.find(x => x.uid === uid);
                        if (c) {
                            c.acceptStatus = window.manualStateResponses[uid];
                        }
                    });
                }
            }

            build3DScene(allComponents, window.lastBoardThickness || 1.6);
            document.getElementById('loading').style.display = 'none';
        }



        async function processIncrementStep(xmlText, isHighlightStep) {
            const stepIndex = incrementHistory.findIndex(h => h.xml === xmlText);
            const stepChanges = (stepIndex !== -1) ? incrementHistory[stepIndex].changes : [];
            if (isHighlightStep) stepChanges.length = 0; 
            
            const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
            const findComp = (id, n) => {
                if (id) { const c = allComponents.find(c => c.uid === id); if (c) return c; }
                if (n && n !== "Unknown" && !id) {
                    const c = allComponents.find(c => c.name === n || c.refDes === n || c.instName === n || c.uid === n || c.partNumber === n);
                    if (c) return c;
                }
                return null;
            };

            // 1. Process Responses (Accept/Reject)
            getNS(xmlDoc, "Response").forEach(resp => {
                const changeIdNode = getNS(resp, "ChangeId")[0] || getNS(resp, "PredecessorItem")[0] || getNS(resp, "NewItem")[0];
                const statusNode = getNS(resp, "Status")[0];
                if (changeIdNode && statusNode) {
                    const cid = changeIdNode.textContent;
                    const status = statusNode.textContent.toLowerCase();
                    const comp = findComp(cid, null) || findComp(null, cid);
                    if (comp) {
                        comp.acceptStatus = status;
                        if (status === 'rejected') { 
                            comp.isRejected = true; 
                            if(isHighlightStep) { comp.isIncrementallyRejected = true; stepChanges.push({ uid: comp.uid, text: `Abgelehnt: ${comp.name}` }); } 
                        }
                        if (status === 'accepted') { 
                            comp.isAccepted = true; 
                            if(isHighlightStep) { comp.isIncrementallyAccepted = true; stepChanges.push({ uid: comp.uid, text: `Akzeptiert: ${comp.name}` }); } 
                        }
                    }
                }
            });

            getNS(xmlDoc, "Accept").forEach(acc => {
                const statusNode = getNS(acc, "Status")[0];
                if (statusNode) {
                    let p = acc.parentNode;
                    while (p && p.localName !== "Item" && p.localName !== "ItemInstance") p = p.parentNode;
                    if (p) {
                        const cid = p.getAttribute("id");
                        const comp = findComp(cid, null);
                        if (comp) {
                            const status = statusNode.textContent.toLowerCase();
                            comp.acceptStatus = status;
                            if (status === 'rejected') { 
                                comp.isRejected = true; 
                                if(isHighlightStep) { comp.isIncrementallyRejected = true; stepChanges.push({ uid: comp.uid, text: `Abgelehnt: ${comp.name}` }); } 
                            }
                            if (status === 'accepted') { 
                                comp.isAccepted = true; 
                                if(isHighlightStep) { comp.isIncrementallyAccepted = true; stepChanges.push({ uid: comp.uid, text: `Akzeptiert: ${comp.name}` }); } 
                            }
                        }
                    }
                }
            });

            // 2. Process Deletions
            getNS(xmlDoc, "DeletedInstanceName").forEach(delNode => {
                const objNameNode = getNS(delNode, "ObjectName")[0];
                const objName = objNameNode ? objNameNode.textContent : delNode.textContent;
                let comp = findComp(null, objName);
                if (!comp && objName.includes('_')) {
                    const possibleUid = objName.split('_').pop();
                    comp = allComponents.find(c => c.uid === possibleUid);
                }
                if (comp) { 
                    comp.isDeleted = true; 
                    comp.isIncrementallyDeleted = true;
                    if (isHighlightStep) { stepChanges.push({ uid: comp.uid, text: `${comp.name} gelöscht` }); } 
                }
            });

            // 3. Process Geometric Changes
            const points = {}, polylines = {}, circles = {}, curveSets = {}, shapes = {}, singleItems = {};
            getNS(xmlDoc, "CartesianPoint").forEach(p => points[p.getAttribute("id")] = { x: parseFloat(getNS(p, "X")[0]?.textContent||0), y: parseFloat(getNS(p, "Y")[0]?.textContent||0) });
            getNS(xmlDoc, "PolyLine").forEach(pl => polylines[pl.getAttribute("id")] = getNS(pl, "Point").map(pt => pt.textContent));
            getNS(xmlDoc, "CircleCenter").forEach(c => circles[c.getAttribute("id")] = { centerId: getNS(c, "Center")[0]?.textContent, radius: parseFloat(getNS(getNS(c, "Diameter")[0], "Value")[0]?.textContent||0)/2 });
            const arcs = {}; getNS(xmlDoc, "Arc").forEach(a => arcs[a.getAttribute("id")] = { startId: getNS(a, "StartPoint")[0]?.textContent, endId: getNS(a, "EndPoint")[0]?.textContent, angle: parseFloat(getNS(getNS(a, "IncludeAngle")[0], "Value")[0]?.textContent||0) });
            getNS(xmlDoc, "CurveSet2d").forEach(cs => curveSets[cs.getAttribute("id")] = { thickness: Math.abs(parseFloat(getNS(getNS(cs, "UpperBound")[0], "Value")[0]?.textContent||0) - parseFloat(getNS(getNS(cs, "LowerBound")[0], "Value")[0]?.textContent||0)), elements: getNS(cs,"DetailedGeometricModelElement").map(e => e.textContent) });
            
            ["Stratum", "AssemblyComponent", "KeepIn", "KeepOut", "InterStratumFeature", "Conductor", "Coating", "Net", "Cutout", "Via", "Filled_via", "Plated_passage", "Component_termination_passage"].forEach(tag => {
                getNS(xmlDoc, tag).forEach(node => shapes[node.getAttribute("id")] = { type: tag, shapeElementId: getNS(node,"ShapeElement")[0]?.textContent });
            });
            const shapeElements = {}; getNS(xmlDoc, "ShapeElement").forEach(se => shapeElements[se.getAttribute("id")] = getNS(se,"DefiningShape")[0]?.textContent);
            getNS(xmlDoc, "Item").forEach(item => { if (getNS(item,"ItemType")[0]?.textContent === "single") singleItems[item.getAttribute("id")] = { shapeId: getNS(item,"Shape")[0]?.textContent, number: getNS(getNS(item,"Identifier")[0]||{}, "Number")[0]?.textContent||"Keine Nr." }; });

            getNS(xmlDoc, "Item").forEach(item => {
                if (getNS(item,"ItemType")[0]?.textContent !== "assembly") return;
                getNS(item, "ItemInstance").forEach(inst => {
                    const uid = inst.getAttribute("id"), name = (getNS(inst,"Name")[0]||getNS(inst,"ObjectName")[0])?.textContent||"Unknown";
                    const tx = getNS(inst,"tx")[0], ty = getNS(inst,"ty")[0], tz = getNS(inst,"tz")[0];
                    const x = parseFloat(getNS(tx, "Value")[0]?.textContent || 0), y = parseFloat(getNS(ty, "Value")[0]?.textContent || 0), z = parseFloat(getNS(tz, "Value")[0]?.textContent || 0);
                    let comp = findComp(uid, name); const bZ = window.boardZ || 0;
                    if (comp) {
                        const relZ = comp.isBoard ? 0 : (z - bZ);
                        if (Math.abs(comp.x - x) > 0.001 || Math.abs(comp.y - y) > 0.001 || Math.abs(comp.z - relZ) > 0.001) {
                            if (isHighlightStep) { 
                                const dx = x - comp.x, dy = y - comp.y, dz = relZ - comp.z;
                                let moves = [];
                                if (Math.abs(dx) > 0.001) moves.push(`X: ${dx.toFixed(2)}mm`);
                                if (Math.abs(dy) > 0.001) moves.push(`Y: ${dy.toFixed(2)}mm`);
                                if (Math.abs(dz) > 0.001) moves.push(`Z: ${dz.toFixed(2)}mm`);
                                comp.oldX = comp.x; comp.oldY = comp.y; comp.oldZ = comp.z; comp.isIncrementallyMoved = true; 
                                stepChanges.push({ uid: comp.uid, text: `${comp.name} verschoben (${moves.join(', ')})` });
                            }
                            comp.x = x; comp.y = y; comp.z = relZ;
                        }
                    } else {
                        const nXX = getNS(inst,"xx")[0], nXY = getNS(inst,"xy")[0], nYX = getNS(inst,"yx")[0], nYY = getNS(inst,"yy")[0];
                        let xx = nXX ? parseFloat(nXX.textContent) : 1, xy = nXY ? parseFloat(nXY.textContent) : 0, yx = nYX ? parseFloat(nYX.textContent) : 0, yy = nYY ? parseFloat(nYY.textContent) : 1;
                        const sRef = getNS(inst,"Item")[0]?.textContent;
                        if (sRef && singleItems[sRef]) {
                            const sItem = singleItems[sRef], shape = shapes[sItem.shapeId];
                            if (shape) {
                                const csId = shapeElements[shape.shapeElementId], cs = curveSets[csId];
                                if (cs) {
                                    let polys = [], circs = [], currentP = [];
                                    cs.elements.forEach(elId => {
                                        if (polylines[elId]) polylines[elId].forEach(ptId => { const p = points[ptId]; if (p) currentP.push({ x: p.x*xx+p.y*xy, y: p.x*yx+p.y*yy }); });
                                        else if (arcs[elId]) { const a = arcs[elId], p1 = points[a.startId], p2 = points[a.endId]; if (p1 && p2) { 
                                            const p1x = p1.x*xx+p1.y*xy, p1y = p1.x*yx+p1.y*yy, p2x = p2.x*xx+p2.y*xy, p2y = p2.x*yx+p2.y*yy; if (currentP.length === 0) currentP.push({ x: p1x, y: p1y });
                                            const angleRad = Math.abs(a.angle)*Math.PI/180, d = Math.sqrt((p2x-p1x)**2+(p2y-p1y)**2);
                                            if (d > 0.001 && Math.abs(a.angle) > 0.1) {
                                                const r = Math.abs(d/(2*Math.sin(angleRad/2))), mx = (p1x+p2x)/2, my = (p1y+p2y)/2, h = (Math.abs(a.angle)===180)?0:Math.abs((d/2)/Math.tan(angleRad/2));
                                                const vx = p2x-p1x, vy = p2y-p1y, nx = -vy/d, ny = vx/d, cx = mx + (a.angle>0?1:-1)*h*nx, cy = my + (a.angle>0?1:-1)*h*ny, sA = Math.atan2(p1y-cy, p1x-cx), eA = Math.atan2(p2y-cy, p2x-cx);
                                                let sweep = eA - sA; if (a.angle>0 && sweep<0) sweep += Math.PI*2; if (a.angle<0 && sweep>0) sweep -= Math.PI*2;
                                                for(let i=1; i<=12; i++) { const ang = sA + (sweep*i/12); currentP.push({ x: cx+r*Math.cos(ang), y: cy+r*Math.sin(ang) }); }
                                            }
                                        } }
                                        else if (circles[elId]) { const cp = points[circles[elId].centerId]; if (cp) circs.push({ cx: cp.x*xx+cp.y*xy, cy: cp.x*yx+cp.y*yy, radius: circles[elId].radius*Math.abs(xx) }); }
                                    });
                                    if (currentP.length > 0) polys.push(currentP);
                                    const isBottom = (getNS(inst,"AssembleToName")[0]?.textContent || "").toUpperCase() === "BOTTOM";
                                    allComponents.push({ uid: uid || `COMP_INC_${allComponents.length}`, name, refDes: (getNS(inst,"Name")[0]||getNS(inst,"ObjectName")[0])?.textContent||"Unknown", partNumber: sItem.number, x, y, z: z-bZ, origX: x, origY: y, origZ: z-bZ, thickness: cs.thickness, polygons: polys, circles: circs, isBoard: false, isBottom, type: shape.type, isVisible: true, isDeleted: false, isIncrementallyAdded: isHighlightStep });
                                    if (isHighlightStep) stepChanges.push(`Hinzugefügt: ${name}`);
                                }
                            }
                        }
                    }
                });
            });
        }

        document.getElementById('hist-prev-btn').onclick = () => { if (currentHistoryStep > -1) { currentHistoryStep--; updateHistoryUI(); applyHistoryStep(currentHistoryStep); } };
        document.getElementById('hist-next-btn').onclick = () => { if (currentHistoryStep < incrementHistory.length - 1) { currentHistoryStep++; updateHistoryUI(); applyHistoryStep(currentHistoryStep); } };
        document.getElementById('discard-changes-btn').onclick = () => {
            if (confirm("Alle aktuellen Änderungen (Verschiebungen/Manuelle Bauteile) verwerfen?")) {
                allComponents = JSON.parse(JSON.stringify(baselineComponents));
                // If there are increments, we should re-apply up to the last step
                if (incrementHistory.length > 0) {
                    applyHistoryStep(incrementHistory.length - 1);
                } else {
                    build3DScene(allComponents, window.lastBoardThickness || 1.6);
                }
                currentHistoryStep = incrementHistory.length - 1;
                updateHistoryUI();
            }
        };

        document.getElementById('hintmap-input').addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                hintMap = {}; const blocks = ev.target.result.split('map_objects_by_name->');
                blocks.forEach(b => { const ecad = b.match(/ECAD_NAME\s+"([^"]+)"/i), mcad = b.match(/MCAD_NAME\s+"([^"]+)"/i); if (ecad && mcad) hintMap[ecad[1]] = mcad[1]; });
                
                if (allComponents.length > 0) {
                    const affected = allComponents.filter(c => hintMap[c.name] || hintMap[c.partNumber]);
                    const report = new Set(affected.map(c => `${c.name} (${c.partNumber}) -> ${hintMap[c.name] || hintMap[c.partNumber]}`));
                    console.log("MCAD Mapping Report generated");
                    build3DScene(allComponents, 1.6);
                }
                if (loadedOBJFiles.length > 0) processOBJFiles(loadedOBJFiles, true);
            };
            reader.readAsText(file);
        });

        document.getElementById('obj-toggle').addEventListener('change', e => { showDetailed = e.target.checked; toggleModelType(); });
        document.getElementById('mcad-toggle').addEventListener('change', e => { 
            useMCADNames = e.target.checked; 
            if (allComponents.length > 0) {
                build3DScene(allComponents, 1.6); 
                document.getElementById('search-input').dispatchEvent(new Event('input'));
            }
        });
        document.getElementById('obj-input').addEventListener('change', async e => { loadedOBJFiles = Array.from(e.target.files); await processOBJFiles(loadedOBJFiles, false); });

        async function processOBJFiles(allSelectedFiles, silent) {
            const files = allSelectedFiles.filter(f => f.name.toLowerCase().endsWith('.obj')), ignoredFiles = allSelectedFiles.filter(f => !f.name.toLowerCase().endsWith('.obj')).map(f => f.name);
            if (files.length === 0) { if (!silent) alert("Keine .obj Dateien!"); return; }
            const pC = document.getElementById('obj-progress-container'), pB = document.getElementById('obj-progress-bar'), pT = document.getElementById('obj-progress-text');
            pC.style.display = 'block'; const map = {};
            allComponents.forEach(c => { 
                const paddedPart = formatMaterialNumber(c.partNumber), mappedPart = hintMap[c.partNumber], paddedMapped = mappedPart ? formatMaterialNumber(mappedPart) : null;
                [c.name, c.partNumber, paddedPart, hintMap[c.name], mappedPart, paddedMapped].forEach(n => { if (n && n !== "Keine Nr." && n !== "Unknown") { const k = n.toLowerCase(); if (!map[k]) map[k] = []; if (!map[k].includes(c.uid)) map[k].push(c.uid); } });
            });
            let count = 0; const replaced = new Set(), unmatched = [];
            for (const f of files) {
                const baseName = f.name.split('/').pop().split('\\').pop().trim(), cleanName = baseName.replace(/.obj$/i, '').toLowerCase(), ids = map[cleanName];
                if (ids) { for (const id of ids) { if (!detailedMeshes[id]) await replaceWithOBJ(id, f, 1, true); const comp = allComponents.find(c => c.uid === id); if (comp) replaced.add(`${baseName} -> ${comp.partNumber} (${comp.name})`); } }
                else { unmatched.push(baseName); }
                count++; pB.style.width = (count/files.length)*100 + '%'; pT.innerText = `Lade ${count}/${files.length}...`;
            }
            setTimeout(() => { pC.style.display = 'none'; console.log("OBJ mapping report generated"); }, 500);
        }

        function getNS(node, tag) { if (!node) return []; return Array.from(node.getElementsByTagNameNS("*", tag)); }
        function formatMaterialNumber(num) { if (/^\d+$/.test(num)) return num.padStart(18, '0'); return num; }

        function processIDX(xmlText) {
            const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml"), points = {}, polylines = {}, circles = {}, curveSets = {}, shapes = {}, singleItems = {};
            getNS(xmlDoc, "CartesianPoint").forEach(p => points[p.getAttribute("id")] = { x: parseFloat(getNS(p, "X")[0]?.textContent||0), y: parseFloat(getNS(p, "Y")[0]?.textContent||0) });
            getNS(xmlDoc, "PolyLine").forEach(pl => polylines[pl.getAttribute("id")] = getNS(pl, "Point").map(pt => pt.textContent));
            getNS(xmlDoc, "CircleCenter").forEach(c => circles[c.getAttribute("id")] = { centerId: getNS(c, "Center")[0]?.textContent, radius: parseFloat(getNS(getNS(c, "Diameter")[0], "Value")[0]?.textContent||0)/2 });
            const arcs = {}; getNS(xmlDoc, "Arc").forEach(a => arcs[a.getAttribute("id")] = { startId: getNS(a, "StartPoint")[0]?.textContent, endId: getNS(a, "EndPoint")[0]?.textContent, angle: parseFloat(getNS(getNS(a, "IncludeAngle")[0], "Value")[0]?.textContent||0) });
            getNS(xmlDoc, "CurveSet2d").forEach(cs => curveSets[cs.getAttribute("id")] = { lower: parseFloat(getNS(getNS(cs, "LowerBound")[0], "Value")[0]?.textContent||0), thickness: Math.abs(parseFloat(getNS(getNS(cs, "UpperBound")[0], "Value")[0]?.textContent||0) - parseFloat(getNS(getNS(cs, "LowerBound")[0], "Value")[0]?.textContent||0))||0.1, elements: getNS(cs,"DetailedGeometricModelElement").map(e => e.textContent) });
            ["Stratum", "AssemblyComponent", "KeepIn", "KeepOut", "InterStratumFeature", "Conductor", "Coating", "Net", "Cutout", "Via", "Filled_via", "Plated_passage", "Component_termination_passage"].forEach(tag => {
                getNS(xmlDoc, tag).forEach(node => shapes[node.getAttribute("id")] = { type: getNS(node,"InterStratumFeatureType")[0]?.textContent||tag, shapeElementId: getNS(node,"ShapeElement")[0]?.textContent, designation: getNS(node,"StratumSurfaceDesignation")[0]?.textContent, xmlId: node.getAttribute("id") });
            });
            const shapeElements = {}; getNS(xmlDoc, "ShapeElement").forEach(se => shapeElements[se.getAttribute("id")] = getNS(se,"DefiningShape")[0]?.textContent);
            getNS(xmlDoc, "Item").forEach(item => { if (getNS(item,"ItemType")[0]?.textContent === "single") singleItems[item.getAttribute("id")] = { shapeId: getNS(item,"Shape")[0]?.textContent, number: getNS(getNS(item,"Identifier")[0]||{}, "Number")[0]?.textContent||"Keine Nr." }; });
            allComponents.length = 0; let boardThickness = 1.6, boardZ = 0;
            getNS(xmlDoc, "Item").forEach(item => {
                if (getNS(item,"ItemType")[0]?.textContent !== "assembly") return;
                getNS(item, "ItemInstance").forEach(inst => {
                    const name = (getNS(inst,"Name")[0]||getNS(inst,"ObjectName")[0])?.textContent||"", sRef = getNS(inst,"Item")[0]?.textContent;
                    if (sRef && singleItems[sRef]) {
                        const sItem = singleItems[sRef], shape = shapes[sItem.shapeId];
                        if (shape) {
                            const csId = shapeElements[shape.shapeElementId], cs = curveSets[csId];
                            if (cs && (name.includes("CREO_TEST1") || (shape.type==="Stratum" && shape.designation==="PrimarySurface" && cs.thickness > 0.5))) {
                                boardThickness = cs.thickness; window.lastBoardThickness = boardThickness;
                                const tzNode = getNS(inst, "tz")[0]; if (tzNode) { boardZ = parseFloat(getNS(tzNode, "Value")[0]?.textContent || 0); window.boardZ = boardZ; }
                            }
                        }
                    }
                });
            });
            getNS(xmlDoc, "Item").forEach(item => {
                if (getNS(item,"ItemType")[0]?.textContent !== "assembly") return;
                getNS(item, "ItemInstance").forEach(inst => {
                    const refDes = getNS(inst,"Name")[0]?.textContent || "";
                    const instNameNode = getNS(inst,"InstanceName")[0];
                    const instName = instNameNode ? getNS(instNameNode,"ObjectName")[0]?.textContent || "" : "";
                    const name = refDes || instName || "Unknown", isBottom = (getNS(inst,"AssembleToName")[0]?.textContent || "").toUpperCase() === "BOTTOM";
                    const tx = getNS(inst,"tx")[0], ty = getNS(inst,"ty")[0], tz = getNS(inst,"tz")[0];
                    let x = parseFloat(getNS(tx, "Value")[0]?.textContent || 0), y = parseFloat(getNS(ty, "Value")[0]?.textContent || 0), z = parseFloat(getNS(tz, "Value")[0]?.textContent || 0);
                    const nXX = getNS(inst,"xx")[0], nXY = getNS(inst,"xy")[0], nYX = getNS(inst,"yx")[0], nYY = getNS(inst,"yy")[0];
                    let xx = nXX ? parseFloat(nXX.textContent) : 1, xy = nXY ? parseFloat(nXY.textContent) : 0, yx = nYX ? parseFloat(nYX.textContent) : 0, yy = nYY ? parseFloat(nYY.textContent) : 1;
                    const sRef = getNS(inst,"Item")[0]?.textContent;
                    if (sRef && singleItems[sRef]) {
                        const sItem = singleItems[sRef], shape = shapes[sItem.shapeId];
                        if (shape) {
                            const csId = shapeElements[shape.shapeElementId], cs = curveSets[csId];
                            if (cs) {
                                let polys = [], circs = [], currentP = [];
                                cs.elements.forEach(elId => {
                                    if (polylines[elId]) polylines[elId].forEach(ptId => { const p = points[ptId]; if (p) currentP.push({ x: p.x*xx+p.y*xy, y: p.x*yx+p.y*yy }); });
                                    else if (arcs[elId]) { const a = arcs[elId], p1 = points[a.startId], p2 = points[a.endId]; if (p1 && p2) { 
                                        const p1x = p1.x*xx+p1.y*xy, p1y = p1.x*yx+p1.y*yy, p2x = p2.x*xx+p2.y*xy, p2y = p2.x*yx+p2.y*yy; if (currentP.length === 0) currentP.push({ x: p1x, y: p1y });
                                        const angleRad = Math.abs(a.angle)*Math.PI/180, d = Math.sqrt((p2x-p1x)**2+(p2y-p1y)**2);
                                        if (d > 0.001 && Math.abs(a.angle) > 0.1) {
                                            const r = Math.abs(d/(2*Math.sin(angleRad/2))), mx = (p1x+p2x)/2, my = (p1y+p2y)/2, h = (Math.abs(a.angle)===180)?0:Math.abs((d/2)/Math.tan(angleRad/2));
                                            const vx = p2x-p1x, vy = p2y-p1y, nx = -vy/d, ny = vx/d, cx = mx + (a.angle>0?1:-1)*h*nx, cy = my + (a.angle>0?1:-1)*h*ny, sA = Math.atan2(p1y-cy, p1x-cx), eA = Math.atan2(p2y-cy, p2x-cx);
                                            let sweep = eA - sA; if (a.angle>0 && sweep<0) sweep += Math.PI*2; if (a.angle<0 && sweep>0) sweep -= Math.PI*2;
                                            for(let i=1; i<=12; i++) { const ang = sA + (sweep*i/12); currentP.push({ x: cx+r*Math.cos(ang), y: cy+r*Math.sin(ang) }); }
                                        }
                                    } }
                                    else if (circles[elId]) { const cp = points[circles[elId].centerId]; if (cp) circs.push({ cx: cp.x*xx+cp.y*xy, cy: cp.x*yx+cp.y*yy, radius: circles[elId].radius*Math.abs(xx) }); }
                                });
                                if (currentP.length > 0) polys.push(currentP);
                                const isBoard = name.includes("CREO_TEST1") || (shape.type==="Stratum" && shape.designation==="PrimarySurface" && cs.thickness > 0.5);
                                allComponents.push({ uid: inst.getAttribute("id")||`COMP_${allComponents.length}`, name, refDes, instName, partNumber: sItem.number, x, y, z: z-boardZ, origX: x, origY: y, origZ: z-boardZ, thickness: cs.thickness, polygons: polys, circles: circs, isBoard, isBottom, type: shape.type, isVisible: !["Cutout", "KeepOut", "KeepIn", "Conductor", "Net", "Coating", "Via", "Filled_via", "Plated_passage", "Component_termination_passage"].includes(shape.type), isDeleted: false });
                            }
                        }
                    }
                });
            });
            build3DScene(allComponents, boardThickness);
        }

        function toggleTypeVisibility(type, isVisible) {
            allComponents.filter(c => c.type === type).forEach(comp => {
                comp.isVisible = !!isVisible;
                if (simplifiedMeshes[comp.uid]) simplifiedMeshes[comp.uid].userData.isVisible = !!isVisible;
                if (detailedMeshes[comp.uid]) detailedMeshes[comp.uid].userData.isVisible = !!isVisible;
                if (meshes[comp.uid]) meshes[comp.uid].visible = !!isVisible && !comp.isDeleted;
                const t = document.querySelector(`.tree-item[data-uid="${CSS.escape(comp.uid)}"] .visibility-toggle`); if (t) { t.classList.toggle('hidden', !isVisible); t.innerHTML = isVisible ? '👁️' : '🕶️'; }
            });
            updateView();
        }

        function build3DScene(components, boardThickness) {
            scene.remove(currentGroup); currentGroup = new THREE.Group(); currentGroup.rotation.x = -Math.PI / 2; scene.add(currentGroup);
            for (let k in meshes) delete meshes[k]; simplifiedMeshes = {}; detailedMeshes = {};
            const uiList = document.getElementById('components-list'); uiList.innerHTML = '';
            const cutouts = components.filter(c => c.type === "Cutout" || c.name.includes("HOLE") || c.isDeleted);
            let boardComp = null, boardMesh = null; const features = [], parts = [];

            components.forEach(comp => {
                const shapes = [];
                comp.polygons.forEach(poly => {
                    const s = new THREE.Shape(); if (poly.length > 2) {
                        s.moveTo(poly[0].x, poly[0].y); for(let i=1; i<poly.length; i++) s.lineTo(poly[i].x, poly[i].y); s.closePath();
                        if (comp.isBoard) cutouts.forEach(c => {
                            (c.circles||[]).forEach(circ => { const p = new THREE.Path(); p.absarc(circ.cx+c.x-comp.x, circ.cy+c.y-comp.y, circ.radius, 0, Math.PI*2, true); s.holes.push(p); });
                            (c.polygons||[]).forEach(cp => { if (cp.length > 2) { const p = new THREE.Path(); p.moveTo(cp[0].x+c.x-comp.x, cp[0].y+c.y-comp.y); for(let j=1; j<cp.length; j++) p.lineTo(cp[j].x+c.x-comp.x, cp[j].y+c.y-comp.y); p.closePath(); s.holes.push(p); } });
                        });
                        shapes.push(s);
                    }
                });
                (comp.circles||[]).forEach(c => { const s = new THREE.Shape(); s.absarc(c.cx, c.cy, c.radius, 0, Math.PI*2, false); shapes.push(s); });
                if (shapes.length === 0 && !comp.isBoard) return;

                const geom = new THREE.ExtrudeGeometry(shapes, { depth: (comp.isBottom && !comp.isBoard)?-comp.thickness:comp.thickness, bevelEnabled: false });
                geom.computeVertexNormals();
                const isCurrentStep = (currentHistoryStep === 999);
                let isHighlightAdd = !!comp.isIncrementallyAdded;
                let isHighlightMove = !!comp.isIncrementallyMoved;
                let isHighlightDel = !!comp.isIncrementallyDeleted;
                if (isCurrentStep) {
                    if (window.activeManualChangeUid) {
                        isHighlightAdd = !!comp.isManuallyAdded && comp.uid === window.activeManualChangeUid;
                        isHighlightMove = !!comp.isModified && !comp.isDeleted && comp.uid === window.activeManualChangeUid;
                        isHighlightDel = !!comp.isDeleted && comp.manualDeletedState !== undefined && comp.uid === window.activeManualChangeUid;
                    } else {
                        isHighlightAdd = false;
                        isHighlightMove = false;
                        isHighlightDel = false;
                    }
                }

                let color = 0x0fbcf9; 
                if (isHighlightAdd) color = 0x0b5345; else if (isHighlightMove) color = 0xf1c40f; else if (isHighlightDel) color = 0xe74c3c; else if (comp.isBoard) color = 0x27ae60;
                else if (comp.type === "Conductor" || comp.type === "Net") color = 0xe67e22; else if (comp.type === "Via" || comp.type === "Filled_via" || comp.type === "Plated_passage") color = 0x8e44ad; else if (comp.type.includes("Keep")) color = 0xe74c3c;

                const isGhost = isHighlightDel, mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, transparent: !!(comp.type==="Cutout" || isGhost), opacity: parseFloat(comp.type==="Cutout"?0.4:(isGhost?0.3:1.0)) });
                const mesh = new THREE.Mesh(geom, mat); mesh.userData.uid = comp.uid; mesh.userData.isVisible = !!comp.isVisible; simplifiedMeshes[comp.uid] = mesh; meshes[comp.uid] = mesh;
                mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geom), new THREE.LineBasicMaterial({ color: 0, transparent: !!isGhost, opacity: isGhost?0.1:1.0 })));

                let zPos = comp.isBoard ? 0 : comp.z;
                if (!comp.isBoard && !comp.isBottom && Math.abs(zPos) < 0.01) zPos = boardThickness;
                mesh.position.set(comp.x, comp.y, zPos); mesh.visible = !!comp.isVisible && (!comp.isDeleted || isGhost); currentGroup.add(mesh);

                let showMoveGhost = false, origGhostX = 0, origGhostY = 0, origGhostZ = 0;
                if (isCurrentStep && isHighlightMove) { showMoveGhost = true; origGhostX = comp.origX; origGhostY = comp.origY; origGhostZ = comp.origZ; }
                else if (!isCurrentStep && !!comp.isIncrementallyMoved && comp.oldX !== undefined) { showMoveGhost = true; origGhostX = comp.oldX; origGhostY = comp.oldY; origGhostZ = comp.oldZ; }

                if (showMoveGhost) {
                    const gM = new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.5, transparent: true, opacity: 0.3 });
                    const gMesh = new THREE.Mesh(geom, gM); gMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geom), new THREE.LineBasicMaterial({ color: 0, transparent: true, opacity: 0.1 })));
                    let gzPos = comp.isBoard ? 0 : origGhostZ;
                    if (!comp.isBoard && !comp.isBottom && Math.abs(gzPos) < 0.01) gzPos = boardThickness;
                    gMesh.position.set(origGhostX, origGhostY, gzPos); currentGroup.add(gMesh);
                }
                
                let showInTree = true;
                if (comp.isDeleted) {
                    if (isCurrentStep) showInTree = (comp.manualDeletedState !== undefined);
                    else showInTree = isHighlightDel;
                }
                if (comp.isBoard) { boardComp = comp; boardMesh = mesh; window.boardUid = comp.uid; } 
                else if (showInTree) {
                    if (comp.type !== "AssemblyComponent") features.push({ comp, mesh }); else parts.push({ comp, mesh });
                }
            });

            if (boardComp) {
                const w = document.createElement('div'); w.className = 'board-wrapper'; uiList.appendChild(w); addTreeItem(boardComp, boardMesh, w, true);
                const c = document.createElement('div'); c.className = 'board-children'; c.style.paddingLeft = '15px'; c.style.display = 'none'; w.appendChild(c); features.forEach(f => addTreeItem(f.comp, f.mesh, c));
            }
            parts.forEach(p => addTreeItem(p.comp, p.mesh, uiList));
            
            const tF = document.getElementById('type-filters');
            if (tF) { tF.innerHTML = ''; const types = [...new Set(components.map(c => c.type))].sort(); types.forEach(t => {
                const lbl = document.createElement('label'); lbl.style.cssText = 'font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 5px; color: #d2dae2;';
                const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !["Cutout", "KeepOut", "KeepIn", "Conductor", "Net", "Coating", "Via", "Filled_via", "Plated_passage", "Component_termination_passage"].includes(t);
                cb.addEventListener('change', (e) => toggleTypeVisibility(t, e.target.checked)); lbl.appendChild(cb); lbl.appendChild(document.createTextNode(t)); tF.appendChild(lbl);
            }); }
            updateView(); document.getElementById('loading').style.display='none'; document.getElementById('file-stats').innerText=`${components.length} Elemente.`; 
            document.getElementById('export-btn').style.display='flex'; 
            document.getElementById('export-inc-btn').style.display='flex';
            if (document.getElementById('export-resp-btn')) document.getElementById('export-resp-btn').style.display='flex';
        }

        function updateView() {
            currentGroup.updateMatrixWorld(true); const box = new THREE.Box3(); let has = false;
            currentGroup.children.forEach(m => { if (m.visible) { box.expandByObject(m); has = true; } });
            if (!has && window.boardUid) box.setFromObject(meshes[window.boardUid]); else if (!has) box.setFromObject(currentGroup);
            const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), dist = Math.max(size.x, size.y, size.z)*1.5||200;
            camera.position.set(center.x+dist, center.y+dist, center.z+dist); controls.target.copy(center); controls.update();
        }

        function toggleModelType() { for (let id in simplifiedMeshes) { const s = simplifiedMeshes[id], d = detailedMeshes[id]; if (d) { const vis = s.userData.isVisible; s.visible = !showDetailed && vis; d.visible = showDetailed && vis; meshes[id] = showDetailed ? d : s; } } }
        async function replaceWithOBJ(uid, file, scale = 1) {
            return new Promise(resolve => {
                const reader = new FileReader(); reader.onload = ev => {
                    try {
                        const loader = new THREE.OBJLoader(), object = loader.parse(ev.target.result), old = simplifiedMeshes[uid]; if (!old) return resolve();
                        const comp = allComponents.find(c => c.uid === uid), shouldFlip = document.getElementById('obj-flip-toggle').checked;
                        object.position.copy(old.position); object.rotation.copy(old.rotation); object.rotation.order = 'YXZ'; 
                        if (shouldFlip) object.rotateX(comp && comp.isBottom ? -Math.PI/2 : Math.PI/2); else if (comp && comp.isBottom) { object.rotateY(Math.PI); object.rotateX(Math.PI); }
                        object.scale.set(scale, scale, scale); object.traverse(c => { if (c.isMesh) { c.userData.uid = uid; c.castShadow = true; c.material = new THREE.MeshStandardMaterial({ color: 0x95a5a6, roughness: 0.4 }); }});
                        object.userData.uid = uid; detailedMeshes[uid] = object; currentGroup.add(object);
                        const tempObj = object.clone(); tempObj.position.set(0,0,0); tempObj.updateMatrixWorld(true); const localBox = new THREE.Box3().setFromObject(tempObj);
                        if (comp) { comp.minX = localBox.min.x; comp.maxX = localBox.max.x; comp.minY = localBox.min.y; comp.maxY = localBox.max.y; comp.minZ = localBox.min.z; comp.maxZ = localBox.max.z; }
                        const v = old.userData.isVisible; old.visible = !showDetailed && v; object.visible = showDetailed && v; if (showDetailed) meshes[uid] = object;
                    } catch (err) { console.error("OBJ Error:", err); }
                    resolve();
                };
                reader.readAsText(file);
            });
        }

        const selectedComponents = new Set(); let dragSrcEl = null, lastClickedUid = null;
        function handleDragStart(e) { const id = this.dataset.uid; if (!selectedComponents.has(id)) handleSelection(id, false, false); this.classList.add('dragging'); dragSrcEl = this; e.dataTransfer.effectAllowed = 'move'; }
        function handleDragOver(e) { if (e.preventDefault) e.preventDefault(); this.classList.add('over'); return false; }
        function handleDragLeave() { this.classList.remove('over'); }
        function handleDrop(e) {
            if (e.stopPropagation) e.stopPropagation();
            if (dragSrcEl !== this && dragSrcEl.parentElement === this.parentElement) {
                const getM = el => el.closest('.board-wrapper') || el, target = getM(this), items = [...new Set(selectedComponents.has(dragSrcEl.dataset.uid) ? Array.from(document.querySelectorAll('.tree-item')).filter(el => selectedComponents.has(el.dataset.uid) && el.parentElement === this.parentElement).map(getM) : [getM(dragSrcEl)])];
                const all = Array.from(this.parentElement.children); if (all.indexOf(getM(dragSrcEl)) < all.indexOf(target)) items.reverse().forEach(it => target.after(it)); else items.forEach(it => target.before(it));
            }
            this.classList.remove('over'); return false;
        }

        function addTreeItem(comp, meshT, container, isP = false) {
            const item = document.createElement('div'); item.className = 'tree-item'; item.draggable = true; item.dataset.uid = comp.uid;
            const isManual = comp.isManuallyAdded, mappedName = (useMCADNames && hintMap[comp.name]) ? hintMap[comp.name] : null, mappedPart = (useMCADNames && hintMap[comp.partNumber]) ? hintMap[comp.partNumber] : null;
            const dN = mappedName || (comp.isBoard ? 'Platine (Basis)' : comp.name), dP = mappedPart || comp.partNumber;
            item.dataset.name = dN; item.dataset.part = dP; if (selectedComponents.has(comp.uid)) item.classList.add('selected'); if (comp.isDeleted) item.classList.add('is-deleted');
            item.addEventListener('dragstart', handleDragStart); item.addEventListener('dragover', handleDragOver); item.addEventListener('dragleave', handleDragLeave); item.addEventListener('drop', handleDrop); item.addEventListener('dragend', function() { this.classList.remove('dragging'); });
            item.addEventListener('click', e => handleSelection(comp.uid, e.ctrlKey || e.metaKey, e.shiftKey));
            if (isP) { const a = document.createElement('span'); a.innerHTML = '▶'; a.style.cssText = 'cursor:pointer; margin-right:5px; font-size:10px; width:12px;'; a.onclick = e => { e.stopPropagation(); const c = item.nextElementSibling; if (c?.classList.contains('board-children')) { const h = c.style.display !== 'none'; c.style.display = h ? 'none' : 'block'; a.innerHTML = h ? '▶' : '▼'; } }; item.appendChild(a); }
            const vT = document.createElement('div'); vT.className = 'visibility-toggle'; vT.innerHTML = comp.isVisible ? '👁️' : '🕶️'; if (!comp.isVisible) vT.classList.add('hidden');
            vT.onclick = e => { e.stopPropagation(); toggleVisualVisibility(comp.uid, comp.isVisible); };
            const eT = document.createElement('div'); eT.className = 'delete-toggle'; eT.innerHTML = '🗑️'; if (comp.isDeleted) eT.classList.add('deleted');
            eT.onclick = e => { e.stopPropagation(); toggleExportExclusion(comp.uid, !comp.isDeleted); };
            const content = document.createElement('div'); content.className = 'item-content'; const ns = document.createElement('span'); ns.className = 'item-name'; 
            const isCurrentStep = (currentHistoryStep === 999);
            let isAdded = false, isMoved = false, isDeleted = false;
            if (isCurrentStep) {
                isAdded = !!comp.isManuallyAdded;
                isMoved = !!comp.isModified && !comp.isDeleted;
                isDeleted = !!comp.isDeleted && comp.manualDeletedState !== undefined;
            } else {
                isAdded = !!comp.isIncrementallyAdded;
                isMoved = !!comp.isIncrementallyMoved;
                isDeleted = !!comp.isIncrementallyDeleted;
            }
            if (isAdded) item.classList.add('is-new'); if (isMoved) item.classList.add('is-modified'); if (isDeleted) item.classList.add('is-deleted');
            let exI = isAdded ? ' ✨' : (isMoved ? ' ✏️' : (isDeleted ? ' ❌' : '')); ns.innerText = dN + exI; content.appendChild(ns);
            if (dP && dP !== "Keine Nr." && !comp.isBoard) { const ps = document.createElement('span'); ps.className = 'part-number'; ps.innerText = `Nr: ${formatMaterialNumber(dP)}`; content.appendChild(ps); }
            item.appendChild(vT); item.appendChild(eT); item.appendChild(document.createElement('span')).className = 'item-icon'; item.lastChild.innerText = comp.isBoard ? '📁' : '📦';
            item.appendChild(content); container.appendChild(item);
        }

        function toggleVisualVisibility(uid, curVisible) {
            const targets = selectedComponents.has(uid) ? Array.from(selectedComponents) : [uid];
            targets.forEach(id => {
                const newState = !curVisible, comp = allComponents.find(c => c.uid === id); if (comp) comp.isVisible = newState;
                if (simplifiedMeshes[id]) simplifiedMeshes[id].userData.isVisible = newState; if (detailedMeshes[id]) detailedMeshes[id].userData.isVisible = newState; if (meshes[id]) meshes[id].visible = newState;
                const t = document.querySelector(`.tree-item[data-uid="${CSS.escape(id)}"] .visibility-toggle`); if (t) { t.classList.toggle('hidden', !newState); t.innerHTML = newState ? '👁️' : '🕶️'; }
            });
        }

        function toggleExportExclusion(uid, del) {
            const targets = selectedComponents.has(uid) ? Array.from(selectedComponents) : [uid];
            targets.forEach(id => {
                const comp = allComponents.find(c => c.uid === id); if (comp) { comp.isDeleted = del; comp.isModified = true; comp.manualDeletedState = del; }
                const t = document.querySelector(`.tree-item[data-uid="${CSS.escape(id)}"] .delete-toggle`), tr = document.querySelector(`.tree-item[data-uid="${CSS.escape(id)}"]`);
                if (t) { t.classList.toggle('deleted', del); if (tr) tr.classList.toggle('is-deleted', del); if (del) { if (meshes[id]) meshes[id].visible = false; } }
            });
            if(window.saveManualState) window.saveManualState();
            currentHistoryStep = 999; applyHistoryStep(999).then(() => updateHistoryUI());
        }

        renderer.domElement.tabIndex = 1; const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2(); let pStart = { x: 0, y: 0 };
        renderer.domElement.addEventListener('pointerdown', (e) => {
            renderer.domElement.focus(); if (e.button !== 0) return; 
            if (e.ctrlKey || e.metaKey) { try { Object.defineProperty(e, 'shiftKey', { get: () => true }); } catch (err) {} }
            pStart.x = e.clientX; pStart.y = e.clientY;
            const onUp = (ue) => { window.removeEventListener('pointerup', onUp); if (Math.sqrt((ue.clientX-pStart.x)**2+(ue.clientY-pStart.y)**2) < 5) processPointerSelection(ue); };
            window.addEventListener('pointerup', onUp);
        }, true);

        function processPointerSelection(e) {
            mouse.x = (e.clientX/window.innerWidth)*2-1; mouse.y = -(e.clientY/window.innerHeight)*2+1; raycaster.setFromCamera(mouse, camera);
            const ints = raycaster.intersectObjects(currentGroup.children.filter(m => m.visible), true);
            if (ints.length > 0) { let o = ints[0].object; while (o && (!o.userData || !o.userData.uid) && o.parent) o = o.parent; const id = o?.userData?.uid; if (id) handleSelection(id, e.ctrlKey || e.metaKey, e.shiftKey); }
            else handleSelection(null, e.ctrlKey || e.metaKey, e.shiftKey);
        }

        
        function updateSelectionVisuals() {
            for(let k in meshes) { const c = selectedComponents.has(k) ? 0x2980b9 : 0; meshes[k].traverse(n => { if (n.isMesh && n.material) { const m = Array.isArray(n.material) ? n.material[0] : n.material; if (m.emissive) m.emissive.setHex(c); } }); }
            document.querySelectorAll('.tree-item').forEach(el => el.classList.toggle('selected', selectedComponents.has(el.dataset.uid)));
        }
function handleSelection(id, ctrl, shift) {
            if (!id) { if (!ctrl && !shift) selectedComponents.clear(); }
            else {
                if (shift && lastClickedUid) {
                    const all = Array.from(document.querySelectorAll('.tree-item')), s = all.findIndex(el => el.dataset.uid === lastClickedUid), e = all.findIndex(el => el.dataset.uid === id);
                    if (s!==-1 && e!==-1) { if (!ctrl) selectedComponents.clear(); for (let i = Math.min(s, e); i <= Math.max(s, e); i++) if (all[i].style.display !== 'none') selectedComponents.add(all[i].dataset.uid); }
                } else if (ctrl) { if (selectedComponents.has(id)) selectedComponents.delete(id); else selectedComponents.add(id); }
                else { selectedComponents.clear(); selectedComponents.add(id); }
                lastClickedUid = id;
            }
            for(let k in meshes) { const c = selectedComponents.has(k) ? 0x2980b9 : 0; meshes[k].traverse(n => { if (n.isMesh && n.material) { const m = Array.isArray(n.material) ? n.material[0] : n.material; if (m.emissive) m.emissive.setHex(c); } }); }
            document.querySelectorAll('.tree-item').forEach(el => el.classList.toggle('selected', selectedComponents.has(el.dataset.uid)));
            if (id) { const el = document.querySelector(`.tree-item[data-uid="${CSS.escape(id)}"]`); if (el) { const c = el.closest('.board-children'); if (c && c.style.display === 'none') { c.style.display = 'block'; const p = c.previousElementSibling; if (p) p.querySelector('span').innerHTML = '▼'; } el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } }
            const editHeader = document.getElementById('edit-component-section-header'), editSec = document.getElementById('edit-component-section');
            if (selectedComponents.size === 1) { 
                const selId = Array.from(selectedComponents)[0], mesh = meshes[selId] || simplifiedMeshes[selId]; 
                if (mesh) { 
                    document.getElementById('edit-comp-x').value = mesh.position.x.toFixed(3); 
                    document.getElementById('edit-comp-y').value = mesh.position.y.toFixed(3); 
                    document.getElementById('edit-comp-z').value = mesh.position.z.toFixed(3); 
                    if (editHeader) { editHeader.style.display = 'flex'; editHeader.classList.remove('collapsed'); editSec.classList.remove('collapsed'); } 
                }
            }
            else {
                if (editHeader) { editHeader.style.display = 'none'; editSec.classList.add('collapsed'); }
            }
        }

        window.setResponse = (uid, status) => {
            if (!window.manualStateResponses) window.manualStateResponses = {};
            window.manualStateResponses[uid] = status;
            const comp = allComponents.find(c => c.uid === uid);
            if (comp) comp.acceptStatus = status;
            updateHistoryUI();
        };

        function moveSelectedItems(direction) {
            if (selectedComponents.size === 0) return;
            const items = Array.from(document.querySelectorAll('.tree-item.selected')), containers = new Map();
            items.forEach(it => { const isBoard = it.dataset.uid === window.boardUid, block = isBoard ? (it.closest('.board-wrapper') || it) : it; if (block.classList.contains('board-wrapper') && it.parentElement.id === 'components-list') return; const p = block.parentElement; if (!containers.has(p)) containers.set(p, []); if (!containers.get(p).includes(block)) containers.get(p).push(block); });
            containers.forEach((selItems, container) => {
                if (direction === 'top') { let iB = container.firstChild; if (container.id === 'components-list') { const fB = container.querySelector('.board-wrapper'); if (fB && fB.parentElement === container) iB = fB.nextSibling; } selItems.forEach(it => container.insertBefore(it, iB)); }
                else if (direction === 'bottom') { selItems.forEach(it => container.appendChild(it)); }
            });
        }
        document.getElementById('move-top-btn').addEventListener('click', () => moveSelectedItems('top'));
        document.getElementById('move-bottom-btn').addEventListener('click', () => moveSelectedItems('bottom'));
        
        const sIn = document.getElementById('search-input'), cBtn = document.getElementById('clear-search-btn');
        sIn.addEventListener('input', () => {
            const term = sIn.value.toLowerCase(); cBtn.style.display = term ? 'block' : 'none';
            let regex = null, useRegex = term.includes('*');
            if (useRegex) { try { regex = new RegExp('^' + term.split('*').join('.*') + '$', 'i'); } catch(e) { useRegex = false; } }
            document.querySelectorAll('.tree-item').forEach(it => { 
                const n = it.dataset.name.toLowerCase(), p = (it.dataset.part || '').toLowerCase();
                const vis = useRegex ? (regex.test(n) || regex.test(p)) : (n.includes(term) || p.includes(term));
                it.style.display = vis ? 'flex' : 'none'; 
            });
            document.querySelectorAll('.board-wrapper').forEach(w => { if (Array.from(w.querySelectorAll('.board-children .tree-item')).some(it => it.style.display !== 'none') && term) { w.style.display = 'block'; w.querySelector('.tree-item').style.display = 'flex'; w.querySelector('.board-children').style.display = 'block'; } });
        });
        cBtn.addEventListener('click', () => { sIn.value = ''; sIn.dispatchEvent(new Event('input')); });
        document.getElementById('zoom-sel-btn').addEventListener('click', () => { if (selectedComponents.size === 0) return; const box = new THREE.Box3(); selectedComponents.forEach(id => { if (meshes[id]) box.expandByObject(meshes[id]); }); const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), dist = Math.max(size.x, size.y, size.z)*2||100; camera.position.set(center.x+dist, center.y+dist, center.z+dist); controls.target.copy(center); controls.update(); });

        document.getElementById('iso-btn').addEventListener('click', updateView);

        const fsBtn = document.getElementById('fullscreen-btn');
        if (fsBtn) {
            fsBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(err => {
                        console.log(`Error attempting to enable fullscreen: ${err.message}`);
                    });
                } else {
                    document.exitFullscreen();
                }
            });
            document.addEventListener('fullscreenchange', () => {
                if (document.fullscreenElement) {
                    fsBtn.innerHTML = '🗗 Fenstermodus';
                } else {
                    fsBtn.innerHTML = '⛶ Vollbild';
                }
            });
        }

        document.getElementById('export-btn').addEventListener('click', () => {
            if (!originalXmlDoc) return;
            const uids = Array.from(document.querySelectorAll('.tree-item')).filter(it => !it.querySelector('.delete-toggle').classList.contains('deleted')).map(it => it.dataset.uid);
            const copy = originalXmlDoc.cloneNode(true), instMap = {}; Array.from(copy.getElementsByTagNameNS("*", "ItemInstance")).forEach(i => instMap[i.getAttribute("id")] = i);
            uids.forEach(id => {
                const comp = allComponents.find(c => c.uid === id), inst = instMap[id];
                if (comp && inst) {
                    const trans = getNS(inst, "Transformation")[0]; if (trans) {
                        const setVal = (tag, val) => {
                            let node = getNS(trans, tag)[0]; if (!node) { node = copy.createElementNS(trans.namespaceURI, trans.prefix ? `${trans.prefix}:${tag}` : tag); trans.appendChild(node); }
                            let valNode = getNS(node, "Value")[0]; if (!valNode) { const eT = getNS(trans, "tx")[0]; if (eT && getNS(eT, "Value")[0]) { valNode = copy.createElementNS(getNS(eT, "Value")[0].namespaceURI, getNS(eT, "Value")[0].tagName); node.appendChild(valNode); } }
                            if (valNode) valNode.textContent = val.toFixed(3); else node.textContent = val.toFixed(3);
                        };
                        setVal("tx", comp.x); setVal("ty", comp.y); setVal("tz", comp.z + (window.boardZ || 0));
                    }
                }
            });
            allComponents.filter(c => c.isDeleted).forEach(c => { const inst = instMap[c.uid]; if (inst && inst.parentNode) inst.parentNode.removeChild(inst); });
            const manualUids = uids.filter(id => allComponents.find(c => c.uid === id)?.isManuallyAdded), firstAssemblyItem = Array.from(copy.getElementsByTagNameNS("*", "Item")).find(i => getNS(i, "ItemType")[0]?.textContent === "assembly");
            if (manualUids.length > 0 && firstAssemblyItem) {
                const pdmNs = "http://schema.prostep.org/edmd/pdm", fndNs = "http://schema.prostep.org/edmd/foundation", propNs = "http://schema.prostep.org/edmd/property";
                const pdmPfx = (copy.documentElement.lookupPrefix(pdmNs) || "pdm") + ":", fndPfx = (copy.documentElement.lookupPrefix(fndNs) || "foundation") + ":", propPfx = (copy.documentElement.lookupPrefix(propNs) || "property") + ":";
                manualUids.forEach((id, idx) => {
                    const comp = allComponents.find(c => c.uid === id); if (!comp) return;
                    const ptsLocal = [ {x: comp.maxX||2.5, y: comp.maxY||2.5}, {x: comp.minX||-2.5, y: comp.maxY||2.5}, {x: comp.minX||-2.5, y: comp.minY||-2.5}, {x: comp.maxX||2.5, y: comp.minY||-2.5} ];
                    const ptIds = ptsLocal.map((p, pIdx) => { const ptId = `${id}_PT_${pIdx}`, pt = copy.createElementNS(fndNs, `${fndPfx}CartesianPoint`); pt.setAttribute("id", ptId); const xx = copy.createElementNS(fndNs, `${fndPfx}X`), yy = copy.createElementNS(fndNs, `${fndPfx}Y`); xx.textContent = p.x.toFixed(3); yy.textContent = p.y.toFixed(3); pt.appendChild(xx); pt.appendChild(yy); firstAssemblyItem.parentNode.insertBefore(pt, firstAssemblyItem); return ptId; });
                    const plId = `${id}_PL`, pl = copy.createElementNS(pdmNs, `${pdmPfx}PolyLine`); pl.setAttribute("id", plId); ptIds.forEach(pid => { const pRef = copy.createElementNS(pdmNs, `${pdmPfx}Point`); pRef.textContent = pid; pl.appendChild(pRef); }); const pRefClose = copy.createElementNS(pdmNs, `${pdmPfx}Point`); pRefClose.textContent = ptIds[0]; pl.appendChild(pRefClose); firstAssemblyItem.parentNode.insertBefore(pl, firstAssemblyItem);
                    const csId = `${id}_CS`, cs = copy.createElementNS(pdmNs, `${pdmPfx}CurveSet2d`); cs.setAttribute("id", csId); const dge = copy.createElementNS(pdmNs, `${pdmPfx}DetailedGeometricModelElement`); dge.textContent = plId; cs.appendChild(dge);
                    const lb = copy.createElementNS(pdmNs, `${pdmPfx}LowerBound`), lbV = copy.createElementNS(propNs, `${propPfx}Value`); lbV.textContent = "0"; lb.appendChild(lbV); cs.appendChild(lb);
                    const ub = copy.createElementNS(pdmNs, `${pdmPfx}UpperBound`), ubV = copy.createElementNS(propNs, `${propPfx}Value`); ubV.textContent = (comp.maxZ !== undefined ? (comp.maxZ - comp.minZ) : (comp.thickness || 5.0)).toFixed(3); ub.appendChild(ubV); cs.appendChild(ub); firstAssemblyItem.parentNode.insertBefore(cs, firstAssemblyItem);
                    const seId = `${id}_SE`, se = copy.createElementNS(pdmNs, `${pdmPfx}ShapeElement`); se.setAttribute("id", seId); const ds = copy.createElementNS(pdmNs, `${pdmPfx}DefiningShape`); ds.textContent = csId; se.appendChild(ds); firstAssemblyItem.parentNode.insertBefore(se, firstAssemblyItem);
                    const shapeId = `${id}_SHAPE`, shapeDef = copy.createElementNS(pdmNs, `${pdmPfx}AssemblyComponent`); shapeDef.setAttribute("id", shapeId); const seRef = copy.createElementNS(pdmNs, `${pdmPfx}ShapeElement`); seRef.textContent = seId; shapeDef.appendChild(seRef); firstAssemblyItem.parentNode.insertBefore(shapeDef, firstAssemblyItem);
                    const itemNode = copy.createElementNS(fndNs, `${fndPfx}Item`); itemNode.setAttribute("id", `${id}_ITEM`); const typeNode = copy.createElementNS(pdmNs, `${pdmPfx}ItemType`); typeNode.textContent = "single"; itemNode.appendChild(typeNode);
                    const shapeNode = copy.createElementNS(pdmNs, `${pdmPfx}Shape`); shapeNode.textContent = shapeId; itemNode.appendChild(shapeNode);
                    const idNNode = copy.createElementNS(pdmNs, `${pdmPfx}Identifier`); idNNode.setAttribute("Persistant", "false"); const sysNode = copy.createElementNS(fndNs, `${fndPfx}SystemScope`); sysNode.textContent = "SYSTEM_1"; const numNode = copy.createElementNS(fndNs, `${fndPfx}Number`); numNode.textContent = comp.name; idNNode.appendChild(sysNode); idNNode.appendChild(numNode); itemNode.appendChild(idNNode);
                    firstAssemblyItem.parentNode.insertBefore(itemNode, firstAssemblyItem);
                    const instNode = copy.createElementNS(pdmNs, `${pdmPfx}ItemInstance`); instNode.setAttribute("id", id);
                    const nNG = copy.createElementNS(pdmNs, `${pdmPfx}InstanceName`); nNG.setAttribute("Persistant", "false"); const sN2 = copy.createElementNS(fndNs, `${fndPfx}SystemScope`); sN2.textContent = "SYSTEM_1"; const oNN = copy.createElementNS(fndNs, `${fndPfx}ObjectName`); oNN.textContent = comp.name + "_" + comp.uid; nNG.appendChild(sN2); nNG.appendChild(oNN); instNode.appendChild(nNG);
                    const refN = copy.createElementNS(pdmNs, `${pdmPfx}Item`); refN.textContent = `${id}_ITEM`; instNode.appendChild(refN);
                    const transN = copy.createElementNS(pdmNs, `${pdmPfx}Transformation`); const rad = (comp.rotDeg||0)*Math.PI/180, xx = Math.cos(rad).toFixed(4), xy = (-Math.sin(rad)).toFixed(4), yx = Math.sin(rad).toFixed(4), yy = Math.cos(rad).toFixed(4);
                    const sTV = (t, v) => { const n = copy.createElementNS(pdmNs, `${pdmPfx}${t}`), vn = copy.createElementNS(propNs, `${propPfx}Value`); vn.textContent = v; n.appendChild(vn); transN.appendChild(n); };
                    const sTR = (t, v) => { const n = copy.createElementNS(pdmNs, `${pdmPfx}${t}`); n.textContent = v; transN.appendChild(n); };
                    sTR("xx", xx); sTR("xy", xy); sTR("yx", yx); sTR("yy", yy); sTV("tx", comp.x.toFixed(3)); sTV("ty", comp.y.toFixed(3)); sTV("tz", (comp.z+(window.boardZ||0)).toFixed(3));
                    instNode.appendChild(transN); const sideN = copy.createElementNS(pdmNs, `${pdmPfx}AssembleToName`); sideN.textContent = comp.isBottom ? "BOTTOM" : "TOP"; instNode.appendChild(sideN); firstAssemblyItem.appendChild(instNode); instMap[id] = instNode;
                });
            }
            const parents = []; const itemToUids = new Map(); uids.forEach(id => { const inst = instMap[id]; if (inst) { const item = inst.closest('Item') || inst.parentElement; if (item && item.localName.toLowerCase() === "item") { if (!itemToUids.has(item)) { itemToUids.set(item, []); parents.push(item); } itemToUids.get(item).push(id); } } });
            if (parents.length > 0) { itemToUids.forEach((ids, item) => { if (ids.length > 1) { const insts = Array.from(item.childNodes).filter(n => n.nodeType === 1 && n.localName === "ItemInstance"); if (insts.length > 0) { const ph = copy.createTextNode(""); item.insertBefore(ph, insts[0]); const s = ids.map(id => instMap[id]).filter(i => i !== undefined); insts.forEach(i => item.removeChild(i)); s.forEach(i => item.insertBefore(i, ph)); item.removeChild(ph); } } });
            const ph = copy.createTextNode(""), gp = parents[0].parentElement; if (gp) { gp.insertBefore(ph, parents[0]); parents.forEach(i => { if (i.parentElement === gp) gp.removeChild(i); }); parents.forEach(i => gp.insertBefore(i, ph)); gp.removeChild(ph); } }
            // --- APPEND HISTORY TO BASELINE EXPORT ---
            if (incrementHistory && incrementHistory.length > 0) {
                const rootNode = copy.documentElement;
                rootNode.appendChild(copy.createComment(" === HISTORICAL AUDIT TRAIL (Consolidated Increments) === "));
                incrementHistory.forEach(inc => {
                    if (inc && inc.xml) {
                        const incDoc = new DOMParser().parseFromString(inc.xml, "application/xml");
                        const instructions = Array.from(incDoc.documentElement.childNodes).filter(n => n.nodeType === 1 && (n.localName === "ProcessInstruction" || (n.tagName && n.tagName.endsWith(":ProcessInstruction"))));
                        if (instructions.length > 0) {
                            rootNode.appendChild(copy.createComment(` Source: ${inc.name} | Date: ${inc.date || 'Unbekannt'} `));
                            instructions.forEach(inst => rootNode.appendChild(copy.importNode(inst, true)));
                        }
                    }
                });
            }
            const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'application/xml' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = originalFileName.replace(/.(idx|xml)$/i, '_filtered.$1'); a.click();
        });

        window.exportResponse = () => {
            document.getElementById('export-inc-btn').click();
        };

        document.getElementById('export-inc-btn').addEventListener('click', () => {
            if (!originalXmlDoc) return;
            const uids = Array.from(document.querySelectorAll('.tree-item')).filter(it => !it.querySelector('.delete-toggle').classList.contains('deleted')).map(it => it.dataset.uid);
            const modifiedComps = allComponents.filter(c => c.isModified && !c.isDeleted);
            const manualComps = allComponents.filter(c => c.isManuallyAdded && !c.isIncrementallyAdded).map(c => c.uid);
            const deletedComps = allComponents.filter(c => c.isDeleted && !c.isIncrementallyDeleted);
            const rejectedComps = allComponents.filter(c => c.acceptStatus === 'rejected');
            console.log("EXPORT INC CALLED. Rejected comps count:", rejectedComps.length, "manualStateResponses:", JSON.stringify(window.manualStateResponses));
            if (modifiedComps.length === 0 && manualComps.length === 0 && deletedComps.length === 0 && rejectedComps.length === 0) { alert("Keine neuen Änderungen!"); return; }
            const copy = originalXmlDoc.cloneNode(true), instMap = {}; Array.from(copy.getElementsByTagNameNS("*", "ItemInstance")).forEach(i => instMap[i.getAttribute("id")] = i);
            const firstAsm = Array.from(copy.getElementsByTagNameNS("*", "Item")).find(i => getNS(i, "ItemType")[0]?.textContent === "assembly"); if (!firstAsm) return;
            const keptInstUids = new Set([...modifiedComps.map(c => c.uid), ...manualComps]);
            const keptItemIds = new Set(); keptInstUids.forEach(uid => { const inst = instMap[uid]; if (inst) { let p = inst.parentNode; while (p && p.localName?.toLowerCase() === "item") { keptItemIds.add(p.getAttribute("id")); p = p.parentNode; } } });
            Array.from(copy.getElementsByTagNameNS("*", "ItemInstance")).forEach(inst => { if (!keptInstUids.has(inst.getAttribute("id"))) inst.parentNode?.removeChild(inst); });
            ["CartesianPoint", "PolyLine", "CircleCenter", "Arc", "CurveSet2d", "ShapeElement", "Stratum", "AssemblyComponent", "KeepIn", "KeepOut", "InterStratumFeature", "Conductor", "Coating", "Net", "Cutout", "Via", "Filled_via", "Plated_passage", "Component_termination_passage"].forEach(tag => Array.from(copy.getElementsByTagNameNS("*", tag)).forEach(n => n.parentNode?.removeChild(n)));
            const compNs = copy.documentElement.lookupNamespaceURI("computational"), fndNs = copy.documentElement.lookupNamespaceURI("foundation"), pdmNs = copy.documentElement.lookupNamespaceURI("pdm"), propNs = copy.documentElement.lookupNamespaceURI("property");
            const compPfx = (copy.documentElement.lookupPrefix(compNs)||"computational")+":", fndPfx = (copy.documentElement.lookupPrefix(fndNs)||"foundation")+":", pdmPfx = (copy.documentElement.lookupPrefix(pdmNs)||"pdm")+":", propPfx = (copy.documentElement.lookupPrefix(propNs)||"property")+":";
            const oldId = firstAsm.getAttribute("id"), newId = oldId + "_INC_" + Date.now(); firstAsm.setAttribute("id", newId);
            let piN = getNS(copy, "ProcessInstruction")[0]; if (!piN) { piN = copy.createElementNS(fndNs, `${fndPfx}ProcessInstruction`); copy.documentElement.insertBefore(piN, copy.documentElement.firstChild); }
            piN.setAttribute("xsi:type", `${compPfx}EDMDProcessInstructionSendChanges`); piN.innerHTML = '';
            const actN = copy.createElementNS(compNs, `${compPfx}Actor`); actN.textContent = "ACTOR_1"; piN.appendChild(actN);
            
            // Generate Changes block if there are any manual changes
            if (modifiedComps.length > 0 || deletedComps.length > 0 || manualComps.length > 0) {
                const chsN = copy.createElementNS(compNs, `${compPfx}Changes`), chN = copy.createElementNS(compNs, `${compPfx}EDMDChange`);
                chN.appendChild(copy.createElementNS(compNs, `${compPfx}NewItem`)).textContent = newId; chN.appendChild(copy.createElementNS(compNs, `${compPfx}PredecessorItem`)).textContent = oldId;
                modifiedComps.forEach(comp => { const inst = instMap[comp.uid]; if (inst) { const trans = getNS(inst, "Transformation")[0]; if (trans) { const sV = (tag, val) => { let n = getNS(trans, tag)[0]; if (!n) { n = copy.createElementNS(trans.namespaceURI, trans.prefix ? `${trans.prefix}:${tag}` : tag); trans.appendChild(n); } let vn = getNS(n, "Value")[0]; if (!vn) { const eT = getNS(trans, "tx")[0]; if (eT && getNS(eT, "Value")[0]) vn = copy.createElementNS(getNS(eT, "Value")[0].namespaceURI, getNS(eT, "Value")[0].tagName); n.appendChild(vn); } if (vn) vn.textContent = val.toFixed(3); else n.textContent = val.toFixed(3); }; sV("tx", comp.x); sV("ty", comp.y); sV("tz", comp.z + (window.boardZ || 0)); } } });
                deletedComps.forEach(c => { const inst = instMap[c.uid]; if (inst) { const iNN = getNS(inst, "InstanceName")[0]; if (iNN) { const dN = copy.createElementNS(compNs, `${compPfx}DeletedInstanceName`); Array.from(iNN.childNodes).forEach(ch => dN.appendChild(ch.cloneNode(true))); chN.appendChild(dN); } inst.parentNode?.removeChild(inst); } });
                chsN.appendChild(chN); piN.appendChild(chsN);
            }

            // Generate Responses block
            if (rejectedComps.length > 0) {
                const respsN = copy.createElementNS(compNs, `${compPfx}Responses`);
                rejectedComps.forEach(comp => {
                    const respN = copy.createElementNS(compNs, `${compPfx}EDMDResponse`);
                    const cIdN = copy.createElementNS(compNs, `${compPfx}ChangeId`); cIdN.textContent = comp.uid;
                    const stN = copy.createElementNS(compNs, `${compPfx}Status`); stN.textContent = "REJECTED";
                    respN.appendChild(cIdN); respN.appendChild(stN);
                    respsN.appendChild(respN);
                });
                piN.appendChild(respsN);
            }
            manualComps.forEach((id, idx) => {
                const comp = allComponents.find(c => c.uid === id); if (!comp) return;
                const ptsL = [ {x: comp.maxX||2.5, y: comp.maxY||2.5}, {x: comp.minX||-2.5, y: comp.maxY||2.5}, {x: comp.minX||-2.5, y: comp.minY||-2.5}, {x: comp.maxX||2.5, y: comp.minY||-2.5} ];
                const pIds = ptsL.map((p, pI) => { const ptId = `${id}_PT_${pI}`, pt = copy.createElementNS(fndNs, `${fndPfx}CartesianPoint`); pt.setAttribute("id", ptId); pt.appendChild(copy.createElementNS(fndNs, `${fndPfx}X`)).textContent = p.x.toFixed(3); pt.appendChild(copy.createElementNS(fndNs, `${fndPfx}Y`)).textContent = p.y.toFixed(3); firstAsm.parentNode.insertBefore(pt, firstAsm); return ptId; });
                const plId = `${id}_PL`, pl = copy.createElementNS(pdmNs, `${pdmPfx}PolyLine`); pl.setAttribute("id", plId); pIds.forEach(pid => pl.appendChild(copy.createElementNS(pdmNs, `${pdmPfx}Point`)).textContent = pid); pl.appendChild(copy.createElementNS(pdmNs, `${pdmPfx}Point`)).textContent = pIds[0]; firstAsm.parentNode.insertBefore(pl, firstAsm);
                const csId = `${id}_CS`, cs = copy.createElementNS(pdmNs, `${pdmPfx}CurveSet2d`); cs.setAttribute("id", csId); cs.appendChild(copy.createElementNS(pdmNs, `${pdmPfx}DetailedGeometricModelElement`)).textContent = plId;
                const lb = copy.createElementNS(pdmNs, `${pdmPfx}LowerBound`), ub = copy.createElementNS(pdmNs, `${pdmPfx}UpperBound`); lb.appendChild(copy.createElementNS(propNs, `${propPfx}Value`)).textContent = "0"; ub.appendChild(copy.createElementNS(propNs, `${propPfx}Value`)).textContent = (comp.maxZ-comp.minZ||5).toFixed(3); cs.appendChild(lb); cs.appendChild(ub); firstAsm.parentNode.insertBefore(cs, firstAsm);
                const seId = `${id}_SE`, se = copy.createElementNS(pdmNs, `${pdmPfx}ShapeElement`); se.setAttribute("id", seId); se.appendChild(copy.createElementNS(pdmNs, `${pdmPfx}DefiningShape`)).textContent = csId; firstAsm.parentNode.insertBefore(se, firstAsm);
                const shapeId = `${id}_SHAPE`, sD = copy.createElementNS(pdmNs, `${pdmPfx}AssemblyComponent`); sD.setAttribute("id", shapeId); sD.appendChild(copy.createElementNS(pdmNs, `${pdmPfx}ShapeElement`)).textContent = seId; firstAsm.parentNode.insertBefore(sD, firstAsm);
                const iN = copy.createElementNS(fndNs, `${fndPfx}Item`); iN.setAttribute("id", `${id}_ITEM`); iN.appendChild(copy.createElementNS(pdmNs, `${pdmPfx}ItemType`)).textContent = "single"; iN.appendChild(copy.createElementNS(pdmNs, `${pdmPfx}Shape`)).textContent = shapeId;
                const idNN = copy.createElementNS(pdmNs, `${pdmPfx}Identifier`); idNN.setAttribute("Persistant", "false"); idNN.appendChild(copy.createElementNS(fndNs, `${fndPfx}SystemScope`)).textContent = "SYSTEM_1"; idNN.appendChild(copy.createElementNS(fndNs, `${fndPfx}Number`)).textContent = comp.name; iN.appendChild(idNN); firstAsm.parentNode.insertBefore(iN, firstAsm);
                const iI = copy.createElementNS(pdmNs, `${pdmPfx}ItemInstance`); iI.setAttribute("id", id); const nG = copy.createElementNS(pdmNs, `${pdmPfx}InstanceName`); nG.setAttribute("Persistant", "false"); nG.appendChild(copy.createElementNS(fndNs, `${fndPfx}SystemScope`)).textContent = "SYSTEM_1"; nG.appendChild(copy.createElementNS(fndNs, `${fndPfx}ObjectName`)).textContent = `${comp.name}_M${idx}`; iI.appendChild(nG); iI.appendChild(copy.createElementNS(pdmNs, `${pdmPfx}Item`)).textContent = `${id}_ITEM`;
                const tN = copy.createElementNS(pdmNs, `${pdmPfx}Transformation`); const rad = (comp.rotDeg||0)*Math.PI/180, sTV = (t, v) => { const n = copy.createElementNS(pdmNs, `${pdmPfx}${t}`), vn = copy.createElementNS(propNs, `${propPfx}Value`); vn.textContent = v; n.appendChild(vn); tN.appendChild(n); }; const sTR = (t, v) => tN.appendChild(copy.createElementNS(pdmNs, `${pdmPfx}${t}`)).textContent = v;
                sTR("xx", Math.cos(rad).toFixed(4)); sTR("xy", (-Math.sin(rad)).toFixed(4)); sTR("yx", Math.sin(rad).toFixed(4)); sTR("yy", Math.cos(rad).toFixed(4)); sTV("tx", comp.x.toFixed(3)); sTV("ty", comp.y.toFixed(3)); sTV("tz", (comp.z+(window.boardZ||0)).toFixed(3)); iI.appendChild(tN);
                iI.appendChild(copy.createElementNS(pdmNs, `${pdmPfx}AssembleToName`)).textContent = comp.isBottom ? "BOTTOM" : "TOP"; firstAsm.appendChild(iI); instMap[id] = iI;
            });
            const parents = []; const iTU = new Map(); uids.forEach(id => { const inst = instMap[id]; if (inst?.parentNode) { const item = inst.closest('Item') || inst.parentElement; if (item?.localName === "item") { if (!iTU.has(item)) { iTU.set(item, []); parents.push(item); } iTU.get(item).push(id); } } });
            if (parents.length > 0) { iTU.forEach((ids, item) => { if (ids.length > 1) { const insts = Array.from(item.childNodes).filter(n => n.nodeType === 1 && n.localName === "ItemInstance"); if (insts.length > 0) { const ph = copy.createTextNode(""); item.insertBefore(ph, insts[0]); ids.map(id => instMap[id]).filter(i => i).forEach(i => { i.parentNode?.removeChild(i); item.insertBefore(i, ph); }); item.removeChild(ph); } } }); const ph = copy.createTextNode(""), gp = parents[0].parentElement; if (gp) { gp.insertBefore(ph, parents[0]); parents.forEach(i => { if (i.parentElement === gp) gp.removeChild(i); }); parents.forEach(i => gp.insertBefore(i, ph)); gp.removeChild(ph); } }
            const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'application/xml' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = originalFileName.replace(/.(idx|xml)$/i, '_increment.$1'); a.click();
        });

        document.getElementById('new-comp-file').addEventListener('change', e => { const file = e.target.files[0], nI = document.getElementById('new-comp-name'); if (file && (!nI.value || nI.value === "Manuell")) nI.value = file.name.replace(/.obj$/i, ''); });
        document.getElementById('add-manual-btn').addEventListener('click', async () => {
            const name = document.getElementById('new-comp-name').value || "Manuell", file = document.getElementById('new-comp-file').files[0], x = parseFloat(document.getElementById('new-comp-x').value || 0), y = parseFloat(document.getElementById('new-comp-y').value || 0), z = parseFloat(document.getElementById('new-comp-z').value || 0), isBottom = document.getElementById('new-comp-side').value === "bottom", sc = parseFloat(document.getElementById('new-comp-scale').value || 1), rot = parseFloat(document.getElementById('new-comp-rot').value || 0);
            if (!file) return alert("OBJ wählen!"); 
            manualCount++; const uid = `MANUAL_${Date.now()}_${manualCount}`, bT = window.lastBoardThickness || 1.6, m = new THREE.Mesh(new THREE.BoxGeometry(5,5,5), new THREE.MeshStandardMaterial({ color: 0x0fbcf9 }));
            const compMinX = -2.5, compMaxX = 2.5, compMinY = -2.5, compMaxY = 2.5, compMinZ = 0, compMaxZ = 5;
            m.position.set(x, y, isBottom ? z : bT + z); m.rotation.z = rot * Math.PI / 180; m.userData.uid = uid; m.userData.isVisible = true; simplifiedMeshes[uid] = m; meshes[uid] = m; currentGroup.add(m);
            const comp = { uid, name, partNumber: "Hand", x, y, z: (isBottom ? z : bT + z), thickness: 5, polygons: [], circles: [], isVisible: true, isDeleted: false, isBottom, origX: x, origY: y, origZ: (isBottom ? z : bT + z), minX: compMinX, maxX: compMaxX, minY: compMinY, maxY: compMaxY, minZ: compMinZ, maxZ: compMaxZ, isManuallyAdded: true }; allComponents.push(comp); 
            await replaceWithOBJ(uid, file, sc); addTreeItem(comp, m, document.getElementById('components-list')); updateView(); updateHistoryUI();
        });

        document.getElementById('apply-edit-btn').addEventListener('click', () => {
            if (selectedComponents.size !== 1) return; const id = Array.from(selectedComponents)[0], comp = allComponents.find(c => c.uid === id); if (!comp) return;
            const x = parseFloat(document.getElementById('edit-comp-x').value), y = parseFloat(document.getElementById('edit-comp-y').value), z = parseFloat(document.getElementById('edit-comp-z').value);
            if (simplifiedMeshes[id]) simplifiedMeshes[id].position.set(x, y, z); if (detailedMeshes[id]) detailedMeshes[id].position.set(x, y, z);
            const rZ = comp.isBoard ? 0 : z;
            comp.x = x; comp.y = y; comp.z = rZ; comp.isModified = (Math.abs(x - comp.origX) > 0.001 || Math.abs(y - comp.origY) > 0.001 || Math.abs(rZ - comp.origZ) > 0.001);
            if(window.saveManualState) window.saveManualState();
            currentHistoryStep = 999; applyHistoryStep(999).then(() => updateHistoryUI());
            const tr = document.querySelector(`.tree-item[data-uid="${CSS.escape(id)}"]`); if (tr) { tr.classList.toggle('is-modified', comp.isModified); const nS = tr.querySelector('.item-name'); if (nS) { nS.innerHTML = nS.innerHTML.replace(/\s*[✨✏️❌]/g, '') + (comp.isManuallyAdded ? ' ✨' : (comp.isModified ? ' ✏️' : '')); } }
        });

        document.getElementById('reset-edit-btn').addEventListener('click', () => { if (selectedComponents.size !== 1) return; const id = Array.from(selectedComponents)[0], comp = allComponents.find(c => c.uid === id); if (!comp) return; const bT = window.lastBoardThickness || 1.6; document.getElementById('edit-comp-x').value = comp.origX.toFixed(3); document.getElementById('edit-comp-y').value = comp.origY.toFixed(3); document.getElementById('edit-comp-z').value = (comp.isBoard ? 0 : (comp.isBottom ? comp.origZ : bT + comp.origZ)).toFixed(3); document.getElementById('apply-edit-btn').click(); });

        document.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.key.toLowerCase() === 'h' && selectedComponents.size > 0) { const id = Array.from(selectedComponents)[0], comp = allComponents.find(c => c.uid === id); if (comp) toggleVisualVisibility(id, comp.isVisible); } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedComponents.size > 0) { e.preventDefault(); const id = Array.from(selectedComponents)[0], comp = allComponents.find(c => c.uid === id); if (comp) toggleExportExclusion(id, !comp.isDeleted); } else if (e.key === 'Escape') handleSelection(null); });
        function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); } animate();
        window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });


        
        document.getElementById('macro-file-input')?.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                document.getElementById('macro-input').value = ev.target.result;
                e.target.value = ''; // Reset input
            };
            reader.readAsText(file);
        });

        document.getElementById('run-macro-btn')?.addEventListener('click', async () => { 
            const script = document.getElementById('macro-input').value;
            const lines = script.split(/\r?\n/);
            for (let line of lines) {
                line = line.trim();
                if (!line || line.startsWith('//') || line.startsWith('#')) continue;
                console.log("Macro executing:", line);
                const match = line.match(/^([a-zA-Z_]+)\s*\((.*)\)$/);
                if (match) {
                    const cmd = match[1].toLowerCase();
                    const args = match[2].split(',').map(a => a.trim().replace(/^['"]|['"]$/g, ''));
                    
                    switch(cmd) {
                        case 'filter':
                            document.getElementById('search-input').value = args[0] || '';
                            document.getElementById('search-input').dispatchEvent(new Event('input'));
                            break;
                        case 'select':
                            if (args[0] === 'filter' || args[0] === 'visible' || args[0] === 'all') {
                                selectedComponents.clear();
                                document.querySelectorAll('.tree-item').forEach(el => {
                                    if (el.style.display !== 'none' && !el.dataset.name.includes('Platine')) {
                                        selectedComponents.add(el.dataset.uid);
                                    }
                                });
                                updateSelectionVisuals();
                                const editHeader = document.getElementById('edit-component-section-header'), editSec = document.getElementById('edit-component-section');
                                if (selectedComponents.size === 1) { 
                                    const selId = Array.from(selectedComponents)[0], mesh = meshes[selId] || simplifiedMeshes[selId]; 
                                    if (mesh) { 
                                        document.getElementById('edit-comp-x').value = mesh.position.x.toFixed(3); document.getElementById('edit-comp-y').value = mesh.position.y.toFixed(3); document.getElementById('edit-comp-z').value = mesh.position.z.toFixed(3); 
                                        if (editHeader) { editHeader.style.display = 'flex'; editHeader.classList.remove('collapsed'); editSec.classList.remove('collapsed'); } 
                                    } 
                                } else if (editHeader) { editHeader.style.display = 'none'; editSec.classList.add('collapsed'); }
                            }
                            break;
                        case 'deselect':
                        case 'clear':
                            handleSelection(null);
                            break;
                        case 'moveup':
                        case 'movetop':
                            moveSelectedItems('top');
                            break;
                        case 'movedown':
                        case 'movebottom':
                            moveSelectedItems('bottom');
                            break;
                        case 'delete':
                        case 'exclude':
                            if (selectedComponents.size > 0) toggleExportExclusion(Array.from(selectedComponents)[0], true);
                            break;
                        case 'include':
                            if (selectedComponents.size > 0) toggleExportExclusion(Array.from(selectedComponents)[0], false);
                            break;
                        case 'hide':
                            if (selectedComponents.size > 0) toggleVisualVisibility(Array.from(selectedComponents)[0], true);
                            break;
                        case 'show':
                            if (selectedComponents.size > 0) toggleVisualVisibility(Array.from(selectedComponents)[0], false);
                            break;
                        case 'sleep':
                            await new Promise(r => setTimeout(r, parseInt(args[0]) || 1000));
                            break;
                        
                        // NEW GUI MACRO COMMANDS
                        case 'addcomp':
                            document.getElementById('new-comp-name').value = args[0] || 'Manuell';
                            document.getElementById('new-comp-x').value = args[1] || '0';
                            document.getElementById('new-comp-y').value = args[2] || '0';
                            document.getElementById('new-comp-z').value = args[3] || '0';
                            document.getElementById('new-comp-side').value = (args[4] && args[4].toLowerCase() === 'bottom') ? 'bottom' : 'top';
                            document.getElementById('new-comp-scale').value = args[5] || '1';
                            document.getElementById('new-comp-rot').value = args[6] || '0';
                            // Bypass OBJ file selection for macros, create placeholder box
                            manualCount++; const uid = `MANUAL_${Date.now()}_${manualCount}`, bT = window.lastBoardThickness || 1.6, m = new THREE.Mesh(new THREE.BoxGeometry(5,5,5), new THREE.MeshStandardMaterial({ color: 0x0fbcf9 }));
                            const compMinX = -2.5, compMaxX = 2.5, compMinY = -2.5, compMaxY = 2.5, compMinZ = 0, compMaxZ = 5;
                            const x = parseFloat(args[1] || 0), y = parseFloat(args[2] || 0), z = parseFloat(args[3] || 0), isBottom = document.getElementById('new-comp-side').value === "bottom", rot = parseFloat(args[6] || 0);
                            m.position.set(x, y, isBottom ? z : bT + z); m.rotation.z = rot * Math.PI / 180; m.userData.uid = uid; m.userData.isVisible = true; simplifiedMeshes[uid] = m; meshes[uid] = m; currentGroup.add(m);
                            const comp = { uid, name: args[0] || 'Manuell', partNumber: "Hand", x, y, z: (isBottom ? z : bT + z), thickness: 5, polygons: [], circles: [], isVisible: true, isDeleted: false, isBottom, origX: x, origY: y, origZ: (isBottom ? z : bT + z), minX: compMinX, maxX: compMaxX, minY: compMinY, maxY: compMaxY, minZ: compMinZ, maxZ: compMaxZ, isManuallyAdded: true }; allComponents.push(comp); 
                            addTreeItem(comp, m, document.getElementById('components-list')); updateView(); updateHistoryUI();
                            break;
                        case 'editcomp':
                            if (selectedComponents.size === 1) {
                                if(args[0]!==undefined && args[0]!=='') document.getElementById('edit-comp-x').value = args[0];
                                if(args[1]!==undefined && args[1]!=='') document.getElementById('edit-comp-y').value = args[1];
                                if(args[2]!==undefined && args[2]!=='') document.getElementById('edit-comp-z').value = args[2];
                                document.getElementById('apply-edit-btn').click();
                            }
                            break;
                        case 'resetcomp':
                            document.getElementById('reset-edit-btn').click();
                            break;
                        case 'loadbaseline':
                            document.getElementById('file-input').click();
                            break;
                        case 'loadincrement':
                            document.getElementById('inc-file-input').click();
                            break;
                        case 'loadhintmap':
                            document.getElementById('hintmap-input').click();
                            break;
                        case 'loadobj':
                            document.getElementById('obj-input').click();
                            break;
                        case 'exportbaseline':
                            document.getElementById('export-btn').click();
                            break;
                        case 'exportincrement':
                            document.getElementById('export-inc-btn').click();
                            break;
                        case 'zoom':
                            document.getElementById('zoom-sel-btn').click();
                            break;
                        case 'iso':
                            document.getElementById('iso-btn').click();
                            break;
                        case 'toggleobj':
                            if (args[0]!==undefined) {
                                document.getElementById('obj-toggle').checked = (args[0]==='true'||args[0]==='1');
                                document.getElementById('obj-toggle').dispatchEvent(new Event('change'));
                            }
                            break;
                        case 'togglemcad':
                            if (args[0]!==undefined) {
                                document.getElementById('mcad-toggle').checked = (args[0]==='true'||args[0]==='1');
                                document.getElementById('mcad-toggle').dispatchEvent(new Event('change'));
                            }
                            break;
                        case 'toggletype':
                            if (args[0]!==undefined && args[1]!==undefined) {
                                const typeName = args[0];
                                const isVisible = (args[1] === 'true' || args[1] === '1');
                                toggleTypeVisibility(typeName, isVisible);
                                // Also update the checkbox in the UI if it exists
                                const tF = document.getElementById('type-filters');
                                if (tF) {
                                    Array.from(tF.querySelectorAll('label')).forEach(lbl => {
                                        if (lbl.textContent.trim() === typeName) {
                                            const cb = lbl.querySelector('input[type="checkbox"]');
                                            if (cb) cb.checked = isVisible;
                                        }
                                    });
                                }
                            }
                            break;
                        case 'historynext':
                            document.getElementById('hist-next-btn').click();
                            break;
                        case 'historyprev':
                            document.getElementById('hist-prev-btn').click();
                            break;
                        case 'historystep':
                            if(args[0]!==undefined) {
                                let hidx = parseInt(args[0]);
                                if (!isNaN(hidx)) {
                                    currentHistoryStep = hidx; updateHistoryUI(); applyHistoryStep(hidx);
                                }
                            }
                            break;
                        case 'discard':
                            allComponents = JSON.parse(JSON.stringify(baselineComponents));
                            if (incrementHistory.length > 0) {
                                applyHistoryStep(incrementHistory.length - 1);
                            } else {
                                build3DScene(allComponents, window.lastBoardThickness || 1.6);
                            }
                            currentHistoryStep = incrementHistory.length - 1;
                            updateHistoryUI();
                            break;
                    }
                    await new Promise(r => setTimeout(r, 20)); // Yield to UI
                }
            }
        });
