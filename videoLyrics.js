(async function VideoLyricsExtension() {
    while (!Spicetify?.Player || !Spicetify?.Platform || !Spicetify?.Playbar) {
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // ───────── Einstellungen ─────────
    const AUTO_ENABLE_VIDEO = true;
    const USE_CANVAS_FALLBACK = true;

    // ───────── State ─────────
    let isOpen = false;
    let currentTrackUri = "";
    let lyricsData = [];
    let lineEls = [];
    let lastActiveIdx = -1;
    let lyricsToken = 0;
    let syncInterval = null;
    let tick = 0;

    let currentHostedVideo = null;
    let videoContainerOriginalParent = null;
    let videoContainerOriginalSibling = null;
    let videoOriginalStyle = "";

    let videoEnableAttempts = 0;
    let lastEnableClick = 0;

    // NEU: Manueller Offset (in Millisekunden). 
    let manualOffsetMs = 0; 

    // NEU: Cache für die Lyrics, damit sie nicht verloren gehen, wenn das Video verschoben wird
    let lyricsCache = {}; 

    // ───────── Styles ─────────
    const style = document.createElement("style");
    style.id = "vl-style";
    style.innerHTML = `
        /* ───── Fenster-Buttons oben rechts rigoros ausblenden ───── */
        body.vl-mode-active .electron-window-controls,
        body.vl-mode-active .window-controls-container,
        body.vl-mode-active [class*="window-controls"],
        body.vl-mode-active [class*="WindowControls"],
        body.vl-mode-active [class*="TitleBar"],
        body.vl-mode-active [class*="titlebar"],
        body.vl-mode-active [class*="TopBar"],
        body.vl-mode-active .Root__top-bar,
        body.vl-mode-active .Root__nav-bar,
        body.vl-mode-active button[aria-label*="Minimize"],
        body.vl-mode-active button[aria-label*="Maximize"],
        body.vl-mode-active button[aria-label*="Close"],
        body.vl-mode-active button[title*="Minimize"],
        body.vl-mode-active button[title*="Maximize"],
        body.vl-mode-active button[title*="Close"],
        body.vl-mode-active button[title*="Schließen"],
        body.vl-mode-active .window-controls {
            opacity: 0 !important;
            pointer-events: none !important;
            visibility: hidden !important;
            display: none !important;
        }

        #vl-overlay {
            position: fixed;
            inset: 0;
            background: #000;
            z-index: 9998;
            display: none;
            color: #fff;
            font-family: var(--font-family, sans-serif);
            -webkit-app-region: no-drag;
            --vl-rgb: 90, 50, 140;
            --vl-accent: rgb(155, 95, 235);
            overflow: hidden;
        }
        #vl-overlay.active { display: block; }

        /* ───── Video ───── */
        #vl-video-side {
            position: absolute;
            inset: 0;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        }

        #vl-video-frame {
            position: relative;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            background: #000;
        }

        #vl-video-frame video.vl-hosted-video {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            max-width: none !important;
            max-height: none !important;
            object-fit: cover !important; 
            transform: none !important;
            opacity: 1 !important;
            visibility: visible !important;
            display: block !important;
            z-index: 2 !important;
            margin: 0 !important;
            background: #000;
            transition: opacity 0.3s ease;
        }

        #vl-native-video {
            position: absolute;
            inset: 0;
            z-index: 2;
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: none;
            background: #000;
        }
        #vl-native-video.visible { display: block; }

        #vl-cover-only {
            position: absolute;
            inset: 0;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            background: radial-gradient(circle at 50% 45%, rgba(var(--vl-rgb), 0.68), rgba(8, 8, 8, 0.94) 74%);
            transition: opacity 0.3s ease;
        }
        #vl-cover-only.hidden { display: none; }
        #vl-cover-art {
            width: 320px;
            height: 320px;
            border-radius: 22px;
            object-fit: cover;
            box-shadow: 0 22px 55px rgba(0, 0, 0, 0.8), 0 0 42px rgba(var(--vl-rgb), 0.5);
        }

        /* ───── Lyrics ───── */
        #vl-lyrics-side {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            width: 46%;
            max-width: 720px;
            padding: 100px 56px 160px 44px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 22px;
            scroll-behavior: smooth;
            z-index: 5;
            background: linear-gradient(
                90deg,
                rgba(8, 8, 12, 0) 0%,
                rgba(8, 8, 12, 0.18) 22%,
                rgba(8, 8, 12, 0.42) 55%,
                rgba(8, 8, 12, 0.58) 100%
            );
            backdrop-filter: blur(22px) saturate(130%);
            -webkit-backdrop-filter: blur(22px) saturate(130%);
            -webkit-mask-image:
                linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%),
                linear-gradient(180deg, transparent 0%, #000 12%, #000 82%, transparent 100%);
            -webkit-mask-composite: source-in;
            mask-image:
                linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%),
                linear-gradient(180deg, transparent 0%, #000 12%, #000 82%, transparent 100%);
            mask-composite: intersect;
            scrollbar-width: none;
        }
        #vl-lyrics-side::-webkit-scrollbar { display: none; }

        .vl-line {
            font-size: 28px;
            font-weight: 800;
            line-height: 1.35;
            cursor: pointer;
            transition: transform 0.25s ease, color 0.25s ease, filter 0.25s ease, text-shadow 0.25s ease;
            padding: 2px 0;
            position: relative;
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
            filter: blur(0.6px);
            white-space: normal;
            word-break: break-word;
            color: rgba(255, 255, 255, 0.22);
        }
        .vl-line:hover { color: rgba(255, 255, 255, 0.6); filter: blur(0px); }
        .vl-line.plain { color: rgba(255, 255, 255, 0.8); cursor: default; filter: none; }
        .vl-line.active {
            transform: scale(1.04);
            transform-origin: left;
            filter: blur(0px);
            color: #ffffff;
            text-shadow: 0 0 20px rgba(255, 255, 255, 0.4), 0 2px 10px rgba(0, 0, 0, 0.8);
        }

        /* ───── Player-Pill ───── */
        #vl-pill-player {
            position: absolute;
            bottom: 20px;
            left: 20px;
            z-index: 20;
            width: 420px;
            max-width: calc(54vw - 40px);
            background: rgba(16, 16, 18, 0.62);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 18px;
            padding: 8px 12px;
            backdrop-filter: blur(24px) saturate(160%);
            -webkit-backdrop-filter: blur(24px) saturate(160%);
            box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255,255,255,0.08);
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        #vl-pill-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        #vl-pill-left { display: flex; align-items: center; gap: 4px; min-width: 0; }
        .vl-icon-btn {
            background: transparent; border: none; color: rgba(255, 255, 255, 0.72);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            padding: 5px; border-radius: 50%; position: relative;
            transition: color 0.15s, background 0.15s, transform 0.15s;
        }
        .vl-icon-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.08); transform: scale(1.08); }
        .vl-icon-btn.active { color: var(--vl-accent); }
        .vl-icon-btn.active::after {
            content: ""; position: absolute; bottom: 0; width: 3px; height: 3px;
            border-radius: 50%; background: var(--vl-accent);
        }
        #vl-play-circle {
            width: 32px; height: 32px; border-radius: 50%; background: #fff; color: #000;
            border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
            flex-shrink: 0; transition: transform 0.15s, box-shadow 0.15s;
            box-shadow: 0 0 14px rgba(255,255,255,0.25);
        }
        #vl-play-circle:hover { transform: scale(1.08); box-shadow: 0 0 20px rgba(255,255,255,0.4); }

        #vl-track-chip {
            display: flex; align-items: center; gap: 8px; background: rgba(255, 255, 255, 0.07);
            border-radius: 10px; padding: 3px 10px 3px 4px; min-width: 0; 
            max-width: 280px;
            margin-left: 4px;
            flex-shrink: 1;
        }
        #vl-chip-img { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
        
        #vl-chip-title { 
            font-size: 12px; 
            font-weight: 700; 
            white-space: normal;
            word-break: break-word;
            line-height: 1.2;
            overflow: hidden; 
            text-overflow: ellipsis; 
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
        }

        #vl-pill-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        #vl-vol-range { width: 60px; accent-color: var(--vl-accent); cursor: pointer; }

        #vl-pill-bottom {
            display: flex; align-items: center; gap: 8px; font-size: 10px;
            color: rgba(255, 255, 255, 0.7); font-variant-numeric: tabular-nums;
        }
        #vl-bar-bg { flex: 1; height: 3px; border-radius: 999px; background: rgba(255, 255, 255, 0.18); cursor: pointer; overflow: hidden; }
        #vl-bar-bg:hover { height: 5px; }
        #vl-bar-fill {
            height: 100%; width: 0%; background: linear-gradient(90deg, var(--vl-accent), #fff);
            border-radius: 999px; transition: width 0.15s linear;
        }
    `;
    document.head.appendChild(style);

    // ───────── Overlay ─────────
    const overlay = document.createElement("div");
    overlay.id = "vl-overlay";
    overlay.innerHTML = `
        <div id="vl-video-side">
            <div id="vl-video-frame">
                <div id="vl-cover-only">
                    <img id="vl-cover-art" src="" alt="Cover" />
                </div>
                <video id="vl-native-video" autoplay loop muted playsinline></video>
            </div>
        </div>
        <div id="vl-lyrics-side"></div>

        <div id="vl-pill-player">
            <div id="vl-pill-top">
                <div id="vl-pill-left">
                    <button class="vl-icon-btn" id="vl-shuf-btn" title="Zufallswiedergabe">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4h2.6c1.6 0 2.5.8 3.4 2.2l1.1 1.6c.9 1.4 1.8 2.2 3.4 2.2h2.5M1.5 12h2.6c1.1 0 1.9-.4 2.5-1.1M8.4 5.6C9 4.6 10 4 11.2 4h3.3M12.8 2.3 14.5 4l-1.7 1.7M12.8 8.3l1.7 1.7-1.7 1.7"/></svg>
                    </button>
                    <button class="vl-icon-btn" id="vl-prev-btn" title="Zurück">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.575a.7.7 0 0 1-1.05.607L4 9.149V14.3a.7.7 0 0 1-.7.7H1.7a.7.7 0 0 1-.7-.7V1.7a.7.7 0 0 1 .7-.7h1.6z"/></svg>
                    </button>
                    <button id="vl-play-circle" title="Play/Pause">
                        <svg id="vl-play-svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7H2.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-2.6z"/></svg>
                    </button>
                    <button class="vl-icon-btn" id="vl-next-btn" title="Weiter">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.575a.7.7 0 0 0 1.05.607L12 9.149V14.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-1.6z"/></svg>
                    </button>
                    <button class="vl-icon-btn" id="vl-rep-btn" title="Wiederholen">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5V6.5a2 2 0 0 1 2-2h9M11.5 2.5l2 2-2 2M13.5 8.5v1a2 2 0 0 1-2 2h-9M4.5 13.5l-2-2 2-2"/></svg>
                    </button>

                    <div id="vl-track-chip">
                        <img id="vl-chip-img" src="" alt="" />
                        <span id="vl-chip-title">Titel</span>
                    </div>
                </div>

                <div id="vl-pill-right">
                    <button class="vl-icon-btn" id="vl-sync-btn" title="Lyrics synchronisieren (Pfeiltasten)">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a4 4 0 0 0 0 8h8a4 4 0 0 0 0-8H8z"/><path d="M3 8h10"/><path d="M5 6l2 2-2 2"/></svg>
                    </button>

                    <button class="vl-icon-btn" id="vl-fullscreen-btn" title="Vollbild (F11)">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>
                    </button>

                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 6h2.5L8 3v10l-3.5-3H2z" fill="currentColor"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                    <input type="range" id="vl-vol-range" min="0" max="1" step="0.02" value="1">
                </div>
            </div>

            <div id="vl-pill-bottom">
                <span id="vl-time-cur">0:00</span>
                <div id="vl-bar-bg"><div id="vl-bar-fill"></div></div>
                <span id="vl-time-tot">0:00</span>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const videoFrame = document.getElementById("vl-video-frame");
    const canvasVideo = document.getElementById("vl-native-video");
    const coverOnly = document.getElementById("vl-cover-only");
    const lyricsSide = document.getElementById("vl-lyrics-side");
    const volRange = document.getElementById("vl-vol-range");

    // ───────── Helfer ─────────
    function formatTime(ms) {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${s < 10 ? "0" : ""}${s}`;
    }

    function toImgUrl(uri) {
        if (!uri) return "";
        if (uri.startsWith("spotify:image:")) return "https://i.scdn.co/image/" + uri.split(":")[2];
        return uri;
    }

    function setAccent(r, g, b) {
        overlay.style.setProperty("--vl-rgb", `${r}, ${g}, ${b}`);
        const ar = Math.min(255, Math.round(r * 1.2 + 25));
        const ag = Math.min(255, Math.round(g * 1.2 + 25));
        const ab = Math.min(255, Math.round(b * 1.2 + 25));
        overlay.style.setProperty("--vl-accent", `rgb(${ar}, ${ag}, ${ab})`);
    }

    async function applyCoverAccent(trackUri, imgUrl) {
        try {
            if (Spicetify.colorExtractor) {
                const c = await Spicetify.colorExtractor(trackUri);
                const hex = c?.VIBRANT || c?.PROMINENT || c?.DARK_VIBRANT;
                if (hex && /^#[0-9a-f]{6}$/i.test(hex)) {
                    setAccent(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
                    return;
                }
            }
        } catch (_) {}

        if (!imgUrl) return;
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = 24;
                canvas.height = 24;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, 24, 24);
                const data = ctx.getImageData(0, 0, 24, 24).data;
                let bR = 120, bG = 70, bB = 200, best = -1;
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i], g = data[i + 1], b = data[i + 2];
                    const max = Math.max(r, g, b), min = Math.min(r, g, b);
                    const sat = max === 0 ? 0 : (max - min) / max;
                    const lum = (r + g + b) / 3;
                    if (lum > 30 && lum < 235) {
                        const score = sat * 1.4 + (lum / 255) * 0.4;
                        if (score > best) { best = score; bR = r; bG = g; bB = b; }
                    }
                }
                setAccent(bR, bG, bB);
            } catch (_) {}
        };
        img.src = imgUrl;
    }

    // ───────── Video-Handling ─────────
    function getSpotifyVideo() {
        const videos = Array.from(document.querySelectorAll("video")).filter(v => 
            v !== canvasVideo && v.videoWidth > 0 && v.readyState >= 2
        );
        const musicVideo = videos.find(v => !v.loop && (!isFinite(v.duration) || v.duration > 45));
        if (musicVideo) return musicVideo;
        
        const canvasVid = videos.find(v => v.loop && /^https?:/i.test(v.currentSrc || ""));
        if (canvasVid) return canvasVid;
        
        return null;
    }

    function hostVideo(v) {
        if (currentHostedVideo === v) return;
        releaseVideo();

        currentHostedVideo = v;
        
        videoContainerOriginalParent = v.parentNode;
        videoContainerOriginalSibling = v.nextSibling;
        videoOriginalStyle = v.getAttribute("style") || "";

        v.classList.add("vl-hosted-video");
        videoFrame.insertBefore(v, canvasVideo);

        if (Spicetify.Player.isPlaying() && v.paused) {
            v.play().catch(() => {});
        }
    }

    function releaseVideo() {
        const v = currentHostedVideo;
        if (!v) return;
        
        currentHostedVideo = null;
        v.classList.remove("vl-hosted-video");
        v.setAttribute("style", videoOriginalStyle);

        try {
            if (videoContainerOriginalParent && videoContainerOriginalParent.isConnected) {
                const ref = videoContainerOriginalSibling && videoContainerOriginalSibling.parentNode === videoContainerOriginalParent 
                            ? videoContainerOriginalSibling : null;
                videoContainerOriginalParent.insertBefore(v, ref);
            }
        } catch (_) {}

        videoContainerOriginalParent = null;
        videoContainerOriginalSibling = null;
        manualOffsetMs = 0; 
    }

    function tryEnableVideoMode() {
        if (!AUTO_ENABLE_VIDEO || videoEnableAttempts <= 0) return;
        if (Date.now() - lastEnableClick < 2500) return;
        const re = /(switch to video|watch (the )?video|play video|zum video|zu video|video ansehen|video wechseln|video anzeigen)/i;
        const btn = Array.from(document.querySelectorAll("button, [role='button']")).find(b => {
            if (b.closest("#vl-overlay")) return false;
            const t = `${b.getAttribute("aria-label") || ""} ${b.title || ""}`;
            return re.test(t);
        });
        if (btn) {
            videoEnableAttempts--;
            lastEnableClick = Date.now();
            btn.click();
        }
    }

    function showMode(mode) {
        coverOnly.classList.toggle("hidden", mode !== "cover");
        canvasVideo.classList.toggle("visible", mode === "canvas");
        
        if (mode !== "canvas" && canvasVideo.getAttribute("src")) {
            canvasVideo.pause();
            canvasVideo.removeAttribute("src");
            canvasVideo.load();
        }
    }

    function syncMedia() {
        if (currentHostedVideo) {
            if (currentHostedVideo.videoWidth === 0 || currentHostedVideo.readyState === 0) {
                releaseVideo();
            } else {
                if (Spicetify.Player.isPlaying() && currentHostedVideo.paused && !currentHostedVideo.ended) {
                    currentHostedVideo.play().catch(() => {});
                }
                showMode("music");
                return;
            }
        }

        const mv = getSpotifyVideo();
        if (mv) {
            if (mv.loop && /^https?:/i.test(mv.currentSrc || "")) {
                const url = mv.currentSrc;
                if (canvasVideo.getAttribute("src") !== url) canvasVideo.src = url;
                if (Spicetify.Player.isPlaying()) canvasVideo.play().catch(() => {});
                else canvasVideo.pause();
                showMode("canvas");
            } else {
                hostVideo(mv);
                showMode("music");
            }
            return;
        }

        tryEnableVideoMode();
        showMode("cover");
    }

    // ───────── Vollbild & Steuerung ─────────
    function toggleFullscreen() {
        try {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    if (Spicetify.Platform?.PlatformData?.app) {
                        Spicetify.Platform.PlatformData.app.setFullscreen(true);
                    }
                });
            } else {
                document.exitFullscreen().catch(() => {
                    if (Spicetify.Platform?.PlatformData?.app) {
                        Spicetify.Platform.PlatformData.app.setFullscreen(false);
                    }
                });
            }
        } catch (err) {}
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "F11") {
            e.preventDefault();
            e.stopPropagation();
            toggleFullscreen();
        }
        
        if (isOpen && document.activeElement.tagName !== 'INPUT') {
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                manualOffsetMs -= 500; 
            }
            if (e.key === "ArrowRight") {
                e.preventDefault();
                manualOffsetMs += 500; 
            }
        }

        if (e.key === "Escape" && isOpen) {
            if (!document.fullscreenElement) {
                e.preventDefault();
                toggleOverlay(false);
            }
        }
    }, true);

    document.getElementById("vl-fullscreen-btn").onclick = toggleFullscreen;
    document.getElementById("vl-prev-btn").onclick = () => Spicetify.Player.back();
    document.getElementById("vl-next-btn").onclick = () => Spicetify.Player.next();
    document.getElementById("vl-play-circle").onclick = () => Spicetify.Player.togglePlay();
    document.getElementById("vl-shuf-btn").onclick = () => {
        Spicetify.Player.toggleShuffle();
        setTimeout(syncPlayerButtons, 120);
    };
    document.getElementById("vl-rep-btn").onclick = () => {
        Spicetify.Player.toggleRepeat();
        setTimeout(syncPlayerButtons, 120);
    };
    volRange.oninput = (e) => Spicetify.Player.setVolume(parseFloat(e.target.value));
    document.getElementById("vl-bar-bg").onclick = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        Spicetify.Player.seek(pct * Spicetify.Player.getDuration());
    };

    document.getElementById("vl-sync-btn").onclick = () => {
        manualOffsetMs += 500;
        if (manualOffsetMs > 2500) manualOffsetMs = -2500;
    };

    function syncPlayerButtons() {
        const playing = Spicetify.Player.isPlaying();
        document.getElementById("vl-play-svg").innerHTML = playing
            ? `<path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7H2.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-2.6z"/>`
            : `<path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/>`;

        document.getElementById("vl-shuf-btn").classList.toggle("active", !!Spicetify.Player.getShuffle());
        document.getElementById("vl-rep-btn").classList.toggle("active", Spicetify.Player.getRepeat() !== 0);
        volRange.value = Spicetify.Player.getVolume();

        if (canvasVideo.classList.contains("visible")) {
            if (playing) canvasVideo.play().catch(() => {});
            else canvasVideo.pause();
        }
    }

    // ───────── Lyrics ─────────
    function renderLines(lines, synced) {
        lyricsSide.textContent = "";
        const els = lines.map((l) => {
            const d = document.createElement("div");
            d.className = synced ? "vl-line" : "vl-line plain";
            
            if (synced) {
                d.textContent = l.text;
                d.onclick = () => Spicetify.Player.seek(l.time);
            } else {
                d.textContent = l;
            }
            
            lyricsSide.appendChild(d);
            return d;
        });
        lineEls = synced ? els : [];
        lastActiveIdx = -1;
        lyricsSide.scrollTop = 0;
    }

    function parseSynced(text) {
        return text.split("\n").map(line => {
            const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
            if (!m) return null;
            return {
                time: (parseInt(m[1], 10) * 60 + parseFloat(m[2])) * 1000,
                text: m[3].trim() || "♪"
            };
        }).filter(Boolean);
    }

    async function fetchLyrics(title, artist, durationMs) {
        const token = ++lyricsToken;
        lyricsData = [];
        
        // Prüfe zuerst den Cache
        if (lyricsCache[title]) {
            lyricsData = lyricsCache[title].data;
            renderLines(lyricsData, lyricsCache[title].synced);
            return;
        }

        renderLines(["Lade Lyrics..."], false);

        try {
            const base = "https://lrclib.net/api";
            const enc = encodeURIComponent;
            let data = null;

            const res = await fetch(`${base}/get?artist_name=${enc(artist)}&track_name=${enc(title)}&duration=${Math.round(durationMs / 1000)}`);
            if (res.ok) data = await res.json();

            if (!data?.syncedLyrics && !data?.plainLyrics) {
                const sr = await fetch(`${base}/search?track_name=${enc(title)}&artist_name=${enc(artist)}`);
                if (sr.ok) {
                    const list = await sr.json();
                    data = list.find(x => x.syncedLyrics) || list.find(x => x.plainLyrics) || null;
                }
            }

            if (token !== lyricsToken) return;

            if (data?.syncedLyrics) {
                lyricsData = parseSynced(data.syncedLyrics);
                lyricsCache[title] = { data: lyricsData, synced: true }; // Cachen
                renderLines(lyricsData, true);
            } else if (data?.plainLyrics) {
                const lines = data.plainLyrics.split("\n");
                lyricsCache[title] = { data: lines, synced: false }; // Cachen
                renderLines(lines, false);
            } else {
                renderLines(["Keine Lyrics gefunden."], false);
            }
        } catch (e) {
            if (token !== lyricsToken) return;
            renderLines(["Fehler beim Laden der Lyrics."], false);
        }
    }

    function scrollToLine(el) {
        lyricsSide.scrollTo({
            top: el.offsetTop - lyricsSide.clientHeight / 2 + el.offsetHeight / 2,
            behavior: "smooth"
        });
    }

    function updateLyricsHighlight(pos) {
        if (!lyricsData.length || !lineEls.length) return;
        
        const adjustedPos = pos + manualOffsetMs;

        let idx = -1;
        for (let i = 0; i < lyricsData.length; i++) {
            if (adjustedPos >= lyricsData[i].time) idx = i;
            else break;
        }
        
        if (idx === lastActiveIdx) return;
        
        if (lastActiveIdx >= 0) {
            lineEls[lastActiveIdx]?.classList.remove("active");
        }
        
        if (idx >= 0) {
            lineEls[idx].classList.add("active");
            scrollToLine(lineEls[idx]);
        }
        lastActiveIdx = idx;
    }

    // ───────── Inhalt / Sync ─────────
    function updateContent() {
        const item = Spicetify.Player.data?.item;
        if (!item) return;

        const md = item.metadata || {};
        const title = md.title || item.name || "";
        const artist = md.artist_name || item.artists?.[0]?.name || "";
        const duration = item.duration?.milliseconds ?? Spicetify.Player.getDuration();
        const cover = toImgUrl(md.image_xlarge_url || md.image_large_url || md.image_url || item.images?.[0]?.url);

        document.getElementById("vl-chip-title").innerText = title;
        document.getElementById("vl-chip-img").src = cover;
        document.getElementById("vl-cover-art").src = cover;
        document.getElementById("vl-time-tot").innerText = formatTime(duration);

        if (item.uri !== currentTrackUri) {
            currentTrackUri = item.uri;
            releaseVideo();
            videoEnableAttempts = AUTO_ENABLE_VIDEO ? 4 : 0;
            applyCoverAccent(item.uri, cover);
            fetchLyrics(title, artist, duration);
        }

        syncPlayerButtons();
        syncMedia();
    }

    function stopSync() {
        if (syncInterval) clearInterval(syncInterval);
        syncInterval = null;
    }

    function startSync() {
        stopSync();
        tick = 0;
        syncInterval = setInterval(() => {
            if (!isOpen) return;
            tick++;
            if (tick % 3 === 1) syncMedia();

            const pos = Spicetify.Player.getProgress();
            const dur = Spicetify.Player.getDuration();
            document.getElementById("vl-time-cur").innerText = formatTime(pos);
            if (dur > 0) {
                document.getElementById("vl-bar-fill").style.width = `${(pos / dur) * 100}%`;
            }
            
            updateLyricsHighlight(pos);
        }, 100); 
    }

    // ───────── Overlay Toggle ─────────
    function toggleOverlay(forceState) {
        isOpen = typeof forceState === "boolean" ? forceState : !isOpen;
        overlay.classList.toggle("active", isOpen);
        document.body.classList.toggle("vl-mode-active", isOpen);

        if (isOpen) {
            currentTrackUri = "";
            updateContent();
            startSync();
        } else {
            stopSync();
            releaseVideo();
            showMode("cover");
            currentTrackUri = "";
            
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        }
    }

    window.addEventListener("beforeunload", releaseVideo);

    Spicetify.Player.addEventListener("songchange", () => {
        if (!isOpen) return;
        releaseVideo();
        setTimeout(() => { if (isOpen) updateContent(); }, 150);
    });
    Spicetify.Player.addEventListener("onplaypause", () => { if (isOpen) syncPlayerButtons(); });

    new Spicetify.Playbar.Button(
        "Video & Lyrics Split-Screen",
        `<svg role="img" height="16" width="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3zm1 0v10h5V3H2zm6 0v10h6V3H8z"/></svg>`,
        () => toggleOverlay()
    );
})();
