(function () {
    let scene;
    let currentScript = document.currentScript;

    const MAX_PLAYERS = 10;
    const MAX_HAND_CARDS = 11; // Max is 11 (start with 10, draw 1)
    const TURN_DURATION = 180 * 1000;
    const DISCONNECT_TIMEOUT_MS = 45000;

    const TURN_STATE = {
        AWAITING_DRAW: 'AWAITING_DRAW',
        AWAITING_PLAY_OR_DISCARD: 'AWAITING_PLAY_OR_DISCARD',
        AWAITING_SKIP_TARGET: 'AWAITING_SKIP_TARGET'
    };

    const ROUNDS = [
        { id: 1, name: "Round 1: 2 sets of 3", reqs: [{type: 'set', count: 3}, {type: 'set', count: 3}] },
        { id: 2, name: "Round 2: 1 set of 3 + 1 run of 4", reqs: [{type: 'set', count: 3}, {type: 'run', count: 4}] },
        { id: 3, name: "Round 3: 1 set of 4 + 1 run of 4", reqs: [{type: 'set', count: 4}, {type: 'run', count: 4}] },
        { id: 4, name: "Round 4: 1 run of 7", reqs: [{type: 'run', count: 7}] },
        { id: 5, name: "Round 5: 1 run of 8", reqs: [{type: 'run', count: 8}] },
        { id: 6, name: "Round 6: 1 run of 9", reqs: [{type: 'run', count: 9}] },
        { id: 7, name: "Round 7: 2 sets of 4", reqs: [{type: 'set', count: 4}, {type: 'set', count: 4}] },
        { id: 8, name: "Round 8: 7 cards of 1 color", reqs: [{type: 'color', count: 7}] },
        { id: 9, name: "Round 9: 1 set of 5 + 1 set of 2", reqs: [{type: 'set', count: 5}, {type: 'set', count: 2}] },
        { id: 10, name: "Round 10: 1 set of 5 + 1 set of 3", reqs: [{type: 'set', count: 5}, {type: 'set', count: 3}] }
    ];

    const GAME_VARIATIONS = {
        STANDARD: 'STANDARD',
        ADVANCE_ALWAYS: 'ADVANCE_ALWAYS',
        EVENS_ONLY: 'EVENS_ONLY'
    };

    class Rummy10Game {
        constructor() {
            this.gameState = null;
            this.selectedCardIds = []; // Allow multi-select
            this.ui = {
                slices: [],
                centralPanel: null,
                confirmButtonsRow: null,
                hitTargetModal: null,
                skipTargetModal: null,
                tableViews: [] // For showing laid down rounds
            };
            this.isConfirmationDialogOpen = false;
            this.confirmCallback = null;
            this.isMuted = false;
            this.playersInitiallyLoaded = {};
            this.joinTime = Date.now();
            this.firstSyncDone = false;

            const urlParams = new URLSearchParams(window.location.search);
            const getParam = (attr, defaultValue) => {
                return urlParams.get(attr) ||
                       (currentScript && currentScript.getAttribute(attr)) ||
                       (currentScript && currentScript.dataset?.[attr]) ||
                       defaultValue;
            };

            this.params = {
                position: getParam("position", "0 0 0"),
                rotation: getParam("rotation", "0 0 0"),
                instance: getParam("instance", "demo-rummy10"),
                debug: getParam("debug", "false") === "true"
            };
            this.stateKey = this.params.instance;
        }

        wrapText(text, maxChars = 19) {
            if (!text) return "";
            const words = text.replace(/\n/g, ' ').split(/\s+/).filter(word => word.length > 0);
            const lines = [];
            let currentLine = "";

            for (const word of words) {
                const testLine = currentLine.length > 0 ? currentLine + " " + word : word;
                if (testLine.length > maxChars) {
                    if (currentLine.length > 0) {
                        lines.push(currentLine.trim());
                        currentLine = word;
                    } else {
                        lines.push(word);
                        currentLine = "";
                    }
                } else {
                    currentLine = testLine;
                }
            }

            if (currentLine.trim().length > 0) {
                lines.push(currentLine.trim());
            }

            return lines.join('\n');
        }

        parseVector3(str) {
            const parts = str.split(" ").map(parseFloat);
            return new BS.Vector3(parts[0] || 0, parts[1] || 0, parts[2] || 0);
        }

        log(...args) {
            if (this.params.debug) console.log("[Rummy10 Banter]", ...args);
        }

        playLocalSound(soundFile) {
            if (this.isMuted) return;
            const now = Date.now();
            this.audioTracker = this.audioTracker || {};
            if (this.audioTracker[soundFile] && now - this.audioTracker[soundFile] < 100) return;
            this.audioTracker[soundFile] = now;

            const soundMap = {
                "join": "https://rummy10.firer.at/Assets/playerJoin.ogg",
                "leave": "https://rummy10.firer.at/Assets/playerKick.ogg",
                "start": "https://rummy10.firer.at/Assets/gameStart.ogg",
                "play_card": "https://rummy10.firer.at/Assets/card_flick.ogg",
                "draw_card": "https://rummy10.firer.at/Assets/card_flick.ogg",
                "win": "https://rummy10.firer.at/Assets/fanfare with pop.ogg",
                "pass": "https://rummy10.firer.at/Assets/ding%20ding.ogg"
            };
            const url = soundMap[soundFile];
            if (!url) {
                this.log("Sound not found:", soundFile);
                return;
            }

            const audio = new Audio(url);
            audio.crossOrigin = "anonymous";
            audio.volume = 0.3;
            audio.play().catch(e => this.log("Audio play failed: " + e.message));
        }

        async init() {
            if (scene) return;
            scene = BS.BanterScene.GetInstance();

            if (!scene.unityLoaded) {
                await new Promise(resolve => {
                    scene.On("unity-loaded", resolve);
                    window.addEventListener("unity-loaded", resolve, { once: true });
                });
            }

            this.log("Initializing Rummy 10 Game...");
            await this.buildEnvironment();

            scene.On("space-state-changed", this.onSpaceStateChanged.bind(this));
            scene.On("user-left", this.onSpaceUserLeft.bind(this));
            this.sync();

            setInterval(() => this.tick(), 1000);
        }

        async buildEnvironment() {
            const rootPos = this.parseVector3(this.params.position);
            const rootRot = this.parseVector3(this.params.rotation);
            this.root = await new BS.GameObject({ name: "Rummy10_Root", localPosition: rootPos, localEulerAngles: rootRot }).Async();

            const tableObj = await new BS.GameObject({ name: "Rummy10_TableBase", parent: this.root, localPosition: new BS.Vector3(0, 1, 0), localEulerAngles: new BS.Vector3(90, 0, 0) }).Async();
            await tableObj.AddComponent(new BS.BanterCircle({ radius: 1.5, segments: 32, thetaStart: 0, thetaLength: Math.PI * 2 }));
            await tableObj.AddComponent(new BS.BanterMaterial({ shaderName: "Standard", color: new BS.Vector4(0.08, 0.12, 0.08, 1) })); // Slightly green felt color

            const deckObj = await new BS.GameObject({ name: "Rummy10_DrawPile", parent: this.root, localPosition: new BS.Vector3(-0.2, 1.05, 0) }).Async();
            await deckObj.AddComponent(new BS.BanterBox({ width: 0.3, height: 0.1, depth: 0.2 }));
            await deckObj.AddComponent(new BS.BanterMaterial({ shaderName: "Standard", color: new BS.Vector4(0.15, 0.15, 0.15, 1) }));

            const discardObj = await new BS.GameObject({ name: "Rummy10_DiscardPile", parent: this.root, localPosition: new BS.Vector3(0.2, 1.05, 0) }).Async();
            await discardObj.AddComponent(new BS.BanterBox({ width: 0.3, height: 0.1, depth: 0.2 }));
            await discardObj.AddComponent(new BS.BanterMaterial({ shaderName: "Standard", color: new BS.Vector4(0.15, 0.15, 0.15, 1) }));

            this.ui.slices = [];
            for (let i = 0; i < MAX_PLAYERS; i++) {
                this.ui.slices.push(await this.buildPlayerSlice(i));
            }

            await this.buildCentralUI();
            this.log("Environment built.");
        }

        async buildPlayerSlice(index) {
            const angleDeg = (360 / MAX_PLAYERS) * index;
            const sliceRoot = await new BS.GameObject({
                name: `Rummy10_PlayerSlice_${index}`,
                parent: this.root,
                localEulerAngles: new BS.Vector3(0, angleDeg, 0)
            }).Async();

            const wedgeObj = await new BS.GameObject({ name: "Rummy10_Placemat", parent: sliceRoot, localPosition: new BS.Vector3(0, 1.01, 0), localEulerAngles: new BS.Vector3(90, 0, 0) }).Async();
            const sliceAngleRad = Math.PI * 2 / MAX_PLAYERS;
            await wedgeObj.AddComponent(new BS.BanterCircle({
                radius: 1.6,
                segments: 8,
                thetaStart: (Math.PI / 2) - (sliceAngleRad * 0.95) / 2,
                thetaLength: sliceAngleRad * 0.95
            }));
            const matNormal = await wedgeObj.AddComponent(new BS.BanterMaterial(
                "Unlit/Color", null, new BS.Vector4(0.15, 0.15, 0.15, 1), 0, false, "Rummy10_Wedge_" + index
            ));

            // Status UI
            const statusObj = await new BS.GameObject({
                name: "Rummy10_StatusUI", parent: sliceRoot, localPosition: new BS.Vector3(0, 1.15, 1.55), localEulerAngles: new BS.Vector3(35, 180, 0), localScale: new BS.Vector3(0.10, 0.10, 0.10)
            }).Async();
            const sPanel = await statusObj.AddComponent(new BS.BanterUI(new BS.Vector2(850, 130), false));
            const sRoot = sPanel.CreateVisualElement(); await sRoot.Async();
            sRoot.SetStyles({
                backgroundColor: 'rgba(0, 0, 0, 0.8)', display: 'none', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%',
                paddingTop: '10px', paddingRight: '10px', paddingBottom: '10px', paddingLeft: '10px', borderRadius: '40px', borderWidth: '4px', borderColor: 'rgba(102, 102, 102, 1)'
            });
            const nameText = sPanel.CreateLabel(undefined, sRoot); await nameText.Async();
            nameText.text = "Empty Seat";
            nameText.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)', color: 'white', fontSize: '22px', fontWeight: 'bold', marginRight: '20px', whiteSpace: 'normal', textAlign: 'center' });
            const roundText = sPanel.CreateLabel(undefined, sRoot); await roundText.Async();
            roundText.text = "";
            roundText.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)', color: 'cyan', fontSize: '22px', marginRight: '30px' });
            const statusText = sPanel.CreateLabel(undefined, sRoot); await statusText.Async();
            statusText.text = "";
            statusText.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgba(255, 204, 0, 1)', fontSize: '25px', marginRight: '30px' });
            const timerText = sPanel.CreateLabel(undefined, sRoot); await timerText.Async();
            timerText.text = "";
            timerText.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgba(255, 51, 51, 1)', fontSize: '20px', fontWeight: 'bold' });

            // Hand UI
            const handObj = await new BS.GameObject({
                name: "Rummy10_HandUI", parent: sliceRoot, localPosition: new BS.Vector3(0, 1.35, 1.18), localEulerAngles: new BS.Vector3(60, 180, 0), localScale: new BS.Vector3(0.08, 0.08, 0.08)
            }).Async();
            const hPanel = await handObj.AddComponent(new BS.BanterUI(new BS.Vector2(1100, 900), false));
            const hRoot = hPanel.CreateVisualElement(); await hRoot.Async();
            hRoot.SetStyles({
                backgroundColor: 'rgba(25, 25, 25, 0.93)', display: 'none', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%',
                paddingTop: '20px', paddingRight: '20px', paddingBottom: '20px', paddingLeft: '20px', borderRadius: '25px', borderWidth: '3px', borderColor: 'rgba(102, 102, 102, 1)'
            });

            if (hRoot.parent && hRoot.parent.SetStyles) hRoot.parent.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)' });

            const actionsRow = hPanel.CreateVisualElement(hRoot); await actionsRow.Async();
            actionsRow.SetStyles({ display: 'flex', flexDirection: 'row', marginBottom: '20px', backgroundColor: 'rgba(0, 0, 0, 0)', flexWrap: 'wrap', justifyContent: 'center' });

            const selectionLabel = hPanel.CreateLabel(undefined, actionsRow); await selectionLabel.Async();
            selectionLabel.text = "";
            selectionLabel.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)', color: 'white', fontSize: '24px', fontWeight: 'bold', marginRight: '20px', paddingTop: '15px' });

            const createBtn = async (pnl, parent, text, color, handler) => {
                const btn = pnl.CreateButton(parent); await btn.Async();
                btn.text = text;
                btn.SetStyles({ backgroundColor: color, color: 'white', paddingTop: '15px', paddingBottom: '15px', paddingLeft: '20px', paddingRight: '20px', borderRadius: '12px', fontSize: '22px', borderWidth: '0px', marginTop: '5px', marginRight: '5px', marginBottom: '5px', marginLeft: '5px' });
                btn.OnClick(handler);
                return btn;
            };

            const drawDeckBtn = await createBtn(hPanel, actionsRow, "DRAW (DECK)", "#2196F3", () => {
                this.sendAction("draw-deck");
            });
            const drawDiscardBtn = await createBtn(hPanel, actionsRow, "DRAW (DISCARD)", "#9C27B0", () => {
                this.sendAction("draw-discard");
            });
            const layDownBtn = await createBtn(hPanel, actionsRow, "LAY DOWN ROUND", "#4CAF50", () => {
                if (this.selectedCardIds.length > 0) {
                    this.sendAction("lay-down-round", { cardIds: this.selectedCardIds });
                    this.selectedCardIds = [];
                }
            });
            const hitBtn = await createBtn(hPanel, actionsRow, "HIT", "#FF9800", () => {
                if (this.selectedCardIds.length === 1) {
                    this.openHitTargetModal();
                } else if (this.selectedCardIds.length > 1) {
                    this.log("Can only hit with one card at a time for now");
                }
            });
            const discardBtn = await createBtn(hPanel, actionsRow, "DISCARD", "#F44336", () => {
                if (this.selectedCardIds.length === 1) {
                    const localPlayer = this.gameState.players[scene.localUser.uid];
                    const cardToPlay = localPlayer.hand.find(c => c.id === this.selectedCardIds[0]);
                    
                    if (cardToPlay && cardToPlay.type === "skip") {
                        this.openSkipTargetModal();
                    } else {
                        this.sendAction("discard", { cardId: this.selectedCardIds[0] });
                        this.selectedCardIds = [];
                    }
                }
            });
            const hintBtn = await createBtn(hPanel, actionsRow, "HINT", "#00BCD4", () => {
                this.handleHintClick();
            });
            const turnIndicatorBtn = await createBtn(hPanel, actionsRow, "WAITING...", "#444444", () => {});

            const cardsScroll = hPanel.CreateScrollView(hRoot); await cardsScroll.Async();
            cardsScroll.SetStyles({ width: '100%', height: '700px', backgroundColor: 'rgba(0, 0, 0, 0)', marginBottom: '10px', overflow: 'scroll' });

            const cardsGrid = hPanel.CreateVisualElement(cardsScroll); await cardsGrid.Async();
            cardsGrid.SetStyles({ display: 'flex', flexWrap: 'wrap', flexDirection: 'row', justifyContent: 'center', width: '100%', backgroundColor: 'rgba(0, 0, 0, 0)' });

            const cardUIs = [];
            for (let i = 0; i < MAX_HAND_CARDS; i++) {
                const cardContainer = hPanel.CreateVisualElement(cardsGrid); await cardContainer.Async();
                cardContainer.SetStyles({
                    display: 'none', width: '180px', height: '210px', backgroundColor: 'rgba(51, 51, 51, 1)', paddingTop: '10px', paddingRight: '10px', paddingBottom: '10px', paddingLeft: '10px',
                    borderRadius: '12px', borderWidth: '4px', borderColor: 'rgba(170, 170, 170, 1)', flexDirection: 'column',
                    alignItems: 'flex-start', marginTop: '5px', marginRight: '10px', marginBottom: '10px', marginLeft: '5px'
                });
                const cardLabel = hPanel.CreateLabel("", cardContainer); await cardLabel.Async();
                cardLabel.SetStyles({ backgroundColor: 'rgba(0,0,0,0)', width: '100%', height: '100%', color: '#000000', fontSize: '30px', fontWeight: 'bold', textAlign: 'center' });
                cardContainer.OnClick(() => this.onCardClick(i));
                cardUIs.push({ container: cardContainer, label: cardLabel });
            }

            // Hit Modal
            const hitModal = hPanel.CreateVisualElement(hRoot); await hitModal.Async();
            hitModal.SetStyles({
                display: 'none', position: 'absolute', top: '10%', left: '10%', width: '80%', height: '80%',
                backgroundColor: 'rgba(0, 0, 0, 0.9)', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: '20px', paddingRight: '20px', paddingBottom: '20px', paddingLeft: '20px', borderRadius: '25px'
            });
            const hitMsg = hPanel.CreateLabel("Select Round to Hit", hitModal); await hitMsg.Async();
            hitMsg.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)', color: 'white', fontSize: '36px', marginBottom: '20px', fontWeight: 'bold' });
            
            const hitScroll = hPanel.CreateScrollView(hitModal); await hitScroll.Async();
            hitScroll.SetStyles({ width: '100%', height: '600px', backgroundColor: 'rgba(0,0,0,0)', marginBottom: '20px' });
            const hitOptionsGrid = hPanel.CreateVisualElement(hitScroll); await hitOptionsGrid.Async();
            hitOptionsGrid.SetStyles({ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'center' });
            
            const hitCancelBtn = await createBtn(hPanel, hitModal, "CANCEL", "#F44336", () => {
                hitModal.SetStyles({ display: 'none' });
            });

            // Skip Modal
            const skipModal = hPanel.CreateVisualElement(hRoot); await skipModal.Async();
            skipModal.SetStyles({
                display: 'none', position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.9)', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: '20px', paddingRight: '20px', paddingBottom: '20px', paddingLeft: '20px', borderRadius: '25px'
            });
            const skipMsg = hPanel.CreateLabel("Select Player to Skip", skipModal); await skipMsg.Async();
            skipMsg.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)', color: 'white', fontSize: '36px', marginBottom: '20px', fontWeight: 'bold' });
            
            const skipOptionsGrid = hPanel.CreateVisualElement(skipModal); await skipOptionsGrid.Async();
            skipOptionsGrid.SetStyles({ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'center', marginBottom: '20px' });

            const skipCancelBtn = await createBtn(hPanel, skipModal, "CANCEL", "#F44336", () => {
                skipModal.SetStyles({ display: 'none' });
            });

            return {
                root: sliceRoot, wedgeMat: matNormal,
                statusObj, sRoot, nameText, roundText, statusText, timerText,
                handObj, hRoot, actionsRow, selectionLabel, cardsGrid, cardUIs,
                drawDeckBtn, drawDiscardBtn, layDownBtn, hitBtn, discardBtn, hintBtn, turnIndicatorBtn,
                hPanel, hitModal, hitOptionsGrid, skipModal, skipOptionsGrid
            };
        }

        async buildCentralUI() {
            const centralObj = await new BS.GameObject({ name: "Rummy10_CentralUI", parent: this.root, localPosition: new BS.Vector3(0, 2.0, 0), localScale: new BS.Vector3(0.15, 0.15, 0.15) }).Async();
            let centralBillboardObj = await centralObj.AddComponent(new BS.BanterBillboard({ smoothing: 1, enableXAxis: false, enableYAxis: true }));
            centralBillboardObj.enableXAxis = false;

            const panel = await centralObj.AddComponent(new BS.BanterUI(new BS.Vector2(1000, 1100), false));
            const rootEl = panel.CreateVisualElement(); await rootEl.Async();
            rootEl.SetStyles({
                backgroundColor: 'rgba(10, 10, 10, 0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
                paddingTop: '20px', paddingRight: '20px', paddingBottom: '20px', paddingLeft: '20px', borderRadius: '25px', borderWidth: '4px', borderColor: 'rgba(74, 78, 105, 1)', width: '100%', height: '100%',
                position: 'absolute', top: '0', left: '0'
            });

            if (rootEl.parent && rootEl.parent.SetStyles) rootEl.parent.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)' });
            this.ui.centralPanel = { obj: centralObj, panel, rootEl };

            const title = panel.CreateLabel(undefined, rootEl); await title.Async();
            title.text = "RUMMY 10";
            title.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)', color: 'white', fontSize: '48px', fontWeight: 'bold', marginBottom: '10px' });
            this.ui.titleLabel = title;

            const statusLabel = panel.CreateLabel(undefined, rootEl); await statusLabel.Async();
            statusLabel.text = "";
            statusLabel.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)', color: '#ffcc00', fontSize: '24px', marginBottom: '10px', display: 'none' });
            this.ui.statusLabel = statusLabel;

            const buttonsRow = panel.CreateVisualElement(rootEl); await buttonsRow.Async();
            buttonsRow.SetStyles({ display: 'flex', flexDirection: 'row', marginBottom: '15px', backgroundColor: 'rgba(0, 0, 0, 0)', flexWrap: 'wrap', justifyContent: 'center' });

            const createBtn = async (parent, text, color, handler) => {
                const btn = panel.CreateButton(parent); await btn.Async();
                if (btn.parent && btn.parent.SetStyles) btn.parent.SetStyles({ backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none' });
                btn.text = text;
                btn.SetStyles({ backgroundColor: color, color: 'white', paddingTop: '15px', paddingBottom: '15px', paddingLeft: '30px', paddingRight: '30px', borderRadius: '8px', fontSize: '24px', borderWidth: '0px', backgroundImage: 'none', marginTop: '8px', marginRight: '8px', marginBottom: '8px', marginLeft: '8px' });
                btn.OnClick(handler);
                return btn;
            };

            this.ui.joinBtn = await createBtn(buttonsRow, "JOIN GAME", "#2196F3", () => this.sendAction("join-game"));
            this.ui.dealBtn = await createBtn(buttonsRow, "START GAME", "#4CAF50", () => this.sendAction("start-game"));
            this.ui.leaveBtn = await createBtn(buttonsRow, "LEAVE GAME", "#F44336", () => this.sendAction("leave-game"));
            this.ui.muteBtn = await createBtn(buttonsRow, "🔊", "#607D8B", () => {
                this.isMuted = !this.isMuted;
                this.ui.muteBtn.text = this.isMuted ? "🔇" : "🔊";
            });
            this.ui.claimHostBtn = await createBtn(buttonsRow, "CLAIM HOST", "#e69900", () => {
                if (!this.isHost()) this.updateState({ currentHostUid: scene.localUser.uid });
            });
            this.ui.variationBtn = await createBtn(buttonsRow, "MODE: STANDARD", "#607D8B", () => {
                if (this.isHost() && (!this.gameState || !this.gameState.gameStarted)) {
                    let modes = Object.values(GAME_VARIATIONS);
                    let currentIdx = modes.indexOf(this.gameState?.gameVariation || GAME_VARIATIONS.STANDARD);
                    let nextMode = modes[(currentIdx + 1) % modes.length];
                    this.updateState({ gameVariation: nextMode });
                }
            });
            this.ui.howToPlayBtn = await createBtn(buttonsRow, "HOW TO PLAY", "#9C27B0", () => this.openHowToPlayUI());

            const topCardContainer = panel.CreateVisualElement(rootEl); await topCardContainer.Async();
            topCardContainer.SetStyles({
                display: 'none', width: '220px', height: '260px', backgroundColor: 'rgba(0, 0, 0, 0.9)',
                paddingTop: '15px', paddingRight: '15px', paddingBottom: '15px', paddingLeft: '15px', borderRadius: '15px', borderWidth: '10px', borderColor: 'rgba(0, 0, 0, 1)',
                marginBottom: '15px', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
            });
            const topCardLabel = panel.CreateLabel(undefined, topCardContainer); await topCardLabel.Async();
            topCardLabel.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0)', width: '100%', height: '100%', color: 'black', fontSize: '42px', fontWeight: 'bold', textAlign: 'center' });
            this.ui.currentCard = { container: topCardContainer, label: topCardLabel };

            const tableScroll = panel.CreateScrollView(rootEl); await tableScroll.Async();
            tableScroll.SetStyles({ width: '100%', height: '400px', backgroundColor: 'rgba(20,20,20,0.8)', borderRadius: '15px', paddingTop: '15px', paddingRight: '15px', paddingBottom: '15px', paddingLeft: '15px', overflow: 'scroll', marginBottom: '10px' });
            
            const tableGrid = panel.CreateVisualElement(tableScroll); await tableGrid.Async();
            tableGrid.SetStyles({ display: 'flex', flexDirection: 'column', width: '100%', backgroundColor: 'rgba(0,0,0,0)' });
            this.ui.tableGrid = tableGrid;

            const tableLabel = panel.CreateLabel("", tableGrid); await tableLabel.Async();
            tableLabel.SetStyles({ color: 'white', fontSize: '24px', whiteSpace: 'normal', backgroundColor: 'rgba(0,0,0,0)' });
            this.ui.tableLabel = tableLabel;

            const winnerLabel = panel.CreateLabel(undefined, rootEl); await winnerLabel.Async();
            winnerLabel.text = "";
            winnerLabel.SetStyles({ display: 'none', backgroundColor: 'rgba(0, 0, 0, 0)', color: '#ffcc00', fontSize: '40px', fontWeight: 'bold', paddingTop: '10px', paddingBottom: '10px', paddingLeft: '30px', paddingRight: '30px', borderRadius: '50px' });
            this.ui.winnerLabel = winnerLabel;

            await this.buildHowToPlayUI(panel, rootEl, createBtn);
        }

        async buildHowToPlayUI(panel, rootEl, createBtn) {
            this.ui.howToPlayOverlay = panel.CreateVisualElement(rootEl);
            await this.ui.howToPlayOverlay.Async();
            this.ui.howToPlayOverlay.SetStyles({
                display: 'none', position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                backgroundColor: 'rgba(10, 10, 10, 0.98)', flexDirection: 'column', alignItems: 'center',
                paddingTop: '40px', zIndex: '90'
            });

            const title = panel.CreateLabel(undefined, this.ui.howToPlayOverlay);
            await title.Async();
            title.text = "HOW TO PLAY";
            title.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0.3)', color: 'white', fontSize: '42px', marginBottom: '20px', fontWeight: 'bold' });

            const scrollArea = panel.CreateScrollView(this.ui.howToPlayOverlay);
            await scrollArea.Async();
            scrollArea.SetStyles({
                width: '900px', height: '800px', backgroundColor: 'rgba(0,0,0,0.97)',
                overflow: 'scroll', marginBottom: '20px',
                paddingTop: '20px', paddingRight: '20px', paddingBottom: '20px', paddingLeft: '20px', borderRadius: '15px'
            });
            
            if (scrollArea.parent && scrollArea.parent.SetStyles) {
                scrollArea.parent.SetStyles({ backgroundColor: 'rgba(0, 0, 0, 0.98)', backgroundImage: 'none' });
            }

            const rulesText = panel.CreateLabel(undefined, scrollArea);
            await rulesText.Async();
            rulesText.text = `<color=#ffcc00><b>OBJECTIVE & WINNING</b></color>
Be the first to complete all 10 Rounds! If multiple players complete Round 10 in the same round, the player with the lowest total score wins. 

<color=#ffcc00><b>ON YOUR TURN</b></color>
<b>1. DRAW:</b> Pick up 1 card from the deck or the discard pile.
<b>2. LAY DOWN:</b> If you have the exact cards for your current Round, lay them down on the table.
<b>3. HIT:</b> If you have already laid down your Round, you may "hit" by playing extra valid cards onto any player's laid down Round.
<b>4. DISCARD:</b> You must discard exactly 1 card to end your turn.

<color=#ffcc00><b>DEFINITIONS</b></color>
• <b>Sets:</b> Two or more cards with the same number. 
<i>Example: Three "7s" and three "10s". 
Cards can be any combination of colors.</i>
• <b>Runs:</b> Four or more cards numbered in order. 
<i>Example: "3", "4", "5", "6". 
Cards can be any combination of colors.</i>
• <b>All One Color:</b> Cards of the exact same color. 
<i>Example: Seven green cards. 
They do not need to be in numerical order.</i>

<color=#ffcc00><b>THE 10 ROUNDS</b></color>
<i>(A <b>Set</b> is 2+ cards of the same number. A <b>Run</b> is 4+ cards in numerical order.)</i>
  1. 2 Sets of 3
  2. 1 Set of 3 + 1 Run of 4
  3. 1 Set of 4 + 1 Run of 4
  4. 1 Run of 7
  5. 1 Run of 8
  6. 1 Run of 9
  7. 2 Sets of 4
  8. 7 Cards of 1 Color
  9. 1 Set of 5 + 1 Set of 2
  10. 1 Set of 5 + 1 Set of 3

<color=#ffcc00><b>HITTING & GOING OUT</b></color>
After laying down your Round, try to "go out" (empty your hand) as fast as possible by <b>Hitting</b>! 
Hitting is adding valid cards to any laid down Round (e.g. adding a '4' to a set of 4s). 

The first person to go out ends the round. 
Everyone who successfully laid down a Round advances to the next Round! If you failed to lay down, you must try that Round again.

<color=#ffcc00><b>SPECIAL CARDS</b></color>
<b>WILD CARDS:</b> Can represent any number or color to help complete a Round or hit.
<b>SKIP CARDS:</b> Discard this to skip a target player's next turn. You cannot use Skips in a Round.

<color=#ffcc00><b>SCORING</b></color>
When someone goes out, everyone else counts the points left in their hand. (Lower is better!)
  • <b>Cards 1-9:</b> 5 points
  • <b>Cards 10-12:</b> 10 points
  • <b>Skip Cards:</b> 15 points
  • <b>Wild Cards:</b> 25 points`;
            rulesText.SetStyles({ 
                color: 'white', fontSize: '28px', whiteSpace: 'normal', 
                backgroundColor: 'rgba(0,0,0,0)', width: '99%',
                textAlign: 'center'
            });

            const btnsRow = panel.CreateVisualElement(this.ui.howToPlayOverlay);
            await btnsRow.Async();
            btnsRow.SetStyles({ display: 'flex', flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0)' });

            await createBtn(btnsRow, "CLOSE", "#F44336", () => {
                this.closeHowToPlayUI();
            });
        }

        openHowToPlayUI() {
            if(this.ui.howToPlayOverlay) this.ui.howToPlayOverlay.SetStyles({ display: 'flex' });
        }

        closeHowToPlayUI() {
            if(this.ui.howToPlayOverlay) this.ui.howToPlayOverlay.SetStyles({ display: 'none' });
        }

        // Helper to get card text for Round 10
        getCardText(card) {
            if (!card) return "";
            if (card.type === "wild") return "WILD";
            if (card.type === "skip") return "SKIP";
            return `${card.color.toUpperCase()}\n${card.value}`;
        }

        getCardColor(card) {
            if (!card) return 'rgba(153, 153, 153, 1)';
            if (card.type === "wild") return 'rgba(167, 167, 167, 1)';
            if (card.type === "skip") return 'rgba(167, 167, 167, 1)';
            switch (card.color) {
                case 'red': return 'rgba(255, 0, 0, 1)';
                case 'blue': return 'rgba(0, 119, 255, 1)';
                case 'green': return 'rgba(0, 255, 0, 1)';
                case 'yellow': return 'rgba(255, 255, 0, 1)';
                default: return 'rgba(223, 223, 223, 1)';
            }
        }

        isHost() {
            if (!scene || !scene.localUser) return false;
            if (!this.gameState || !this.gameState.currentHostUid) {
                const uids = Object.keys(scene.users || {}).sort();
                return uids.length > 0 && uids[0] === scene.localUser.uid;
            }
            return this.gameState.currentHostUid === scene.localUser.uid;
        }

        onSpaceStateChanged(e) {
            if (e.detail.changes.some(c => c.property === this.stateKey)) {
                this.sync();
            }
        }

        onSpaceUserLeft(e) {
            const userId = e.detail.uid;
            if (this.gameState && this.gameState.players[userId]) {
                const player = this.gameState.players[userId];
                player.isDisconnected = true;
                player.disconnectTime = Date.now();
                this.updateState({ players: this.gameState.players });
            }
        }

        sync() {
            if (!scene || !scene.spaceState) return;
            const newGameStateRaw = scene.spaceState.public[this.stateKey];
            let newGameState;
            try {
                newGameState = newGameStateRaw ? JSON.parse(newGameStateRaw) : null;
            } catch (error) {
                this.log("Error parsing game state:", error);
                return;
            }

            if (!newGameState) {
                if (!this.gameState) {
                    this.gameState = this.getDefaultState();
                } else {
                    this.gameState = this.getDefaultState();
                }
                this.playersInitiallyLoaded = {};
                this.firstSyncDone = false;
            } else {
                const oldSound = this.gameState ? this.gameState.lastSound : null;
                if (newGameState.lastSound && (!oldSound || newGameState.lastSound.ts !== oldSound.ts)) {
                    if (newGameState.lastSound.ts > this.joinTime) {
                        this.playLocalSound(newGameState.lastSound.file);
                    }
                }

                if (JSON.stringify(this.gameState) !== JSON.stringify(newGameState)) {
                    this.gameState = newGameState;
                    if (!this.firstSyncDone) {
                        this.playersInitiallyLoaded = {};
                        for (const playerId in this.gameState.players) {
                            this.playersInitiallyLoaded[playerId] = this.gameState.players[playerId].isDisconnected;
                        }
                        this.firstSyncDone = true;
                    }
                }
            }
            this.updateUI();
        }

        getDefaultState() {
            return {
                players: {},
                deck: [],
                discardPile: [],
                currentPlayerId: null,
                gameStarted: false,
                winner: null,
                lastAction: null,
                currentHostUid: null,
                turnStartTime: null,
                turnDuration: TURN_DURATION,
                lastSound: null,
                gameVariation: GAME_VARIATIONS.STANDARD,
                turnState: TURN_STATE.AWAITING_DRAW,
                skipTargetSelected: null
            };
        }

        async updateState(patch) {
            if (!this.gameState) return;
            Object.assign(this.gameState, patch);
            if (this.gameState._triggerSound) {
                this.gameState.lastSound = { file: this.gameState._triggerSound, ts: Date.now() };
                delete this.gameState._triggerSound;
            }
            scene.SetPublicSpaceProps({ [this.stateKey]: JSON.stringify(this.gameState) });
            this.sync();
        }

        async sendAction(action, data = {}, senderUid = null) {
            const localUser = scene.localUser;
            if (!localUser || !scene.spaceState) return;

            let currentSpaceStateRaw = scene.spaceState.public[this.stateKey];
            let currentSpaceState;
            try {
                currentSpaceState = currentSpaceStateRaw ? JSON.parse(currentSpaceStateRaw) : this.getDefaultState();
            } catch (error) {
                currentSpaceState = this.getDefaultState();
            }

            let newState = JSON.parse(JSON.stringify(currentSpaceState));
            const updated = this.applyGameLogic(newState, action, senderUid || localUser.uid, localUser.name, data);

            if (updated) {
                if (updated._triggerSound) {
                    updated.lastSound = { file: updated._triggerSound, ts: Date.now() };
                    delete updated._triggerSound;
                }
                await scene.SetPublicSpaceProps({ [this.stateKey]: JSON.stringify(updated) });
                this.sync();
            }
        }

        applyGameLogic(state, action, userId, userName, data) {
            if (!state.players || state.currentHostUid === undefined) {
                state = this.getDefaultState();
            }
            const player = state.players[userId];

            switch (action) {
                case "join-game":
                    if (!player && !state.gameStarted) {
                        let availablePos = 0;
                        const usedPositions = Object.values(state.players).map(p => p.position);
                        while (usedPositions.includes(availablePos)) availablePos++;

                        if (availablePos < MAX_PLAYERS) {
                            state.players[userId] = {
                                id: userId, name: userName, hand: [], score: 0, position: availablePos,
                                currentRound: 1, completedRoundThisHand: false, laidDownCards: [], skipped: false
                            };
                            this.triggerSound(state, "join");
                        }
                    }
                    break;
                case "leave-game":
                    if (player) {
                        if (state.gameStarted && state.currentPlayerId === userId) {
                            this.nextTurn(state);
                        }
                        
                        delete state.players[userId];
                        
                        if (data.playSound !== false) this.triggerSound(state, "leave");
                        
                        const playerIds = Object.keys(state.players);
                        if (state.gameStarted) {
                            if (playerIds.length < 2) {
                                state.gameStarted = false;
                                state.winner = playerIds.length === 1 ? playerIds[0] : null;
                                if (state.winner) this.triggerSound(state, "win");
                            }
                        }
                    }
                    break;
                case "start-game":
                    if (this.isHost() && (!state.gameStarted || state.winner) && Object.keys(state.players).length >= 2) {
                        state = this.initializeNewGame(state);
                        this.triggerSound(state, "start");
                    }
                    break;
                case "draw-deck":
                    if (player && state.currentPlayerId === userId && state.turnState === TURN_STATE.AWAITING_DRAW) {
                        this.drawCardsForPlayer(state, userId, 1);
                        state.turnState = TURN_STATE.AWAITING_PLAY_OR_DISCARD;
                        state.turnStartTime = Date.now();
                        this.triggerSound(state, "draw_card");
                    }
                    break;
                case "draw-discard":
                    if (player && state.currentPlayerId === userId && state.turnState === TURN_STATE.AWAITING_DRAW) {
                        const topDiscard = state.discardPile[state.discardPile.length - 1];
                        if (topDiscard && topDiscard.type !== "skip") {
                            player.hand.push(state.discardPile.pop());
                            state.turnState = TURN_STATE.AWAITING_PLAY_OR_DISCARD;
                            state.turnStartTime = Date.now();
                            this.triggerSound(state, "draw_card");
                        }
                    }
                    break;
                case "lay-down-round":
                    if (player && state.currentPlayerId === userId && state.turnState === TURN_STATE.AWAITING_PLAY_OR_DISCARD && !player.completedRoundThisHand) {
                        const selectedCards = player.hand.filter(c => data.cardIds.includes(c.id));
                        const validGroups = this.findValidRoundCombination(selectedCards, player.currentRound);
                        const cardsUsed = validGroups ? validGroups.flat().length : 0;
                        if (validGroups && cardsUsed === selectedCards.length) {
                            player.hand = player.hand.filter(c => !data.cardIds.includes(c.id));
                            player.completedRoundThisHand = true;
                            player.laidDownCards = validGroups;
                            this.triggerSound(state, "play_card");
                            this.checkHandEmpty(state, player);
                        } else {
                            this.log("Invalid round lay down");
                        }
                    }
                    break;
                case "hit":
                    if (player && state.currentPlayerId === userId && state.turnState === TURN_STATE.AWAITING_PLAY_OR_DISCARD && player.completedRoundThisHand) {
                        const cardToHit = player.hand.find(c => c.id === data.cardId);
                        const targetPlayer = state.players[data.targetPlayerId];
                        if (cardToHit && targetPlayer && targetPlayer.completedRoundThisHand) {
                            // Find which group in targetPlayer.laidDownCards it can hit
                            // Simplified for now: just attempt to hit. Needs real validation.
                            if (this.validateHit(cardToHit, targetPlayer.laidDownCards, data.targetGroupIndex, targetPlayer.currentRound)) {
                                player.hand = player.hand.filter(c => c.id !== data.cardId);
                                targetPlayer.laidDownCards[data.targetGroupIndex].push(cardToHit);
                                this.triggerSound(state, "play_card");
                                this.checkHandEmpty(state, player);
                            }
                        }
                    }
                    break;
                case "discard":
                    if (player && state.currentPlayerId === userId && state.turnState === TURN_STATE.AWAITING_PLAY_OR_DISCARD) {
                        const cardToDiscard = player.hand.find(c => c.id === data.cardId);
                        if (cardToDiscard) {
                            player.hand = player.hand.filter(c => c.id !== data.cardId);
                            state.discardPile.push(cardToDiscard);
                            this.triggerSound(state, "play_card");
                            
                            if (cardToDiscard.type === "skip" && data.targetId) {
                                const targetPlayer = state.players[data.targetId];
                                if (targetPlayer) targetPlayer.skipped = true;
                            }
                            
                            if (!this.checkHandEmpty(state, player)) {
                                this.nextTurn(state);
                            }
                        }
                    }
                    break;
                case "timeout-player":
                    if (state.players[data.timedOutPlayerId]) {
                        this.log(`Player ${data.timedOutPlayerId} removed due to timeout/disconnect.`);
                        
                        const timedOutPlayer = state.players[data.timedOutPlayerId];
                        
                        // Put their hand back into the discard pile so cards aren't lost
                        if (timedOutPlayer.hand && timedOutPlayer.hand.length > 0) {
                            state.discardPile.push(...timedOutPlayer.hand);
                            timedOutPlayer.hand = [];
                        }

                        if (state.gameStarted && state.currentPlayerId === data.timedOutPlayerId) {
                            this.nextTurn(state);
                        }

                        // Remove from players list
                        delete state.players[data.timedOutPlayerId];

                        if (data.playSound) {
                            this.triggerSound(state, "leave");
                        }

                        const playerIds = Object.keys(state.players);
                        if (state.gameStarted) {
                            if (playerIds.length < 2) {
                                state.gameStarted = false;
                                state.winner = playerIds.length === 1 ? playerIds[0] : null;
                                if (state.winner) this.triggerSound(state, "win");
                            }
                        }
                    }
                    break;
            }

            state.lastAction = { action, userId, timestamp: Date.now() };
            return state;
        }

        checkHandEmpty(state, player) {
            if (player.hand.length === 0) {
                this.handleEndOfHand(state);
                return true;
            }
            return false;
        }

        handleEndOfHand(state) {
            // Score remaining cards
            for (const id in state.players) {
                const p = state.players[id];
                let roundScore = 0;
                p.hand.forEach(c => {
                    if (c.type === "number") {
                        if (parseInt(c.value) >= 1 && parseInt(c.value) <= 9) roundScore += 5;
                        else if (parseInt(c.value) >= 10 && parseInt(c.value) <= 12) roundScore += 10;
                    } else if (c.type === "skip") roundScore += 15;
                    else if (c.type === "wild") roundScore += 25;
                });
                p.score += roundScore;
                
                // Progress
                if (state.gameVariation === GAME_VARIATIONS.ADVANCE_ALWAYS) {
                    p.currentRound++;
                } else if (state.gameVariation === GAME_VARIATIONS.EVENS_ONLY) {
                     if (p.completedRoundThisHand) p.currentRound += 2;
                } else {
                    if (p.completedRoundThisHand) p.currentRound++;
                }
            }

            // Check for game winner
            let winnerId = null;
            let lowestScore = Infinity;
            for (const id in state.players) {
                if (state.players[id].currentRound > 10) {
                    if (state.players[id].score < lowestScore) {
                        lowestScore = state.players[id].score;
                        winnerId = id;
                    }
                }
            }

            if (winnerId) {
                state.winner = winnerId;
                state.gameStarted = false;
                this.triggerSound(state, "win");
            } else {
                // Next hand
                this.initializeNewHand(state);
            }
        }

        initializeNewGame(state) {
            state.gameStarted = true;
            state.winner = null;
            state.turnStartTime = null;
            state.turnDuration = TURN_DURATION;

            const playerIds = Object.keys(state.players);
            playerIds.forEach(id => {
                state.players[id].score = 0;
                state.players[id].currentRound = (state.gameVariation === GAME_VARIATIONS.EVENS_ONLY) ? 2 : 1;
            });

            this.initializeNewHand(state);
            state.currentPlayerId = playerIds[0]; 
            return state;
        }

        initializeNewHand(state) {
            state.deck = this.createRummy10Deck();
            this.shuffleDeck(state.deck);
            state.discardPile = [];
            state.turnState = TURN_STATE.AWAITING_DRAW;

            const playerIds = Object.keys(state.players);
            playerIds.forEach(id => {
                state.players[id].hand = [];
                state.players[id].completedRoundThisHand = false;
                state.players[id].laidDownCards = [];
                state.players[id].skipped = false;
                this.drawCardsForPlayer(state, id, 10);
            });

            // Start discard pile
            let firstCard = state.deck.shift();
            // If dealer starts with skip, first player is skipped
            if (firstCard.type === "skip") {
                state.players[playerIds[0]].skipped = true;
            }
            state.discardPile.push(firstCard);
            state.turnStartTime = Date.now();
        }

        createRummy10Deck() {
            const colors = ["red", "green", "blue", "yellow"];
            let deck = [];
            let cardIdCounter = 0;

            colors.forEach(color => {
                for (let i = 0; i < 2; i++) {
                    for (let val = 1; val <= 12; val++) {
                        deck.push({ id: cardIdCounter++, color, value: val.toString(), type: "number" });
                    }
                }
            });

            for (let i = 0; i < 4; i++) deck.push({ id: cardIdCounter++, color: "black", value: "skip", type: "skip" });
            for (let i = 0; i < 8; i++) deck.push({ id: cardIdCounter++, color: "black", value: "wild", type: "wild" });
            
            return deck;
        }

        shuffleDeck(deck) {
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
        }

        drawCardsForPlayer(state, playerId, count) {
            const player = state.players[playerId];
            if (!player) return;
            for (let i = 0; i < count; i++) {
                if (state.deck.length === 0) {
                    const currentTopCard = state.discardPile.pop();
                    state.deck = state.discardPile.filter(c => c.type !== "skip"); // Skips shouldn't be reshuffled into deck
                    this.shuffleDeck(state.deck);
                    state.discardPile = [currentTopCard];
                    if (state.deck.length === 0) break;
                }
                player.hand.push(state.deck.shift());
            }
        }

        nextTurn(state) {
            // Sort by seating position so turns follow the physical circle
            const playerIds = Object.values(state.players)
                .sort((a, b) => a.position - b.position)
                .map(p => p.id);
                
            if (playerIds.length === 0) return;

            let currentIndex = playerIds.indexOf(state.currentPlayerId);
            let loops = 0;
            do {
                currentIndex = (currentIndex + 1) % playerIds.length;
                loops++;
                if (loops > playerIds.length) break; // Safety
                
                if (state.players[playerIds[currentIndex]].skipped) {
                    // Clear the skipped flag so they get their NEXT turn, but skip them this time.
                    state.players[playerIds[currentIndex]].skipped = false;
                    continue;
                } else {
                    break;
                }
            } while (true);
            
            state.currentPlayerId = playerIds[currentIndex];
            state.turnState = TURN_STATE.AWAITING_DRAW;
            state.turnStartTime = Date.now();
        }

        // --- VALIDATION LOGIC ---

        validateHit(card, targetGroups, groupIndex, targetRound) {
             if (card.type === "skip") return false;
             if (card.type === "wild") return true;

             const roundReqs = ROUNDS.find(p => p.id === targetRound)?.reqs;
             if (!roundReqs || groupIndex >= roundReqs.length) return false;
             
             const req = roundReqs[groupIndex];
             const group = targetGroups[groupIndex];
             
             if (req.type === 'set') {
                 const nat = group.find(c => c.type !== 'wild');
                 if (!nat) return true;
                 return card.value === nat.value;
             } else if (req.type === 'run') {
                 const testGroup = [...group, card];
                 if (testGroup.length > 12) return false;
                 
                 const naturals = testGroup.filter(c => c.type !== 'wild');
                 if (naturals.length === 0) return true;
                 
                 const minNat = Math.min(...naturals.map(c => parseInt(c.value)));
                 const maxNat = Math.max(...naturals.map(c => parseInt(c.value)));
                 
                 if (maxNat - minNat >= testGroup.length) return false;
                 
                 const uniqueNats = new Set(naturals.map(c => c.value));
                 if (uniqueNats.size !== naturals.length) return false;
                 
                 return true;
             } else if (req.type === 'color') {
                 const nat = group.find(c => c.type !== 'wild');
                 if (!nat) return true;
                 return card.color === nat.color;
             }
             
             return false;
        }

        handleHintClick() {
            const localPlayer = this.gameState.players[scene.localUser.uid];
            if (!localPlayer) return;
            
            const validCombination = this.findValidRoundCombination(localPlayer.hand, localPlayer.currentRound);
            if (validCombination) {
                this.selectedCardIds = validCombination.flat().map(c => c.id);
                this.updateUI();
            } else {
                const slice = this.ui.slices[localPlayer.position];
                if (slice && slice.selectionLabel) {
                    slice.selectionLabel.text = "No round found. Discard a card.";
                    slice.selectionLabel.SetStyles({ color: '#F44336' });
                    // Revert text after 3 seconds
                    setTimeout(() => {
                        this.updateUI(); 
                    }, 3000);
                }
            }
        }

        findValidRoundCombination(hand, roundId) {
            const roundReqs = ROUNDS.find(p => p.id === roundId)?.reqs;
            if (!roundReqs) return null;

            let availableCards = [...hand];
            
            const solve = (cards, reqIndex, currentSelection) => {
                if (reqIndex >= roundReqs.length) return currentSelection;

                const req = roundReqs[reqIndex];
                let wilds = cards.filter(c => c.type === 'wild');
                let naturals = cards.filter(c => c.type !== 'wild' && c.type !== 'skip');

                if (req.type === 'set') {
                    const valueCounts = {};
                    naturals.forEach(c => {
                        if (!valueCounts[c.value]) valueCounts[c.value] = [];
                        valueCounts[c.value].push(c);
                    });

                    for (const val in valueCounts) {
                        const nats = valueCounts[val];
                        if (nats.length + wilds.length >= req.count) {
                            let neededNats = Math.min(nats.length, req.count);
                            let neededWilds = req.count - neededNats;
                            
                            let branchCards = [...cards];
                            let branchSelection = [...currentSelection];
                            let groupCards = [];
                            
                            for (let i = 0; i < neededNats; i++) {
                                const idx = branchCards.findIndex(c => c.id === nats[i].id);
                                groupCards.push(branchCards[idx]);
                                branchCards.splice(idx, 1);
                            }
                            let wildCount = 0;
                            for (let i = branchCards.length - 1; i >= 0 && wildCount < neededWilds; i--) {
                                if (branchCards[i].type === 'wild') {
                                    groupCards.push(branchCards[i]);
                                    branchCards.splice(i, 1);
                                    wildCount++;
                                }
                            }
                            
                            branchSelection.push(groupCards);
                            const res = solve(branchCards, reqIndex + 1, branchSelection);
                            if (res) return res;
                        }
                    }
                } else if (req.type === 'run') {
                    for (let startVal = 1; startVal <= 12 - req.count + 1; startVal++) {
                        let branchCards = [...cards];
                        let branchSelection = [...currentSelection];
                        let runValid = true;
                        let groupCards = [];

                        for (let val = startVal; val < startVal + req.count; val++) {
                            const natIdx = branchCards.findIndex(c => c.type !== 'wild' && c.type !== 'skip' && parseInt(c.value) === val);
                            if (natIdx > -1) {
                                groupCards.push(branchCards[natIdx]);
                                branchCards.splice(natIdx, 1);
                            } else {
                                const wildIdx = branchCards.findIndex(c => c.type === 'wild');
                                if (wildIdx > -1) {
                                    groupCards.push(branchCards[wildIdx]);
                                    branchCards.splice(wildIdx, 1);
                                } else {
                                    runValid = false;
                                    break;
                                }
                            }
                        }

                        if (runValid) {
                            branchSelection.push(groupCards);
                            const res = solve(branchCards, reqIndex + 1, branchSelection);
                            if (res) return res;
                        }
                    }
                } else if (req.type === 'color') {
                    const colorCounts = {};
                    naturals.forEach(c => {
                        if (!colorCounts[c.color]) colorCounts[c.color] = [];
                        colorCounts[c.color].push(c);
                    });

                    for (const col in colorCounts) {
                        const nats = colorCounts[col];
                        if (nats.length + wilds.length >= req.count) {
                            let neededNats = Math.min(nats.length, req.count);
                            let neededWilds = req.count - neededNats;
                            
                            let branchCards = [...cards];
                            let branchSelection = [...currentSelection];
                            let groupCards = [];
                            
                            for (let i = 0; i < neededNats; i++) {
                                const idx = branchCards.findIndex(c => c.id === nats[i].id);
                                groupCards.push(branchCards[idx]);
                                branchCards.splice(idx, 1);
                            }
                            let wildCount = 0;
                            for (let i = branchCards.length - 1; i >= 0 && wildCount < neededWilds; i--) {
                                if (branchCards[i].type === 'wild') {
                                    groupCards.push(branchCards[i]);
                                    branchCards.splice(i, 1);
                                    wildCount++;
                                }
                            }
                            
                            branchSelection.push(groupCards);
                            const res = solve(branchCards, reqIndex + 1, branchSelection);
                            if (res) return res;
                        }
                    }
                }
                
                return null;
            };

            return solve(availableCards, 0, []);
        }

        triggerSound(state, name) { state._triggerSound = name; }

        onCardClick(index) {
            if (!this.gameState || this.isConfirmationDialogOpen) return;
            const localPlayer = this.gameState.players[scene.localUser.uid];
            if (!localPlayer || !localPlayer.hand) return;
            const card = localPlayer.hand[index];
            if (!card) return;

            const idx = this.selectedCardIds.indexOf(card.id);
            if (idx > -1) this.selectedCardIds.splice(idx, 1);
            else this.selectedCardIds.push(card.id);
            
            this.updateUI();
        }

        // ... Modal openers
        openSkipTargetModal() {
            const localPlayer = this.gameState.players[scene.localUser.uid];
            if (!localPlayer) return;
            const slice = this.ui.slices[localPlayer.position];
            
            if (slice.skipButtons) {
                slice.skipButtons.forEach(b => { if (b.Destroy) b.Destroy(); });
            }
            slice.skipButtons = [];
            
            for (const id in this.gameState.players) {
                if (id === localPlayer.id) continue;
                const p = this.gameState.players[id];
                if (!p.skipped) {
                    const btn = slice.hPanel.CreateButton(slice.skipOptionsGrid);
                    btn.Async().then(() => {
                        btn.text = `SKIP ${p.name.toUpperCase()}`;
                        btn.SetStyles({
                            backgroundColor: '#F44336', color: 'white', paddingTop: '15px', paddingBottom: '15px', paddingLeft: '30px', paddingRight: '30px', 
                            borderRadius: '12px', fontSize: '24px', marginTop: '10px', marginRight: '10px', marginBottom: '10px', marginLeft: '10px', borderWidth: '0px'
                        });
                        btn.OnClick(() => {
                            this.sendAction("discard", { cardId: this.selectedCardIds[0], targetId: id });
                            this.selectedCardIds = [];
                            slice.skipModal.SetStyles({ display: 'none' });
                        });
                    });
                    slice.skipButtons.push(btn);
                }
            }
            
            slice.skipModal.SetStyles({ display: 'flex' });
        }

        openHitTargetModal() {
            const localPlayer = this.gameState.players[scene.localUser.uid];
            if (!localPlayer) return;
            const slice = this.ui.slices[localPlayer.position];
            
            if (slice.hitButtons) {
                slice.hitButtons.forEach(b => { if (b.Destroy) b.Destroy(); });
            }
            slice.hitButtons = [];
            
            for (const id in this.gameState.players) {
                const p = this.gameState.players[id];
                if (p.completedRoundThisHand && p.laidDownCards.length > 0) {
                    p.laidDownCards.forEach((group, index) => {
                        const btn = slice.hPanel.CreateButton(slice.hitOptionsGrid);
                        btn.Async().then(() => {
                            btn.text = `HIT ${p.name.toUpperCase()}'S GROUP ${index+1}`;
                            btn.SetStyles({
                                backgroundColor: '#FF9800', color: 'white', paddingTop: '15px', paddingBottom: '15px', paddingLeft: '30px', paddingRight: '30px', 
                                borderRadius: '12px', fontSize: '24px', marginTop: '10px', marginRight: '10px', marginBottom: '10px', marginLeft: '10px', borderWidth: '0px'
                            });
                            btn.OnClick(() => {
                                this.sendAction("hit", { cardId: this.selectedCardIds[0], targetPlayerId: id, targetGroupIndex: index });
                                this.selectedCardIds = [];
                                slice.hitModal.SetStyles({ display: 'none' });
                            });
                        });
                        slice.hitButtons.push(btn);
                    });
                }
            }
            
            slice.hitModal.SetStyles({ display: 'flex' });
        }

        updateUI() {
            if (!this.gameState || !this.gameState.players || !scene.localUser) return;
            const players = this.gameState.players;
            const localUid = scene.localUser.uid;
            const isPlaying = !!players[localUid];
            const localPlayer = players[localUid];
            const isMyTurn = this.gameState.currentPlayerId === localUid;
            const userIsHost = this.isHost();

            this.ui.joinBtn.SetStyles({ display: isPlaying ? 'none' : 'flex' });
            this.ui.leaveBtn.SetStyles({ display: isPlaying ? 'flex' : 'none' });
            this.ui.claimHostBtn.SetStyles({ display: userIsHost ? 'none' : 'flex' });
            
            const numPlayers = Object.keys(players).length;
            if (!this.gameState.gameStarted) {
                this.ui.variationBtn.SetStyles({ display: userIsHost ? 'flex' : 'none' });
                this.ui.variationBtn.text = `MODE: ${this.gameState.gameVariation}`;
                if (numPlayers < 2) {
                    this.ui.statusLabel.text = `Waiting for players... (${numPlayers}/2 joined)`;
                    this.ui.statusLabel.SetStyles({ display: 'flex' });
                    this.ui.dealBtn.SetStyles({ display: 'none' });
                } else {
                    this.ui.statusLabel.SetStyles({ display: 'none' });
                    this.ui.dealBtn.SetStyles({ display: userIsHost ? 'flex' : 'none' });
                }
            } else {
                this.ui.statusLabel.SetStyles({ display: 'none' });
                this.ui.dealBtn.SetStyles({ display: 'none' });
                this.ui.variationBtn.SetStyles({ display: 'none' });
            }

            if (this.gameState.gameStarted && this.gameState.discardPile.length > 0) {
                const topCard = this.gameState.discardPile[this.gameState.discardPile.length - 1];
                this.ui.currentCard.label.text = this.getCardText(topCard);
                this.ui.currentCard.container.SetStyles({ display: 'flex', backgroundColor: this.getCardColor(topCard) });
            } else {
                this.ui.currentCard.container.SetStyles({ display: 'none' });
            }

            if (this.gameState.winner) {
                const winnerPlayer = players[this.gameState.winner];
                this.ui.winnerLabel.text = `WINNER: ${winnerPlayer?.name || "???"}`;
                this.ui.winnerLabel.SetStyles({ display: 'flex' });
            } else {
                this.ui.winnerLabel.SetStyles({ display: 'none' });
            }

            // Update Table View
            if (this.ui.tableLabel) {
                let tableText = "";
                let hasLaidDown = false;
                for (const id in players) {
                    const p = players[id];
                    if (p.completedRoundThisHand && p.laidDownCards && p.laidDownCards.length > 0) {
                        hasLaidDown = true;
                        tableText += `[${p.name.toUpperCase()}] - Round ${p.currentRound}\n`;
                        p.laidDownCards.forEach((group, idx) => {
                            const cardsStr = group.map(c => c.type === 'wild' ? 'WILD' : (c.type === 'skip' ? 'SKIP' : c.value + c.color[0].toUpperCase())).join(' ');
                            tableText += `  Group ${idx + 1}: ${cardsStr}\n`;
                        });
                        tableText += "\n";
                    }
                }
                if (!hasLaidDown) {
                    tableText = "No rounds laid down yet.";
                }
                this.ui.tableLabel.text = tableText;
            }

            // Slices and Hand updates
            for (let i = 0; i < MAX_PLAYERS; i++) {
                const slice = this.ui.slices[i];
                if (!slice) continue;
                const playerAtPos = Object.values(players).find(p => p.position === i);

                if (!playerAtPos) {
                    slice.nameText.text = "Empty Seat";
                    slice.roundText.text = "";
                    slice.statusText.text = "";
                    slice.sRoot.SetStyles({ display: 'none' });
                    slice.hRoot.SetStyles({ display: 'none' });
                    if (slice.wedgeMat) slice.wedgeMat.color = new BS.Vector4(0.15, 0.15, 0.15, 1);
                    continue;
                }

                slice.sRoot.SetStyles({ display: 'flex', backgroundColor: 'rgba(20, 20, 20, 0.93)' });
                slice.nameText.text = `${playerAtPos.name}\nScore: ${playerAtPos.score || 0} | ${(playerAtPos.hand || []).length} cards`;
                
                const roundObj = ROUNDS.find(p => p.id === playerAtPos.currentRound);
                slice.roundText.text = roundObj ? roundObj.name : `Round ${playerAtPos.currentRound}`;
                
                const isLocalUser = playerAtPos.id === localUid;
                const isCurrentPlayer = this.gameState.currentPlayerId === playerAtPos.id;

                if (isCurrentPlayer) slice.wedgeMat.color = new BS.Vector4(0.2, 0.6, 1.0, 1);
                else if (isLocalUser) slice.wedgeMat.color = new BS.Vector4(0.4, 1.0, 0.4, 1);
                else slice.wedgeMat.color = new BS.Vector4(0.3, 0.3, 0.3, 1);

                if (isLocalUser) {
                    slice.hRoot.SetStyles({ display: 'flex' });
                    if (this.gameState.gameStarted && !this.gameState.winner) {
                        slice.statusText.text = isMyTurn ? "YOUR TURN" : "WAITING";
                        if (this.selectedCardIds.length > 0) {
                            slice.selectionLabel.text = `${this.selectedCardIds.length} Selected`;
                            slice.selectionLabel.SetStyles({ color: 'white' });
                        } else if (slice.selectionLabel.text !== "No round found. Discard a card.") {
                            slice.selectionLabel.text = "";
                            slice.selectionLabel.SetStyles({ color: 'white' });
                        }

                        slice.cardUIs.forEach(cardUI => cardUI.container.SetStyles({ display: 'none' }));
                        localPlayer.hand.forEach((card, idx) => {
                            const cardUI = slice.cardUIs[idx];
                            if (cardUI && card) {
                                const isSelected = this.selectedCardIds.includes(card.id);
                                cardUI.label.text = this.getCardText(card);
                                cardUI.container.SetStyles({
                                    display: 'flex',
                                    borderColor: isSelected ? '#4CAF50' : this.getCardColor(card),
                                    borderWidth: isSelected ? '6px' : '3px',
                                    backgroundColor: this.getCardColor(card)
                                });
                            }
                        });

                        const canDraw = isMyTurn && this.gameState.turnState === TURN_STATE.AWAITING_DRAW;
                        const topDiscard = this.gameState.discardPile[this.gameState.discardPile.length - 1];
                        const canDrawDiscard = canDraw && topDiscard && topDiscard.type !== "skip";
                        const canPlay = isMyTurn && this.gameState.turnState === TURN_STATE.AWAITING_PLAY_OR_DISCARD;
                        
                        slice.drawDeckBtn.SetStyles({ display: canDraw ? 'flex' : 'none' });
                        slice.drawDiscardBtn.SetStyles({ display: canDrawDiscard ? 'flex' : 'none' });
                        
                        slice.layDownBtn.SetStyles({ display: canPlay && !localPlayer.completedRoundThisHand && this.selectedCardIds.length > 0 ? 'flex' : 'none' });
                        slice.hintBtn.SetStyles({ display: canPlay && !localPlayer.completedRoundThisHand ? 'flex' : 'none' });
                        slice.hitBtn.SetStyles({ display: canPlay && localPlayer.completedRoundThisHand && this.selectedCardIds.length === 1 ? 'flex' : 'none' });
                        slice.discardBtn.SetStyles({ display: canPlay && this.selectedCardIds.length === 1 ? 'flex' : 'none' });
                        
                        const currentPlayer = players[this.gameState.currentPlayerId];
                        slice.turnIndicatorBtn.text = currentPlayer ? `${currentPlayer.name.toUpperCase()}'S TURN` : "WAITING...";
                        slice.turnIndicatorBtn.SetStyles({ display: isMyTurn ? 'none' : 'flex' });
                    } else {
                        slice.statusText.text = "";
                        slice.drawDeckBtn.SetStyles({ display: 'none' });
                        slice.drawDiscardBtn.SetStyles({ display: 'none' });
                        slice.layDownBtn.SetStyles({ display: 'none' });
                        slice.hintBtn.SetStyles({ display: 'none' });
                        slice.hitBtn.SetStyles({ display: 'none' });
                        slice.discardBtn.SetStyles({ display: 'none' });
                        slice.turnIndicatorBtn.SetStyles({ display: 'none' });
                        slice.selectionLabel.text = "";
                        slice.cardUIs.forEach(cardUI => cardUI.container.SetStyles({ display: 'none' }));
                    }
                } else {
                    slice.hRoot.SetStyles({ display: 'none' });
                    let status = isCurrentPlayer ? "PLAYING" : "WAITING";
                    if (playerAtPos.isDisconnected) status = "DISCONNECTED";
                    if (playerAtPos.skipped) status = "SKIPPED";
                    slice.statusText.text = status;
                }
            }
        }

        updateTimerDisplay() {
            if (!this.gameState || !this.gameState.players || !scene.localUser) return;
            const players = this.gameState.players;

            for (let i = 0; i < MAX_PLAYERS; i++) {
                const slice = this.ui.slices[i];
                if (!slice) continue;
                const playerAtPos = Object.values(players).find(p => p.position === i);

                if (playerAtPos && this.gameState.gameStarted && this.gameState.currentPlayerId === playerAtPos.id && this.gameState.turnStartTime) {
                    const timeLeft = Math.max(0, Math.ceil((this.gameState.turnStartTime + this.gameState.turnDuration - Date.now()) / 1000));
                    slice.timerText.text = `(${timeLeft}s)`;
                } else if (playerAtPos && playerAtPos.isDisconnected && playerAtPos.disconnectTime) {
                    const timeLeft = Math.max(0, Math.ceil((playerAtPos.disconnectTime + DISCONNECT_TIMEOUT_MS - Date.now()) / 1000));
                    slice.timerText.text = `(Disc: ${timeLeft}s)`;
                } else {
                    slice.timerText.text = "";
                }
            }
        }

        tick() {
            if (!this.gameState || !this.ui.centralPanel) return;
            
            this.updateTimerDisplay();
            
            if (this.isHost()) this.driveHostLogic();
        }

        driveHostLogic() {
             if (!this.gameState.currentHostUid || !scene.users[this.gameState.currentHostUid]) {
                const allUsers = Object.keys(scene.users || {}).sort();
                if (allUsers.length > 0 && scene.users[allUsers[0]]) {
                    this.updateState({ currentHostUid: allUsers[0] });
                }
            }
            
            const now = Date.now();
            let stateChanged = false;

            // Handle disconnected players and automatic timeouts
            for (const userId in this.gameState.players) {
                const player = this.gameState.players[userId];
                const isPresent = !!scene.users[userId];

                if (isPresent && player.isDisconnected) {
                    this.log(`Player ${userId} reconnected.`);
                    player.isDisconnected = false;
                    player.disconnectTime = null;
                    stateChanged = true;
                } else if (!isPresent && !player.isDisconnected) {
                    this.log(`Player ${userId} detected as gone, starting grace period.`);
                    player.isDisconnected = true;
                    player.disconnectTime = now;
                    stateChanged = true;
                } else if (player.isDisconnected && player.disconnectTime && (now - player.disconnectTime >= DISCONNECT_TIMEOUT_MS)) {
                    this.log(`Player ${userId} grace period expired. Removing.`);
                    this.applyGameLogic(this.gameState, "timeout-player", userId, player.name, { timedOutPlayerId: userId, playSound: true });
                    stateChanged = true;
                }
            }

            // Turn timer logic
            if (this.gameState.gameStarted && this.gameState.currentPlayerId && this.gameState.turnStartTime) {
                const timeElapsed = now - this.gameState.turnStartTime;

                if (timeElapsed >= this.gameState.turnDuration) {
                    this.log(`Player ${this.gameState.currentPlayerId} timed out!`);
                    this.applyGameLogic(this.gameState, "timeout-player", this.gameState.currentPlayerId, "System", { timedOutPlayerId: this.gameState.currentPlayerId, playSound: true });
                    stateChanged = true;
                }
            }

            if (stateChanged) {
                // We use an empty object because applyGameLogic already mutated this.gameState, 
                // and updateState stringifies the whole this.gameState object.
                this.updateState({});
            }
        }
    }

    const game = new Rummy10Game();
    if (window.BS) game.init();
    else window.addEventListener("bs-loaded", () => game.init());

})();
