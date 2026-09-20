/**
 * Trình Phát Nhạc Sự Kiện Chuyên Nghiệp (Event Audio Master Pro)
 * Xử lý logic giao diện, 2 bộ phát, phím tắt, kịch bản sự kiện, chủ đề Sáng/Tối
 */

document.addEventListener('DOMContentLoaded', () => {
    const engine = window.audioEngine;

    // --- DỮ LIỆU BÀN PHÍM HIỆU ỨNG TỨC THÌ: TỪ 0 ĐẾN 9 VÀ TOÀN BỘ BẢNG CHỮ CÁI TIẾNG ANH (A - Z) ---
    const PAD_GROUPS = [
        'group-applause',
        'group-award',
        'group-drama',
        'group-game',
        'group-hype',
        'group-fx',
        'group-event',
        'group-fun',
        'group-chill'
    ];

    const ALL_PAD_KEYS = [
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
        'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
    ];

    const DEFAULT_PAD_DATA = {};
    ALL_PAD_KEYS.forEach((k, idx) => {
        const padId = String(idx + 1);
        DEFAULT_PAD_DATA[padId] = {
            name: `Phím ${k}`,
            key: k,
            cat: isNaN(k) ? 'Chữ cái' : 'Số',
            group: PAD_GROUPS[idx % PAD_GROUPS.length],
            duration: '--',
            volume: 1.0,
            isLoop: false,
            isCustom: false,
            fileName: ''
        };
    });

    const padData = JSON.parse(JSON.stringify(DEFAULT_PAD_DATA));

    // Danh sách bài hát kịch bản sự kiện (Người dùng tự thêm từ máy tính)
    let playlistTracks = [];

    // Đọc cấu hình phím tắt và ô hiệu ứng từ LocalStorage nếu có
    const PAD_CONFIG_VERSION = 'v5_0to9_and_AtoZ';
    try {
        const savedVersion = localStorage.getItem('event_audio_pad_version');
        const saved = localStorage.getItem('event_audio_pad_config');
        if (saved && savedVersion === PAD_CONFIG_VERSION) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                for (const k in padData) delete padData[k];
                for (const k in parsed) {
                    padData[k] = parsed[k];
                    // Xóa triệt để dữ liệu âm thanh mặc định: nếu không phải file tự nạp thì đặt về trống
                    if (!padData[k].isCustom || !padData[k].fileName) {
                        padData[k].isCustom = false;
                        padData[k].fileName = '';
                        padData[k].type = null;
                        padData[k].duration = '--';
                    }
                }
            }
        } else {
            // Nâng cấp dữ liệu: giữ nguyên các file âm thanh người dùng đã nạp cho phím tương ứng
            if (saved) {
                try {
                    const oldParsed = JSON.parse(saved);
                    for (const oldId in oldParsed) {
                        const oldItem = oldParsed[oldId];
                        if (oldItem.isCustom && oldItem.fileName) {
                            const oldKey = (oldItem.key || '').toUpperCase();
                            const targetId = Object.keys(padData).find(pid => (padData[pid].key || '').toUpperCase() === oldKey);
                            if (targetId) {
                                padData[targetId].name = oldItem.name || padData[targetId].name;
                                padData[targetId].fileName = oldItem.fileName;
                                padData[targetId].isCustom = true;
                                padData[targetId].duration = oldItem.duration || '--';
                                padData[targetId].volume = oldItem.volume !== undefined ? oldItem.volume : 1.0;
                                padData[targetId].isLoop = oldItem.isLoop || false;
                            }
                        }
                    }
                } catch (e) {}
            }
            localStorage.setItem('event_audio_pad_version', PAD_CONFIG_VERSION);
            savePadConfig();
        }
    } catch (e) {
        console.warn('Không thể đọc cấu hình LocalStorage', e);
    }

    // --- CÁC PHẦN TỬ GIAO DIỆN (DOM) ---
    // Nút chuyển chủ đề Sáng / Tối & Kích cỡ
    const btnThemeToggle = document.getElementById('btnThemeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const themeText = document.getElementById('themeText');

    const btnSizeToggle = document.getElementById('btnSizeToggle');
    const sizeText = document.getElementById('sizeText');

    // Đồng hồ & Bộ đếm thời gian
    const realtimeClockEl = document.getElementById('realtimeClock');
    const eventTimerDisplay = document.getElementById('eventTimerDisplay');
    const timerModeLabel = document.getElementById('timerModeLabel');
    const btnTimerToggle = document.getElementById('btnTimerToggle');
    const btnTimerReset = document.getElementById('btnTimerReset');
    const btnTimerMode = document.getElementById('btnTimerMode');

    // Nút chức năng đỉnh
    const btnHotkeyHelp = document.getElementById('btnHotkeyHelp');
    const btnFullscreen = document.getElementById('btnFullscreen');
    const fullscreenText = document.getElementById('fullscreenText');
    const duckingBadge = document.getElementById('duckingBadge');
    const masterVolumeSlider = document.getElementById('masterVolumeSlider');
    const masterVolVal = document.getElementById('masterVolVal');

    // Trình phát kịch bản sự kiện (Playlist Background Player)
    const playlistPlayerBar = document.getElementById('playlistPlayerBar');
    const playerTrackTitle = document.getElementById('playerTrackTitle');
    const playerTrackStatus = document.getElementById('playerTrackStatus');
    const playlistTrackIcon = document.getElementById('playlistTrackIcon');
    const btnPlaylistPrev = document.getElementById('btnPlaylistPrev');
    const btnPlaylistPlayPause = document.getElementById('btnPlaylistPlayPause');
    const playlistPlayIcon = document.getElementById('playlistPlayIcon');
    const playlistPlayText = document.getElementById('playlistPlayText');
    const btnPlaylistStop = document.getElementById('btnPlaylistStop');
    const btnPlaylistNext = document.getElementById('btnPlaylistNext');
    const btnPlaylistLoop = document.getElementById('btnPlaylistLoop');
    const playlistCurrentTime = document.getElementById('playlistCurrentTime');
    const playlistDurationTime = document.getElementById('playlistDurationTime');
    const playlistProgressContainer = document.getElementById('playlistProgressContainer');
    const playlistProgressFill = document.getElementById('playlistProgressFill');

    // Bàn phím hiệu ứng
    const soundboardGrid = document.getElementById('soundboardGrid');

    // Danh sách bài hát đã tải lên
    const playlistContainer = document.getElementById('playlistContainer');
    const playlistFileInput = document.getElementById('playlistFileInput');
    const musicCountBadge = document.getElementById('musicCountBadge');
    const btnClearAllTracks = document.getElementById('btnClearAllTracks');

    // Hộp thoại cấu hình ô hiệu ứng
    const padConfigModal = document.getElementById('padConfigModal');
    const btnModalClose = document.getElementById('btnModalClose');
    const btnModalSave = document.getElementById('btnModalSave');
    const btnModalReset = document.getElementById('btnModalReset');
    const btnModalDeletePad = document.getElementById('btnModalDeletePad');
    const modalPadTitle = document.getElementById('modalPadTitle');
    const modalPadName = document.getElementById('modalPadName');
    const modalPadKey = document.getElementById('modalPadKey');
    const modalPadType = document.getElementById('modalPadType');
    const modalPadFileInput = document.getElementById('modalPadFileInput');
    const modalCustomStatus = document.getElementById('modalCustomStatus');
    const btnAddPad = document.getElementById('btnAddPad');
    let currentEditingPadId = null;

    // Hộp thoại phím tắt
    const hotkeyHelpModal = document.getElementById('hotkeyHelpModal');
    const btnHelpModalClose = document.getElementById('btnHelpModalClose');
    const btnHelpModalOk = document.getElementById('btnHelpModalOk');

    // =========================================================
    // 1. CHUYỂN ĐỔI CHỦ ĐỀ SÁNG / TỐI & KÍCH CỠ NHỎ GỌN
    // =========================================================
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        if (theme === 'light') {
            themeIcon.textContent = '🌙';
            if (themeText) themeText.textContent = 'Giao diện Tối';
            btnThemeToggle.title = 'Giao diện Tối (Bấm để chuyển về nền tối mặc định)';
        } else {
            themeIcon.textContent = '☀️';
            if (themeText) themeText.textContent = 'Giao diện Sáng';
            btnThemeToggle.title = 'Giao diện Sáng (Bấm để chuyển sang nền trắng tinh tế)';
        }
        localStorage.setItem('event_audio_theme', theme);
    }

    const savedTheme = localStorage.getItem('event_audio_theme') || 'dark';
    applyTheme(savedTheme);

    btnThemeToggle.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = cur === 'dark' ? 'light' : 'dark';
        applyTheme(next);
    });

    // Chuyển đổi kích cỡ giao diện (Mặc định: Cỡ chuẩn, bấm để thu nhỏ)
    function applySize(size) {
        document.documentElement.setAttribute('data-size', size);
        if (size === 'compact') {
            if (sizeText) sizeText.textContent = 'Phóng to cỡ chuẩn';
            if (btnSizeToggle) btnSizeToggle.title = 'Cỡ thu nhỏ (Bấm để phóng to cỡ trang chuẩn)';
        } else {
            if (sizeText) sizeText.textContent = 'Thu nhỏ giao diện';
            if (btnSizeToggle) btnSizeToggle.title = 'Cỡ trang chuẩn (Bấm để thu nhỏ giao diện)';
        }
        localStorage.setItem('event_audio_size', size);
    }

    const savedSize = localStorage.getItem('event_audio_size') || 'normal';
    applySize(savedSize);

    if (btnSizeToggle) {
        btnSizeToggle.addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-size') || 'normal';
            const next = cur === 'normal' ? 'compact' : 'normal';
            applySize(next);
        });
    }

    // =========================================================
    // 2. ĐỒNG HỒ THỰC TẾ & BỘ ĐẾM GIỜ SỰ KIỆN
    // =========================================================
    function updateRealtimeClock() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        realtimeClockEl.textContent = `${h}:${m}:${s}`;
    }
    setInterval(updateRealtimeClock, 1000);
    updateRealtimeClock();

    let timerMode = 'stopwatch'; // 'stopwatch' | 'countdown'
    let timerSeconds = 0;
    const countdownTarget = 15 * 60; // 15 phút đếm ngược mặc định
    let isTimerRunning = false;
    let timerInterval = null;

    function formatTimeSeconds(totalSec) {
        const sec = Math.max(0, Math.floor(totalSec));
        const h = String(Math.floor(sec / 3600)).padStart(2, '0');
        const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function renderTimerDisplay() {
        if (timerMode === 'stopwatch') {
            eventTimerDisplay.textContent = formatTimeSeconds(timerSeconds);
        } else {
            const remaining = Math.max(0, countdownTarget - timerSeconds);
            eventTimerDisplay.textContent = formatTimeSeconds(remaining);
            if (remaining === 0 && isTimerRunning) {
                toggleTimer(false);
                engine.playSyntheticPad('buzzer');
                eventTimerDisplay.style.color = '#ef4444';
            }
        }
    }

    function toggleTimer(forceState = null) {
        isTimerRunning = forceState !== null ? forceState : !isTimerRunning;
        btnTimerToggle.textContent = isTimerRunning ? '⏸ Tạm dừng' : '▶ Chạy';

        if (isTimerRunning) {
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                timerSeconds++;
                renderTimerDisplay();
            }, 1000);
        } else {
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
        }
    }

    if (btnTimerToggle) btnTimerToggle.addEventListener('click', () => toggleTimer());
    if (btnTimerReset) btnTimerReset.addEventListener('click', () => {
        toggleTimer(false);
        timerSeconds = 0;
        if (eventTimerDisplay) eventTimerDisplay.style.color = '';
        renderTimerDisplay();
    });

    if (btnTimerMode) btnTimerMode.addEventListener('click', () => {
        timerMode = timerMode === 'stopwatch' ? 'countdown' : 'stopwatch';
        if (timerModeLabel) timerModeLabel.textContent = timerMode === 'stopwatch' ? 'THỜI LƯỢNG CHƯƠNG TRÌNH' : 'ĐẾM NGƯỢC (15 PHÚT)';
        timerSeconds = 0;
        if (eventTimerDisplay) eventTimerDisplay.style.color = '';
        renderTimerDisplay();
    });

    // =========================================================
    // 3. BIỂU ĐỒ SÓNG ÂM (SPECTRUM ANALYSER)
    // =========================================================
    const spectrumCanvas = document.getElementById('soundboardSpectrum');
    const spectrumContext = spectrumCanvas ? spectrumCanvas.getContext('2d') : null;
    let spectrumData = null;
    let spectrumGradient = null;
    let spectrumLastFrame = 0;
    let spectrumEnergy = 0;
    const spectrumPeaks = new Float32Array(64);
    const spectrumMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function resizeSpectrum() {
        if (!spectrumCanvas) return;
        const scale = Math.min(window.devicePixelRatio || 1, 1.5);
        spectrumCanvas.width = Math.round(window.innerWidth * scale);
        spectrumCanvas.height = Math.round(window.innerHeight * scale);
        spectrumGradient = null;
    }
    resizeSpectrum();
    window.addEventListener('resize', resizeSpectrum);

    function drawVisualizer(timestamp) {
        requestAnimationFrame(drawVisualizer);
        if (!spectrumContext || document.hidden || timestamp - spectrumLastFrame < 33) return;
        spectrumLastFrame = timestamp;
        const width = spectrumCanvas.width;
        const height = spectrumCanvas.height;
        const analyser = engine.analyser;
        if (analyser) {
            if (!spectrumData || spectrumData.length !== analyser.frequencyBinCount) {
                spectrumData = new Uint8Array(analyser.frequencyBinCount);
            }
            analyser.getByteFrequencyData(spectrumData);
        }
        spectrumContext.clearRect(0, 0, width, height);
        const audioRunning = analyser && engine.ctx && engine.ctx.state === 'running';
        let energy = 0;
        if (audioRunning) {
            for (let i = 0; i < spectrumData.length; i++) energy += spectrumData[i];
            energy /= spectrumData.length * 255;
        }
        spectrumEnergy += (energy - spectrumEnergy) * 0.18;
        const motion = !spectrumMotion.matches;
        const time = motion ? timestamp / 1000 : 0;

        // Soft pools of color breathe with the music, without flashing.
        if (spectrumEnergy > 0.005) {
            for (let i = 0; i < 3; i++) {
                const x = width * (0.2 + i * 0.3 + Math.sin(time * 0.35 + i) * 0.08);
                const y = height * (0.7 + Math.cos(time * 0.4 + i) * 0.12);
                const radius = Math.max(width, height) * (0.3 + spectrumEnergy * 0.15);
                const glow = spectrumContext.createRadialGradient(x, y, 0, x, y, radius);
                glow.addColorStop(0, `hsla(${[185, 290, 335][i]}, 100%, 60%, ${spectrumEnergy * 0.45})`);
                glow.addColorStop(1, 'transparent');
                spectrumContext.fillStyle = glow;
                spectrumContext.fillRect(0, 0, width, height);
            }
        }
        if (!spectrumGradient) {
            spectrumGradient = spectrumContext.createLinearGradient(0, height - 4, 0, 4);
            spectrumGradient.addColorStop(0, '#ff00cf');
            spectrumGradient.addColorStop(0.22, '#8427ff');
            spectrumGradient.addColorStop(0.42, '#008cff');
            spectrumGradient.addColorStop(0.58, '#00f5ed');
            spectrumGradient.addColorStop(0.76, '#62ff00');
            spectrumGradient.addColorStop(0.9, '#fff000');
            spectrumGradient.addColorStop(1, '#ff3020');
        }
        spectrumContext.fillStyle = spectrumGradient;
        const barCount = Math.max(28, Math.min(64, Math.floor(width / 22)));
        const gap = Math.max(3, width / 300);
        const barWidth = (width - 8 - gap * (barCount - 1)) / barCount;
        for (let i = 0; i < barCount; i++) {
            let value = 0;
            if (audioRunning) {
                // Logarithmic frequency groups show both bass and treble.
                const start = Math.floor(Math.pow(spectrumData.length, i / barCount)) - 1;
                const end = Math.max(start + 1, Math.floor(Math.pow(spectrumData.length, (i + 1) / barCount)) - 1);
                for (let bin = start; bin < end; bin++) value = Math.max(value, spectrumData[bin]);
            }
            const barHeight = Math.max(2, Math.pow(value / 255, 0.85) * (height - 8));
            const x = 4 + i * (barWidth + gap);
            spectrumContext.fillStyle = spectrumGradient;
            spectrumContext.fillRect(x, height - 4 - barHeight, barWidth, barHeight);
            spectrumPeaks[i] = Math.max(barHeight, spectrumPeaks[i] - height * 0.008);
            spectrumContext.fillStyle = '#baffff';
            spectrumContext.fillRect(x, height - 4 - spectrumPeaks[i], barWidth, 2);
        }

        if (motion && spectrumEnergy > 0.005) {
            const scale = Math.min(window.devicePixelRatio || 1, 1.5);
            spectrumContext.save();
            // Floating music notes fade in and out as they cross the background.
            spectrumContext.textAlign = 'center';
            spectrumContext.textBaseline = 'middle';
            for (let i = 0; i < 18; i++) {
                const phase = (time * (0.025 + (i % 4) * 0.006) + i * 0.618) % 1;
                const x = width * (0.06 + ((i * 0.618) % 1) * 0.88) + Math.sin(time * 0.7 + i) * 24 * scale;
                const y = height * (1.08 - phase * 1.2);
                const noteOpacity = Math.sin(phase * Math.PI) * Math.min(1, spectrumEnergy * 5);
                const noteLightness = document.documentElement.getAttribute('data-theme') === 'light' ? 40 : 65;
                const color = `hsla(${(i * 53 + time * 8) % 360}, 100%, ${noteLightness}%, ${noteOpacity})`;
                spectrumContext.save();
                spectrumContext.translate(x, y);
                spectrumContext.rotate(Math.sin(time * 0.8 + i) * 0.22);
                spectrumContext.font = `bold ${(44 + i % 4 * 12) * scale}px "Segoe UI Symbol", sans-serif`;
                spectrumContext.fillStyle = color;
                spectrumContext.shadowColor = color;
                spectrumContext.shadowBlur = 5 * scale;
                spectrumContext.fillText(['♪', '♫', '♬'][i % 3], 0, 0);
                spectrumContext.restore();
            }

            // Expanding rings and flowing ribbons respond to audio energy.
            spectrumContext.lineWidth = 1.5 * scale;
            for (let i = 0; i < 3; i++) {
                const phase = (time * 0.18 + i / 3) % 1;
                spectrumContext.strokeStyle = `hsla(${180 + i * 65}, 100%, 68%, ${(1 - phase) * spectrumEnergy * 0.45})`;
                spectrumContext.beginPath();
                spectrumContext.arc(width * (0.25 + i * 0.25), height * 0.8, (24 + phase * Math.min(width, height) * 0.4) * (0.8 + spectrumEnergy), 0, Math.PI * 2);
                spectrumContext.stroke();
            }
            for (let line = 0; line < 2; line++) {
                spectrumContext.strokeStyle = `hsla(${line ? 310 : 180}, 100%, 70%, ${spectrumEnergy * 0.55})`;
                spectrumContext.beginPath();
                for (let step = 0; step <= 80; step++) {
                    const x = step / 80 * width;
                    const y = height * (0.72 + line * 0.12) + Math.sin(step / 80 * Math.PI * 4 + time * 1.8 + line) * height * 0.06 * spectrumEnergy;
                    if (step === 0) spectrumContext.moveTo(x, y);
                    else spectrumContext.lineTo(x, y);
                }
                spectrumContext.stroke();
            }
            spectrumContext.restore();
            // A fixed number of particles keeps the animation lightweight.
            for (let i = 0; i < 36; i++) {
                const phase = (time * (0.04 + (i % 5) * 0.008) + i * 0.618) % 1;
                const x = ((i * 0.618 + Math.sin(time * 0.6 + i) * 0.025) % 1 + 1) % 1 * width;
                const y = height * (1 - phase);
                const radius = (1.5 + i % 3) * (1 + spectrumEnergy);
                spectrumContext.fillStyle = `hsla(${(i * 47 + time * 12) % 360}, 100%, 70%, ${Math.sin(phase * Math.PI) * spectrumEnergy * 0.9})`;
                spectrumContext.beginPath();
                spectrumContext.arc(x, y, radius, 0, Math.PI * 2);
                spectrumContext.fill();
            }
        }
    }
    requestAnimationFrame(drawVisualizer);

    // =========================================================
    // 4. BÀN PHÍM HIỆU ỨNG TỨC THÌ (SOUNDBOARD LOGIC)
    // =========================================================
    // Cài đặt chung FX (Global FX Settings)
    const globalFxSettings = {
        playMode: 'poly' // 'poly' | 'cut'
    };

    try {
        const savedGlobal = localStorage.getItem('event_audio_global_fx_settings');
        if (savedGlobal) {
            const savedMode = JSON.parse(savedGlobal).playMode;
            if (savedMode === 'poly' || savedMode === 'cut') globalFxSettings.playMode = savedMode;
        }
    } catch (e) {}


    const padActiveTimeouts = {};
    let currentActivePadId = null;

    // Các phần tử DOM bảng điều khiển hiệu ứng trung tâm (ở giữa)
    const soundboardCentralCtrl = document.getElementById('soundboardCentralCtrl');
    const centralKeyBadge = document.getElementById('centralKeyBadge');
    const centralPadName = document.getElementById('centralPadName');
    const btnCentralPlay = document.getElementById('btnCentralPlay');
    const centralPlayIcon = document.getElementById('centralPlayIcon');
    const centralPlayText = document.getElementById('centralPlayText');
    const btnCentralLoop = document.getElementById('btnCentralLoop');
    const btnCentralFade = document.getElementById('btnCentralFade');

    function updateCentralController() {
        if (!soundboardCentralCtrl) return;

        // Đánh dấu viền ô phím đang chọn trên lưới
        document.querySelectorAll('.fx-pad').forEach(p => {
            p.classList.toggle('pad-selected', p.dataset.pad === currentActivePadId);
        });

        if (!currentActivePadId || !padData[currentActivePadId]) {
            if (centralKeyBadge) centralKeyBadge.textContent = '--';
            if (centralPadName) centralPadName.textContent = 'Chưa chọn phím';
            if (centralPlayIcon) centralPlayIcon.textContent = '▶';
            if (centralPlayText) centralPlayText.textContent = 'Phát';
            if (btnCentralPlay) btnCentralPlay.classList.remove('playing');
            if (btnCentralLoop) btnCentralLoop.classList.remove('active');
            if (btnCentralFade) btnCentralFade.classList.remove('fading');
            return;
        }

        const data = padData[currentActivePadId];
        const isPlaying = engine.isPadPlaying(currentActivePadId);
        const isPaused = engine.isPadPaused(currentActivePadId);

        if (centralKeyBadge) centralKeyBadge.textContent = data.key || '--';
        if (centralPadName) {
            centralPadName.textContent = data.name || `Phím ${data.key}`;
            centralPadName.title = `Phím ${data.key}: ${data.name}`;
        }

        if (centralPlayIcon) {
            centralPlayIcon.textContent = isPlaying ? '⏸' : '▶';
        }
        if (centralPlayText) {
            centralPlayText.textContent = isPlaying ? 'Tạm dừng' : (isPaused ? 'Phát tiếp' : 'Phát');
        }
        if (btnCentralPlay) {
            btnCentralPlay.classList.toggle('playing', isPlaying);
        }

        if (btnCentralLoop) {
            btnCentralLoop.classList.toggle('active', !!data.isLoop);
        }
        if (btnCentralFade) {
            const state = engine.getPadState(currentActivePadId);
            btnCentralFade.classList.toggle('fading', isPlaying && !!state.fadeTimeout);
        }
    }

    const defaultDurations = {
        applause: '3.5',
        fanfare: '4.0',
        drumroll: '3.0',
        countdown: '4.0',
        tada: '2.5',
        buzzer: '1.5',
        tension: '4.0',
        airhorn: '2.0',
        whoosh: '1.5',
        ding: '1.5',
        heartbeat: '3.5',
        impact: '2.5',
        shutter: '1.2',
        laugh: '3.0',
        magic: '2.5',
        lounge: '5.0'
    };

    function getPadGroupClass(data) {
        if (data.group) return data.group;
        const map = {
            applause: 'group-applause',
            fanfare: 'group-award',
            tada: 'group-award',
            drumroll: 'group-drama',
            countdown: 'group-drama',
            tension: 'group-drama',
            heartbeat: 'group-drama',
            buzzer: 'group-game',
            ding: 'group-game',
            airhorn: 'group-hype',
            whoosh: 'group-fx',
            impact: 'group-fx',
            shutter: 'group-event',
            laugh: 'group-fun',
            magic: 'group-applause',
            lounge: 'group-chill'
        };
        return map[data.type] || 'group-award';
    }

    // Thông báo Toast nhanh cho người dùng
    function showToast(message) {
        let toast = document.getElementById('appToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'appToast';
            toast.className = 'app-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 2200);
    }

    // Định dạng thời lượng pad hiển thị gọn gàng (nếu > 60s thì đổi thành mm:ss)
    function formatPadDurationDisplay(dur) {
        if (!dur || dur === '--') return '--';
        const str = String(dur).trim();
        const num = parseFloat(str.replace('s', ''));
        if (isNaN(num)) return str;
        if (num >= 60) {
            const m = Math.floor(num / 60);
            const s = Math.floor(num % 60);
            return `${m}:${String(s).padStart(2, '0')}`;
        }
        return `${num.toFixed(1)}s`;
    }

    // Gán file âm thanh từ bài hát đã tải lên (hoặc kéo thả) vào một phím hiệu ứng
    async function assignTrackFileToPad(padId, file, title, knownDuration) {
        if (!padData[padId] || !file) return;
        const data = padData[padId];
        data.name = title || file.name.replace(/\.[^/.]+$/, '');
        data.fileName = file.name;
        data.isCustom = true;

        if (knownDuration && knownDuration !== '--') {
            data.duration = formatPadDurationDisplay(knownDuration);
        }

        const success = await engine.loadCustomPadAudio(padId, file);
        if (success && engine.soundboardBuffers[padId]) {
            data.duration = formatPadDurationDisplay(engine.soundboardBuffers[padId].duration);
        }

        // Lưu file âm thanh thực tế vào IndexedDB để không bị mất khi F5 / offline
        if (window.audioDB) {
            await window.audioDB.savePadAudio(padId, file, {
                fileName: data.fileName,
                title: data.name,
                duration: data.duration
            });
        }

        savePadConfig();
        renderSoundboard();
        renderModalPadListTable();

        // Hiệu ứng nhấp nháy xanh thành công trên ô phím
        const padEl = document.querySelector(`.fx-pad[data-pad="${padId}"]`);
        if (padEl) {
            padEl.classList.add('pad-drop-success');
            setTimeout(() => {
                padEl.classList.remove('pad-drop-success');
            }, 800);
        }

        showToast(`✅ Đã gán "${data.name}" vào Phím ${data.key}!`);
    }

    function renderSoundboard() {
        if (!soundboardGrid) return;
        soundboardGrid.innerHTML = '';
        for (const padId in padData) {
            const data = padData[padId];
            const groupClass = getPadGroupClass(data);
            const hasFile = data.isCustom && data.fileName;
            const durDisplay = hasFile ? formatPadDurationDisplay(data.duration) : '--';

            const isSelected = padId === currentActivePadId;
            const padEl = document.createElement('div');
            padEl.className = `fx-pad ${groupClass} ${isSelected ? 'pad-selected' : ''}`;
            padEl.dataset.pad = padId;
            padEl.dataset.key = (data.key || '').toUpperCase();
            padEl.title = hasFile 
                ? `Phím ${data.key}: ${data.name} (${data.fileName})\n👉 Bấm để chọn / phát hiệu ứng này!` 
                : `Phím ${data.key}: ${data.name} (Chưa có file)\n👉 Kéo bài hát từ danh sách dưới thả vào đây để gán nhanh!`;

            padEl.innerHTML = `
                <span class="key-badge">${data.key || ''}</span>
                <div class="pad-body">
                    <div class="pad-title-row">
                        <span class="pad-name" title="${escapeHtml(data.name)}">${escapeHtml(data.name || 'Phím')}</span>
                        <span class="pad-duration" style="${!hasFile ? 'opacity: 0.5;' : ''}">${durDisplay}</span>
                    </div>
                    <div class="pad-progress-track" title="Bấm hoặc kéo để chọn đoạn phát"><div class="pad-progress-bar"></div></div>
                </div>
                <button type="button" class="btn-pad-gear" data-pad="${padId}" title="Cài đặt ô này">⚙</button>
            `;

            // LẮNG NGHE SỰ KIỆN KÉO THẢ VÀO Ô PHÍM
            padEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                padEl.classList.add('pad-drop-target');
            });

            padEl.addEventListener('dragleave', (e) => {
                if (!padEl.contains(e.relatedTarget)) {
                    padEl.classList.remove('pad-drop-target');
                }
            });

            padEl.addEventListener('drop', async (e) => {
                e.preventDefault();
                padEl.classList.remove('pad-drop-target');

                // Trường hợp 1: Kéo thả từ danh sách bài hát đã nạp bên dưới
                const trackId = e.dataTransfer.getData('text/plain');
                if (trackId) {
                    const track = playlistTracks.find(t => t.id === trackId);
                    if (track && track.file) {
                        await assignTrackFileToPad(padId, track.file, track.title, track.duration);
                        return;
                    }
                }

                // Trường hợp 2: Kéo thả file trực tiếp từ máy tính vào ô phím
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i)) {
                        const title = file.name.replace(/\.[^/.]+$/, '');
                        await assignTrackFileToPad(padId, file, title);
                    }
                }
            });

            soundboardGrid.appendChild(padEl);
        }
        updateCentralController();
    }

    function updatePadUIFromData() {
        renderSoundboard();
    }
    renderSoundboard();

    function stopPadAnimation(padId) {
        const padEl = document.querySelector(`.fx-pad[data-pad="${padId}"]`);
        if (padEl) {
            padEl.classList.remove('pad-active');
            padEl.classList.remove('pad-paused');
            padEl.classList.remove('pad-fading');

            const progressBar = padEl.querySelector('.pad-progress-bar');
            if (progressBar) {
                progressBar.style.transition = 'none';
                progressBar.style.width = '0%';
            }
        }

        if (btnCentralFade && padId === currentActivePadId) {
            btnCentralFade.classList.remove('fading');
        }

        if (padActiveTimeouts[padId]) {
            clearTimeout(padActiveTimeouts[padId]);
            delete padActiveTimeouts[padId];
        }

        updateCentralController();
    }

    async function triggerPad(padId, fromStart = false, seekSeconds = null) {
        const data = padData[padId];
        const padEl = document.querySelector(`.fx-pad[data-pad="${padId}"]`);
        if (!data) return;
        currentActivePadId = padId;
        updateCentralController();

        // Nếu chưa có file âm thanh thì mở hộp thoại cấu hình để người dùng nạp file
        if (!data.isCustom || !data.fileName || !engine.soundboardBuffers[padId]) {
            updateCentralController();
            openPadConfigModal(padId);
            return;
        }

        // Nếu bật chế độ ngắt âm (Single Cut): ngắt các âm đang phát trước đó
        if (globalFxSettings.playMode === 'cut') {
            for (const pid in padData) {
                if (pid !== padId) {
                    engine.stopPad(pid);
                    stopPadAnimation(pid);
                }
            }
        }

        // Cập nhật trạng thái UI sang đang phát
        if (padEl) {
            padEl.classList.remove('pad-fading');
            padEl.classList.remove('pad-paused');
            padEl.classList.add('pad-active');
        }

        const progressBar = padEl ? padEl.querySelector('.pad-progress-bar') : null;
        const durLabel = padEl ? padEl.querySelector('.pad-duration') : null;


        const buffer = engine.soundboardBuffers[padId];
        const totalDuration = buffer ? buffer.duration : 1;

        // Phát âm thanh và nhận lại thời lượng còn lại
        const remainingDur = engine.playCustomPad(
            padId,
            data.volume,
            data.isLoop,
            () => {
                stopPadAnimation(padId);
            },
            fromStart,
            seekSeconds
        );

        if (durLabel) {
            durLabel.textContent = formatPadDurationDisplay(totalDuration);
        }

        // Start at the actual audio position; the frame loop follows the audio clock.
        if (progressBar) {
            const startRatio = Math.max(0, Math.min(1, (totalDuration - remainingDur) / totalDuration));
            progressBar.style.transition = 'none';
            progressBar.style.width = `${startRatio * 100}%`;
        }

        if (padActiveTimeouts[padId]) {
            clearTimeout(padActiveTimeouts[padId]);
        }

        updateCentralController();
    }

    function pausePad(padId) {
        const data = padData[padId];
        const padEl = document.querySelector(`.fx-pad[data-pad="${padId}"]`);
        if (!data) return;

        const paused = engine.pauseCustomPad(padId);
        if (!paused) return;

        if (padEl) {
            padEl.classList.remove('pad-active');
            padEl.classList.add('pad-paused');

            const progressBar = padEl.querySelector('.pad-progress-bar');
            if (progressBar) {
                const computedWidth = window.getComputedStyle(progressBar).width;
                progressBar.style.transition = 'none';
                progressBar.style.width = computedWidth;
            }
        }

        if (padActiveTimeouts[padId]) {
            clearTimeout(padActiveTimeouts[padId]);
            delete padActiveTimeouts[padId];
        }

        updateCentralController();
        showToast(`⏸ Đã tạm dừng: ${data.name}`);
    }

    function togglePadLoop(padId) {
        const data = padData[padId];
        if (!data) return;

        data.isLoop = !data.isLoop;
        engine.togglePadLoop(padId, data.isLoop);
        savePadConfig();

        if (data.isLoop) {
            if (padActiveTimeouts[padId]) {
                clearTimeout(padActiveTimeouts[padId]);
                delete padActiveTimeouts[padId];
            }
            showToast(`🔁 Đã BẬT lặp lại: ${data.name}`);
        } else {
            showToast(`➡️ Đã TẮT lặp lại: ${data.name}`);
        }

        updateCentralController();
    }

    function fadePadQuick(padId, seconds = 3.0) {
        const data = padData[padId];
        const padEl = document.querySelector(`.fx-pad[data-pad="${padId}"]`);
        if (!data) return;

        if (!engine.isPadPlaying(padId)) {
            showToast(`⚠️ Âm thanh "${data.name}" chưa phát để giảm âm lượng!`);
            return;
        }

        if (padEl) {
            padEl.classList.add('pad-fading');
            const progressBar = padEl.querySelector('.pad-progress-bar');
            if (progressBar) {
                const currentW = window.getComputedStyle(progressBar).width;
                progressBar.style.transition = 'none';
                progressBar.style.width = currentW;
                void progressBar.offsetWidth;
                progressBar.style.transition = `width ${seconds}s linear`;
                progressBar.style.width = '100%';
            }
        }

        if (btnCentralFade) {
            btnCentralFade.classList.add('fading');
        }

        showToast(`🔉 Đang nhỏ dần âm lượng "${data.name}" trong 3 giây...`);

        engine.fadePad(padId, seconds, () => {
            stopPadAnimation(padId);
        });
        updateCentralController();
    }

    // Preview the chosen position while dragging; start playback on release.
    let padSeekGesture = null;
    function updatePadProgress() {
        requestAnimationFrame(updatePadProgress);
        if (document.hidden || !engine.ctx) return;
        soundboardGrid.querySelectorAll('.fx-pad').forEach(pad => {
            const padId = pad.dataset.pad;
            const state = engine.getPadState(padId);
            const buffer = engine.soundboardBuffers[padId];
            if (!state.isPlaying || !buffer || buffer.duration <= 0 || state.fadeTimeout ||
                (padSeekGesture && padSeekGesture.padId === padId)) return;
            const bar = pad.querySelector('.pad-progress-bar');
            if (!bar) return;
            const elapsed = Math.max(0, engine.ctx.currentTime - state.startTime);
            const position = elapsed % buffer.duration;
            bar.style.transition = 'none';
            bar.style.width = `${position / buffer.duration * 100}%`;
        });
    }
    requestAnimationFrame(updatePadProgress);
    function previewPadSeek(event) {
        if (!padSeekGesture || event.pointerId !== padSeekGesture.pointerId) return;
        const rect = padSeekGesture.track.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
        padSeekGesture.seconds = ratio * padSeekGesture.duration;
        const bar = padSeekGesture.track.querySelector('.pad-progress-bar');
        bar.style.transition = 'none';
        bar.style.width = `${ratio * 100}%`;
        padSeekGesture.track.title = `Phát từ ${formatPadDurationDisplay(padSeekGesture.seconds)} / ${formatPadDurationDisplay(padSeekGesture.duration)}`;
    }
    soundboardGrid.addEventListener('pointerdown', (event) => {
        const track = event.target.closest('.pad-progress-track');
        if (!track || event.button !== 0 || padSeekGesture) return;
        const padId = track.closest('.fx-pad').dataset.pad;
        const buffer = engine.soundboardBuffers[padId];
        if (!buffer) return;
        event.preventDefault();
        padSeekGesture = { track, padId, duration: buffer.duration, pointerId: event.pointerId, seconds: 0 };
        track.setPointerCapture(event.pointerId);
        previewPadSeek(event);
    });
    soundboardGrid.addEventListener('pointermove', previewPadSeek);
    soundboardGrid.addEventListener('pointerup', (event) => {
        if (!padSeekGesture || event.pointerId !== padSeekGesture.pointerId) return;
        previewPadSeek(event);
        const gesture = padSeekGesture;
        padSeekGesture = null;
        gesture.track.releasePointerCapture(event.pointerId);
        triggerPad(gesture.padId, false, gesture.seconds);
    });
    soundboardGrid.addEventListener('pointercancel', () => {
        if (!padSeekGesture) return;
        const { padId } = padSeekGesture;
        padSeekGesture = null;
        if (engine.isPadPlaying(padId)) {
            const state = engine.getPadState(padId);
            const position = (engine.ctx.currentTime - state.startTime) % engine.soundboardBuffers[padId].duration;
            triggerPad(padId, false, position);
        } else {
            stopPadAnimation(padId);
        }
    });

    // Xử lý bấm vào lưới hiệu ứng: phân biệt nút bánh răng cài đặt và chọn/phát ô phím
    soundboardGrid.addEventListener('click', (e) => {
        if (e.target.closest('.pad-progress-track')) return;
        // 1. Nút bánh răng cài đặt
        const gearBtn = e.target.closest('.btn-pad-gear') || e.target.closest('.btn-pad-edit');
        if (gearBtn) {
            e.stopPropagation();
            const padEl = gearBtn.closest('.fx-pad');
            if (padEl) {
                currentActivePadId = padEl.dataset.pad;
                updateCentralController();
                openPadConfigModal(padEl.dataset.pad);
            }
            return;
        }

        // 2. Bấm vào thân ô phím (Pad body)
        const padEl = e.target.closest('.fx-pad');
        if (padEl) {
            const padId = padEl.dataset.pad;
            currentActivePadId = padId;
            if (engine.isPadPaused(padId)) {
                // Đang tạm dừng -> bấm vào thân ô phím sẽ phát tiếp (Resume)
                triggerPad(padId, false);
            } else {
                // Chưa phát hoặc đang phát -> bấm vào thân ô phím sẽ phát từ đầu (Play from start)
                triggerPad(padId, true);
            }
            updateCentralController();
        }
    });

    // SỰ KIỆN NÚT BẢNG ĐIỀU KHIỂN TRUNG TÂM (Ở GIỮA)
    if (btnCentralPlay) {
        btnCentralPlay.addEventListener('click', () => {
            if (!currentActivePadId) {
                const firstWithAudio = Object.keys(padData).find(pid => padData[pid].isCustom && padData[pid].fileName);
                if (firstWithAudio) {
                    currentActivePadId = firstWithAudio;
                } else {
                    showToast('⚠️ Vui lòng chọn một ô phím có âm thanh để phát!');
                    return;
                }
            }

            if (engine.isPadPlaying(currentActivePadId)) {
                pausePad(currentActivePadId);
            } else {
                triggerPad(currentActivePadId, false);
            }
        });
    }

    if (btnCentralLoop) {
        btnCentralLoop.addEventListener('click', () => {
            if (!currentActivePadId) {
                showToast('⚠️ Vui lòng chọn một ô phím trước!');
                return;
            }
            togglePadLoop(currentActivePadId);
        });
    }

    if (btnCentralFade) {
        btnCentralFade.addEventListener('click', () => {
            if (!currentActivePadId) {
                showToast('⚠️ Vui lòng chọn một ô phím đang phát!');
                return;
            }
            fadePadQuick(currentActivePadId, 3.0);
        });
    }


    // Nút Thêm phím mới
    if (btnAddPad) {
        btnAddPad.addEventListener('click', () => {
            const candidateKeys = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', '-', '=', '[', ']', ';', ',', '.', '/'];
            const usedKeys = Object.values(padData).map(d => (d.key || '').toUpperCase());
            const nextKey = candidateKeys.find(k => !usedKeys.includes(k)) || 'F1';

            const existingNumIds = Object.keys(padData).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
            const maxId = existingNumIds.length > 0 ? Math.max(...existingNumIds) : 0;
            const nextId = String(maxId + 1);

            padData[nextId] = {
                name: `Phím ${nextKey}`,
                key: nextKey,
                cat: 'Tùy chọn',
                group: 'group-award',
                duration: '--',
                volume: 1.0,
                isLoop: false,
                isCustom: false,
                fileName: ''
            };

            savePadConfig();
            renderSoundboard();
            openPadConfigModal(nextId);
        });
    }


    // --- CÀI ĐẶT HỆ THỐNG: TÁCH BIỆT "CÀI ĐẶT PHÍM" & "CÀI ĐẶT NHẠC DƯỚI" ---
    const btnGlobalSettings = document.getElementById('btnGlobalSettings');
    const btnOpenPlaylistMgr = document.getElementById('btnOpenPlaylistMgr');
    const globalSettingsModal = document.getElementById('globalSettingsModal');
    const btnGlobalSettingsClose = document.getElementById('btnGlobalSettingsClose');
    const btnGlobalSettingsCancel = document.getElementById('btnGlobalSettingsCancel');
    const btnGlobalSettingsSave = document.getElementById('btnGlobalSettingsSave');

    // 2 Tab riêng biệt
    const modalTabNavPad = document.getElementById('modalTabNavPad');
    const modalTabNavPlaylist = document.getElementById('modalTabNavPlaylist');
    const modalSectionPad = document.getElementById('modalSectionPad');
    const modalSectionPlaylist = document.getElementById('modalSectionPlaylist');

    // Cài đặt phím FX
    const settingFxPlayMode = document.getElementById('settingFxPlayMode');
    const quickFxPlayMode = document.getElementById('quickFxPlayMode');
    if (quickFxPlayMode) {
        quickFxPlayMode.value = globalFxSettings.playMode;
        quickFxPlayMode.addEventListener('change', () => {
            globalFxSettings.playMode = quickFxPlayMode.value;
            if (settingFxPlayMode) settingFxPlayMode.value = globalFxSettings.playMode;
            try {
                localStorage.setItem('event_audio_global_fx_settings', JSON.stringify(globalFxSettings));
            } catch (e) {}
        });
    }
    const btnResetAllFx = document.getElementById('btnResetAllFx');
    const modalPadListTbody = document.getElementById('modalPadListTbody');
    const modalPadCount = document.getElementById('modalPadCount');
    const modalBtnAddNewPad = document.getElementById('modalBtnAddNewPad');

    // Cài đặt kịch bản nhạc dưới
    const modalBulkFileInput = document.getElementById('modalBulkFileInput');
    const modalDefaultScenario = document.getElementById('modalDefaultScenario');
    const modalBtnClearAll = document.getElementById('modalBtnClearAll');
    const modalPlaylistTbody = document.getElementById('modalPlaylistTbody');
    const modalTrackCount = document.getElementById('modalTrackCount');

    let modalTracks = [];

    const soundTypeNames = {
        applause: '👏 Vỗ tay lớn',
        fanfare: '🎺 Nhạc trao giải',
        drumroll: '🥁 Trống dồn vang',
        countdown: '⏳ Đếm ngược 3-2-1',
        tada: '✨ Tada! Chiến thắng',
        buzzer: '❌ Còi báo sai',
        tension: '⚡ Nhạc hồi hộp',
        airhorn: '📢 Còi hơi sôi động',
        whoosh: '💨 Chuyển cảnh gió',
        ding: '🔔 Ting đúng điểm',
        heartbeat: '💓 Tim đập dồn dập',
        impact: '💥 Nổ vang điện ảnh',
        shutter: '📸 Chụp ảnh Flash',
        laugh: '😂 Tiếng cười rộ',
        magic: '🪄 Phép màu lấp lánh',
        lounge: '☕ Giai điệu êm dịu'
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // Chuyển đổi giữa Tab "Cài đặt phím" và Tab "Cài đặt nhạc kịch bản"
    function switchGlobalSettingsTab(tabName) {
        if (tabName === 'pad') {
            if (modalTabNavPad) modalTabNavPad.classList.add('active');
            if (modalTabNavPlaylist) modalTabNavPlaylist.classList.remove('active');
            if (modalSectionPad) modalSectionPad.classList.remove('hidden');
            if (modalSectionPlaylist) modalSectionPlaylist.classList.add('hidden');
            renderModalPadListTable();
        } else {
            if (modalTabNavPlaylist) modalTabNavPlaylist.classList.add('active');
            if (modalTabNavPad) modalTabNavPad.classList.remove('active');
            if (modalSectionPlaylist) modalSectionPlaylist.classList.remove('hidden');
            if (modalSectionPad) modalSectionPad.classList.add('hidden');
            renderModalPlaylistTable();
        }
    }

    if (modalTabNavPad) {
        modalTabNavPad.addEventListener('click', () => switchGlobalSettingsTab('pad'));
    }
    if (modalTabNavPlaylist) {
        modalTabNavPlaylist.addEventListener('click', () => switchGlobalSettingsTab('playlist'));
    }

    // Hiển thị bảng quản lý tất cả các phím trong Tab Cài đặt phím
    function renderModalPadListTable() {
        if (!modalPadListTbody) return;
        modalPadListTbody.innerHTML = '';
        const padKeys = Object.keys(padData);
        if (modalPadCount) modalPadCount.textContent = `${padKeys.length} phím`;

        padKeys.forEach((padId, index) => {
            const data = padData[padId];
            const tr = document.createElement('tr');
            const hasFile = data.isCustom && data.fileName;
            const soundLabel = hasFile
                ? `<span style="color: var(--accent-green); font-weight: 600;" title="${escapeHtml(data.fileName)}">🎵 ${escapeHtml(data.fileName)}</span>`
                : `<span style="color: var(--text-muted); font-size: 11px; font-style: italic;">Chưa nạp file</span>`;

            const durDisplay = hasFile
                ? (data.duration && data.duration !== '--' ? (data.duration.endsWith('s') ? data.duration : `${data.duration}s`) : 'Sẵn sàng')
                : '--';

            tr.innerHTML = `
                <td style="text-align: center; font-weight: 700; color: var(--text-secondary);">${index + 1}</td>
                <td style="text-align: center;">
                    <span class="key-badge" style="display: inline-flex;">${data.key || ''}</span>
                </td>
                <td style="font-weight: 600; color: var(--text-primary);">${escapeHtml(data.name || 'Phím')}</td>
                <td style="font-size: 11px;">${soundLabel}</td>
                <td style="text-align: center; font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);">${durDisplay}</td>
                <td style="text-align: center; font-family: var(--font-mono); font-size: 10px;">${Math.round((data.volume !== undefined ? data.volume : 1) * 100)}%</td>
                <td style="text-align: center; white-space: nowrap;">
                    <button type="button" class="btn-micro btn-modal-pad-edit" title="Cài đặt chi tiết phím này" style="padding: 2px 6px; font-size: 10px; margin-right: 4px;">⚙ Sửa</button>
                    <button type="button" class="btn-table-del btn-modal-pad-del" title="Xóa phím này">🗑</button>
                </td>
            `;

            tr.querySelector('.btn-modal-pad-edit').addEventListener('click', () => {
                openPadConfigModal(padId);
            });

            tr.querySelector('.btn-modal-pad-del').addEventListener('click', () => {
                if (Object.keys(padData).length <= 1) {
                    showToast('⚠️ Cần giữ lại ít nhất 1 ô phím!');
                    return;
                }
                const padKey = data.key || '';
                const padName = data.name || 'Phím';
                const hasCustomSound = !!(data.isCustom && data.fileName);

                stopPadAnimation(padId);
                if (engine && engine.stopPad) engine.stopPad(padId);
                if (engine && engine.soundboardBuffers) delete engine.soundboardBuffers[padId];
                if (window.audioDB) window.audioDB.deletePadAudio(padId);

                if (hasCustomSound) {
                    padData[padId].isCustom = false;
                    padData[padId].fileName = '';
                    padData[padId].name = `Phím ${padKey}`;
                    padData[padId].type = null;
                    padData[padId].duration = '--';
                    padData[padId].volume = 1.0;
                    padData[padId].isLoop = false;
                    showToast(`🗑 Đã xóa bài hát khỏi Phím ${padKey}!`);
                } else {
                    delete padData[padId];
                    showToast(`🗑 Đã xóa ô phím "${padName}" (${padKey})!`);
                }

                savePadConfig();
                renderSoundboard();
                renderModalPadListTable();
            });

            modalPadListTbody.appendChild(tr);
        });
    }

    // Nút Thêm phím mới trực tiếp trong Tab Cài đặt phím
    if (modalBtnAddNewPad) {
        modalBtnAddNewPad.addEventListener('click', () => {
            const candidateKeys = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', '-', '=', '[', ']', ';', ',', '.', '/'];
            const usedKeys = Object.values(padData).map(d => (d.key || '').toUpperCase());
            const nextKey = candidateKeys.find(k => !usedKeys.includes(k)) || 'F1';

            const existingNumIds = Object.keys(padData).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
            const maxId = existingNumIds.length > 0 ? Math.max(...existingNumIds) : 0;
            const nextId = String(maxId + 1);

            padData[nextId] = {
                name: `Phím ${nextKey}`,
                key: nextKey,
                cat: 'Tùy chọn',
                group: 'group-award',
                duration: '--',
                volume: 1.0,
                isLoop: false,
                isCustom: false,
                fileName: ''
            };

            savePadConfig();
            renderSoundboard();
            renderModalPadListTable();
            openPadConfigModal(nextId);
        });
    }

    // Hiển thị bảng bài hát kịch bản trong Tab Cài đặt nhạc
    function renderModalPlaylistTable() {
        if (!modalPlaylistTbody) return;
        modalPlaylistTbody.innerHTML = '';
        if (modalTrackCount) modalTrackCount.textContent = `${modalTracks.length} bài`;

        if (modalTracks.length === 0) {
            modalPlaylistTbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 18px;">
                        Chưa có bài hát nào trong kịch bản. Hãy bấm <strong>"➕ Nhập hàng loạt file"</strong> ở trên để nạp nhạc.
                    </td>
                </tr>
            `;
            return;
        }

        modalTracks.forEach((track, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center; font-weight: 700; color: var(--text-secondary);">${index + 1}</td>
                <td>
                    <input type="text" class="modal-table-input track-title-input" value="${escapeHtml(track.title)}" placeholder="Tên bài hát">
                </td>
                <td style="text-align: center; font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);">
                    ${track.duration || '00:00'}
                </td>
                <td style="text-align: center;">
                    <button type="button" class="btn-table-del" title="Xóa bài này">🗑</button>
                </td>
            `;

            // Cập nhật tên khi gõ trực tiếp
            const titleInput = tr.querySelector('.track-title-input');
            titleInput.addEventListener('input', () => {
                track.title = titleInput.value.trim() || 'Bài hát';
            });

            // Xóa bài này khỏi danh sách tạm
            const delBtn = tr.querySelector('.btn-table-del');
            delBtn.addEventListener('click', () => {
                modalTracks.splice(index, 1);
                renderModalPlaylistTable();
            });

            modalPlaylistTbody.appendChild(tr);
        });
    }

    // Mở hộp thoại cài đặt chung và kích hoạt đúng Tab tương ứng
    function openGlobalSettingsModal(tab = 'pad') {
        modalTracks = playlistTracks.map(t => ({ ...t }));
        renderModalPlaylistTable();
        renderModalPadListTable();

        if (settingFxPlayMode) settingFxPlayMode.value = globalFxSettings.playMode;

        switchGlobalSettingsTab(tab);
        globalSettingsModal.classList.remove('hidden');
    }

    if (btnGlobalSettings && globalSettingsModal) {
        btnGlobalSettings.addEventListener('click', () => {
            openGlobalSettingsModal('pad');
        });
    }

    if (btnOpenPlaylistMgr && globalSettingsModal) {
        btnOpenPlaylistMgr.addEventListener('click', () => {
            openGlobalSettingsModal('playlist');
        });
    }

    // Nhập hàng loạt file nhạc trong modal
    if (modalBulkFileInput) {
        modalBulkFileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            for (let idx = 0; idx < files.length; idx++) {
                const f = files[idx];
                const title = f.name.replace(/\.[^/.]+$/, '');
                const trackId = `track-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`;

                let durText = '00:00';
                try {
                    const tempAudio = new Audio(URL.createObjectURL(f));
                    await new Promise((resolve) => {
                        tempAudio.addEventListener('loadedmetadata', () => {
                            durText = formatTimeMinutes(tempAudio.duration);
                            resolve();
                        });
                        tempAudio.addEventListener('error', resolve);
                        setTimeout(resolve, 300);
                    });
                } catch (err) {}

                modalTracks.push({
                    id: trackId,
                    title: title,
                    fileName: f.name,
                    duration: durText,
                    file: f
                });
            }

            renderModalPlaylistTable();
            modalBulkFileInput.value = '';
        });
    }



    // Xóa tất cả bài hát kịch bản trong modal
    if (modalBtnClearAll) {
        modalBtnClearAll.addEventListener('click', () => {
            if (modalTracks.length === 0) return;
            if (confirm('Bạn có chắc muốn xóa toàn bộ bài hát trong danh sách?')) {
                modalTracks = [];
                renderModalPlaylistTable();
            }
        });
    }


    if (btnGlobalSettingsClose) {
        btnGlobalSettingsClose.addEventListener('click', () => {
            globalSettingsModal.classList.add('hidden');
        });
    }

    if (btnGlobalSettingsCancel) {
        btnGlobalSettingsCancel.addEventListener('click', () => {
            globalSettingsModal.classList.add('hidden');
        });
    }

    // Bấm LƯU: Cập nhật danh sách bài hát chính thức và cài đặt FX
    if (btnGlobalSettingsSave) {
        btnGlobalSettingsSave.addEventListener('click', () => {
            // 1. Áp dụng danh sách bài hát mới
            playlistTracks = modalTracks.map(t => ({ ...t }));
            if (window.audioDB) {
                window.audioDB.clearAllTracks().then(() => {
                    window.audioDB.saveAllTracks(playlistTracks);
                });
            }
            renderPlaylist();

            // 2. Lưu cài đặt FX
            if (settingFxPlayMode) globalFxSettings.playMode = settingFxPlayMode.value;
            if (quickFxPlayMode) quickFxPlayMode.value = globalFxSettings.playMode;
            try {
                localStorage.setItem('event_audio_global_fx_settings', JSON.stringify(globalFxSettings));
            } catch (e) {}

            globalSettingsModal.classList.add('hidden');
        });
    }


    // =========================================================
    // 5. TRÌNH PHÁT NHẠC NỀN KỊCH BẢN SỰ KIỆN (PLAYLIST PLAYER)
    // =========================================================
    const bgDeck = engine.decks.A; // Sử dụng Deck A làm backend âm thanh chất lượng cao
    let currentPlayingTrackId = null;

    function formatTimeMinutes(sec) {
        if (!sec || isNaN(sec)) return '00:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    // Cập nhật tiến trình phát bài hát nền
    bgDeck.audio.addEventListener('timeupdate', () => {
        const cur = bgDeck.audio.currentTime || 0;
        const dur = bgDeck.audio.duration || 0;
        if (playlistCurrentTime) playlistCurrentTime.textContent = formatTimeMinutes(cur);
        if (playlistDurationTime) playlistDurationTime.textContent = formatTimeMinutes(dur);
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        if (playlistProgressFill) playlistProgressFill.style.width = `${pct}%`;
    });

    bgDeck.audio.addEventListener('play', () => {
        if (playlistPlayIcon) playlistPlayIcon.textContent = '⏸';
        if (playlistPlayText) playlistPlayText.textContent = 'TẠM DỪNG';
        if (playlistTrackIcon) playlistTrackIcon.textContent = '🎶';
        if (playerTrackStatus && currentPlayingTrackId) {
            const trk = playlistTracks.find(t => t.id === currentPlayingTrackId);
            playerTrackStatus.textContent = `Đang phát (${trk ? trk.catName : 'Kịch bản'})`;
            playerTrackStatus.style.color = 'var(--accent-green)';
        }
        updatePlaylistPlayingUI();
    });

    bgDeck.audio.addEventListener('pause', () => {
        if (playlistPlayIcon) playlistPlayIcon.textContent = '▶';
        if (playlistPlayText) playlistPlayText.textContent = 'PHÁT';
        if (playlistTrackIcon) playlistTrackIcon.textContent = '🎵';
        if (playerTrackStatus) {
            playerTrackStatus.textContent = 'Đã tạm dừng';
            playerTrackStatus.style.color = 'var(--accent-gold)';
        }
        updatePlaylistPlayingUI();
    });

    bgDeck.audio.addEventListener('ended', () => {
        if (playlistPlayIcon) playlistPlayIcon.textContent = '▶';
        if (playlistPlayText) playlistPlayText.textContent = 'PHÁT';
        if (playerTrackStatus) {
            playerTrackStatus.textContent = 'Đã phát hết bài';
            playerTrackStatus.style.color = 'var(--text-muted)';
        }
        playNextTrackInPlaylist();
    });

    async function playTrackById(trackId) {
        const track = playlistTracks.find(t => t.id === trackId);
        if (!track) return;

        if (currentPlayingTrackId === trackId && bgDeck.isPlaying) {
            engine.pauseDeck('A');
            return;
        }

        if (currentPlayingTrackId === trackId && !bgDeck.isPlaying && bgDeck.audio.src) {
            await engine.playDeck('A');
            return;
        }

        currentPlayingTrackId = trackId;
        if (playerTrackTitle) playerTrackTitle.textContent = track.title;
        if (playerTrackStatus) {
            playerTrackStatus.textContent = 'Đang phát trực tiếp...';
            playerTrackStatus.style.color = 'var(--accent-green)';
        }

        if (track.file) {
            engine.loadTrack('A', track.file, track.title);
            await engine.playDeck('A');
        }
        updatePlaylistPlayingUI();
    }

    function updatePlaylistPlayingUI() {
        if (!playlistContainer) return;
        const allCards = playlistContainer.querySelectorAll('.track-card-uploaded');
        allCards.forEach(card => {
            const tid = card.dataset.trackId;
            const playBtn = card.querySelector('.btn-card-play');
            if (tid === currentPlayingTrackId) {
                card.classList.add('playing-item');
                if (playBtn) {
                    playBtn.classList.toggle('playing', bgDeck.isPlaying);
                    playBtn.innerHTML = bgDeck.isPlaying ? '⏸ Tạm dừng' : '▶ Tiếp tục';
                }
            } else {
                card.classList.remove('playing-item');
                if (playBtn) {
                    playBtn.classList.remove('playing');
                    playBtn.innerHTML = '▶ Phát';
                }
            }
        });
    }

    function playNextTrackInPlaylist() {
        if (playlistTracks.length === 0) return;
        const currentIdx = playlistTracks.findIndex(t => t.id === currentPlayingTrackId);
        const nextIdx = (currentIdx + 1) % playlistTracks.length;
        playTrackById(playlistTracks[nextIdx].id);
    }

    function playPrevTrackInPlaylist() {
        if (playlistTracks.length === 0) return;
        const currentIdx = playlistTracks.findIndex(t => t.id === currentPlayingTrackId);
        const prevIdx = currentIdx <= 0 ? playlistTracks.length - 1 : currentIdx - 1;
        playTrackById(playlistTracks[prevIdx].id);
    }

    if (btnPlaylistPlayPause) {
        btnPlaylistPlayPause.addEventListener('click', async () => {
            if (!currentPlayingTrackId && playlistTracks.length > 0) {
                playTrackById(playlistTracks[0].id);
                return;
            }
            if (bgDeck.isPlaying) {
                engine.pauseDeck('A');
            } else if (bgDeck.audio.src) {
                await engine.playDeck('A');
            } else if (playlistTracks.length > 0) {
                playTrackById(playlistTracks[0].id);
            }
        });
    }

    if (btnPlaylistStop) {
        btnPlaylistStop.addEventListener('click', () => {
            engine.stopDeck('A');
            if (playlistProgressFill) playlistProgressFill.style.width = '0%';
            if (playlistCurrentTime) playlistCurrentTime.textContent = '00:00';
            if (playerTrackStatus) playerTrackStatus.textContent = 'Đã dừng hẳn';
            updatePlaylistPlayingUI();
        });
    }

    if (btnPlaylistNext) {
        btnPlaylistNext.addEventListener('click', () => {
            playNextTrackInPlaylist();
        });
    }

    if (btnPlaylistPrev) {
        btnPlaylistPrev.addEventListener('click', () => {
            playPrevTrackInPlaylist();
        });
    }

    if (btnPlaylistLoop) {
        btnPlaylistLoop.addEventListener('click', () => {
            const isLoop = engine.toggleDeckLoop('A');
            btnPlaylistLoop.classList.toggle('active', isLoop);
            btnPlaylistLoop.textContent = isLoop ? '🔁 ĐANG LẶP' : '🔁 LẶP';
        });
    }

    if (playlistProgressContainer) {
        playlistProgressContainer.addEventListener('click', (e) => {
            const rect = playlistProgressContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, clickX / rect.width));
            engine.seekDeck('A', ratio);
        });
    }

    // Các nút hạ nhạc êm trên Player bar
    document.querySelectorAll('.btn-fade-mini').forEach(btn => {
        btn.addEventListener('click', () => {
            const seconds = parseInt(btn.dataset.time, 10) || 2;
            engine.fadeStopDeck('A', seconds);
            if (playerTrackStatus) {
                playerTrackStatus.textContent = `Đang hạ nhạc êm (${seconds}s)...`;
                playerTrackStatus.style.color = 'var(--accent-gold)';
            }
        });
    });

    // Master Volume trên đỉnh (Header)
    if (masterVolumeSlider) {
        masterVolumeSlider.addEventListener('input', () => {
            const val = parseFloat(masterVolumeSlider.value);
            engine.setMasterVolume(val);
            if (masterVolVal) masterVolVal.textContent = `${Math.round((val / 1.2) * 100)}%`;
        });
    }

    // =========================================================
    // 7. DỪNG KHẨN CẤP (PANIC STOP)
    // =========================================================


    function triggerPanicStop() {
        engine.panicStop();
        if (duckingBadge) {
            duckingBadge.classList.remove('active');
            duckingBadge.textContent = 'NHẠC CHUẨN';
        }

        for (const padId in padData) {
            stopPadAnimation(padId);
        }

        if (playerTrackStatus) {
            playerTrackStatus.textContent = 'Đã ngắt toàn bộ âm thanh khẩn cấp';
            playerTrackStatus.style.color = 'var(--accent-red)';
        }
        if (playlistPlayIcon) playlistPlayIcon.textContent = '▶';
        if (playlistPlayText) playlistPlayText.textContent = 'PHÁT';
        updatePlaylistPlayingUI();

        document.body.style.boxShadow = 'inset 0 0 80px rgba(239, 68, 68, 0.7)';
        setTimeout(() => {
            document.body.style.boxShadow = '';
        }, 300);
    }

    // =========================================================
    // 8. LẮNG NGHE PHÍM TẮT TRÊN BÀN PHÍM
    // =========================================================
    window.addEventListener('keydown', (e) => {
        // Thanh trượt vẫn nhận phím phát nhạc; ô nhập liệu giữ phím để gõ.
        const target = e.target;
        if ((target.tagName === 'INPUT' && target.type !== 'range') ||
            target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return;
        }

        const key = e.key.toUpperCase();

        // 1. Phím ESC = Dừng khẩn cấp
        if (e.key === 'Escape') {
            e.preventDefault();
            triggerPanicStop();
            return;
        }

        // 3. Shift + Space = Bật / Tạm dừng phát nhạc nền kịch bản
        if (e.shiftKey && e.code === 'Space') {
            e.preventDefault();
            if (e.repeat) return;
            if (bgDeck.isPlaying) {
                engine.pauseDeck('A');
            } else if (bgDeck.audio.src) {
                engine.playDeck('A');
            } else if (playlistTracks.length > 0) {
                playTrackById(playlistTracks[0].id);
            }
            return;
        }

        // 5. Bấm các ô Soundboard theo Hotkey
        for (const padId in padData) {
            if (padData[padId].key && padData[padId].key.toUpperCase() === key) {
                e.preventDefault();
                if (e.repeat) return;
                triggerPad(padId, !engine.isPadPaused(padId));
                return;
            }
        }
    });


    // =========================================================
    // 9. DANH SÁCH TẤT CẢ FILE NHẠC ĐÃ TẢI LÊN
    // =========================================================
    function renderPlaylist() {
        if (!playlistContainer) return;
        playlistContainer.innerHTML = '';
        if (musicCountBadge) musicCountBadge.textContent = `${playlistTracks.length} bài`;

        if (playlistTracks.length === 0) {
            playlistContainer.innerHTML = `
                <div class="upload-dropzone-empty">
                    <span class="dropzone-icon">📥</span>
                    <div class="dropzone-text">
                        <strong>Chưa có bài hát nào được tải lên</strong>
                        <span>Bấm nút <strong>"➕ TẢI LÊN FILE NHẠC TỪ MÁY TÍNH"</strong> ở trên để nạp ngay các bài nhạc MP3/WAV của bạn.</span>
                    </div>
                </div>
            `;
            return;
        }

        playlistTracks.forEach((track, index) => {
            const card = document.createElement('div');
            card.className = 'track-card-uploaded';
            card.dataset.trackId = track.id;
            card.setAttribute('draggable', 'true');
            card.title = `👉 Kéo bài "${track.title}" thả lên bất kỳ ô phím nào ở trên để gán phím tắt!`;

            if (track.id === currentPlayingTrackId) {
                card.classList.add('playing-item');
            }

            const isThisPlaying = track.id === currentPlayingTrackId && bgDeck.isPlaying;

            card.innerHTML = `
                <span class="drag-handle-hint" title="Bấm giữ và kéo thả vào phím ở trên">⋮⋮</span>
                <span class="track-index-num">${index + 1}</span>
                <div class="track-details-col">
                    <span class="track-filename-title" title="${escapeHtml(track.title)}">🎵 ${escapeHtml(track.title)}</span>
                    <span class="track-duration-label">${track.duration || '00:00'}</span>
                </div>
                <div class="track-btns-cluster">
                    <button type="button" class="btn-card-play ${isThisPlaying ? 'playing' : ''}" title="Bấm để phát hoặc tạm dừng bài này">
                        ${isThisPlaying ? '⏸ Tạm dừng' : '▶ Phát'}
                    </button>
                    <button type="button" class="btn-card-del" title="Xóa file này">🗑</button>
                </div>
            `;

            // KÍCH HOẠT KÉO THẢ TỪ THẺ BÀI HÁT
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', track.id);
                e.dataTransfer.effectAllowed = 'copy';
                card.classList.add('dragging-card');
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging-card');
                document.querySelectorAll('.fx-pad').forEach(p => p.classList.remove('pad-drop-target'));
            });

            const playBtn = card.querySelector('.btn-card-play');
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                playTrackById(track.id);
            });

            card.addEventListener('click', () => {
                playTrackById(track.id);
            });

            card.querySelector('.btn-card-del').addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentPlayingTrackId === track.id) {
                    engine.stopDeck('A');
                    currentPlayingTrackId = null;
                    if (playerTrackTitle) playerTrackTitle.textContent = 'Chưa phát bài hát nào';
                    if (playerTrackStatus) playerTrackStatus.textContent = 'Bấm ▶ Phát trực tiếp bài hát bên dưới';
                    if (playlistProgressFill) playlistProgressFill.style.width = '0%';
                    if (playlistCurrentTime) playlistCurrentTime.textContent = '00:00';
                }
                playlistTracks = playlistTracks.filter(t => t.id !== track.id);
                if (window.audioDB) {
                    window.audioDB.deleteTrack(track.id);
                }
                renderPlaylist();
            });

            playlistContainer.appendChild(card);
        });
    }

    // Hàm nạp danh sách file vào kịch bản/danh sách nhạc
    async function addAudioFilesToPlaylist(files) {
        if (!files || files.length === 0) return;

        for (let idx = 0; idx < files.length; idx++) {
            const f = files[idx];
            const title = f.name.replace(/\.[^/.]+$/, '');
            const trackId = `track-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`;

            let durText = '00:00';
            try {
                const tempAudio = new Audio(URL.createObjectURL(f));
                await new Promise((resolve) => {
                    tempAudio.addEventListener('loadedmetadata', () => {
                        durText = formatTimeMinutes(tempAudio.duration);
                        resolve();
                    });
                    tempAudio.addEventListener('error', resolve);
                    setTimeout(resolve, 400);
                });
            } catch (err) {}

            const trackObj = {
                id: trackId,
                title: title,
                fileName: f.name,
                duration: durText,
                file: f,
                dateAdded: Date.now() + idx
            };
            playlistTracks.push(trackObj);

            // Lưu trực tiếp vào IndexedDB để không bị mất khi F5 hoặc mất mạng
            if (window.audioDB) {
                await window.audioDB.saveTrack(trackObj);
            }
        }

        renderPlaylist();
        showToast(`🎵 Đã thêm ${files.length} bài vào danh sách!`);
    }

    if (playlistFileInput) {
        playlistFileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            await addAudioFilesToPlaylist(files);
            playlistFileInput.value = '';
        });
    }

    // Cho phép kéo thả file từ máy tính thẳng vào khu vực danh sách nhạc
    if (playlistContainer) {
        playlistContainer.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                playlistContainer.classList.add('container-drag-hover');
            }
        });
        playlistContainer.addEventListener('dragleave', (e) => {
            if (!playlistContainer.contains(e.relatedTarget)) {
                playlistContainer.classList.remove('container-drag-hover');
            }
        });
        playlistContainer.addEventListener('drop', async (e) => {
            playlistContainer.classList.remove('container-drag-hover');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                const audioFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i));
                if (audioFiles.length > 0) {
                    await addAudioFilesToPlaylist(audioFiles);
                }
            }
        });
    }

    if (btnClearAllTracks) {
        btnClearAllTracks.addEventListener('click', async () => {
            if (playlistTracks.length === 0) return;
            if (confirm('Bạn có chắc muốn xóa tất cả các bài hát đã tải lên?')) {
                engine.stopDeck('A');
                currentPlayingTrackId = null;
                if (playerTrackTitle) playerTrackTitle.textContent = 'Chưa phát bài hát nào';
                if (playerTrackStatus) playerTrackStatus.textContent = 'Bấm ▶ Phát trực tiếp bài hát bên dưới';
                if (playlistProgressFill) playlistProgressFill.style.width = '0%';
                if (playlistCurrentTime) playlistCurrentTime.textContent = '00:00';
                playlistTracks = [];
                if (window.audioDB) {
                    await window.audioDB.clearAllTracks();
                }
                renderPlaylist();
                showToast('🗑 Đã xóa toàn bộ danh sách bài hát!');
            }
        });
    }

    renderPlaylist();

    // =========================================================
    // KHÔI PHỤC DỮ LIỆU ÂM THANH ĐÃ LƯU TRỮ (OFFLINE / F5 RELOAD)
    // =========================================================
    async function restorePersistedAudioData() {
        if (!window.audioDB) return;
        try {
            // 1. Khôi phục toàn bộ bài hát kịch bản từ IndexedDB
            const savedTracks = await window.audioDB.getAllTracks();
            if (savedTracks && savedTracks.length > 0) {
                playlistTracks = savedTracks;
                renderPlaylist();
                console.log(`✅ [IndexedDB] Đã khôi phục ${savedTracks.length} bài hát kịch bản.`);
            }

            // 2. Khôi phục toàn bộ file âm thanh các ô phím hiệu ứng từ IndexedDB
            const savedPadAudios = await window.audioDB.getAllPadAudios();
            if (savedPadAudios && savedPadAudios.length > 0) {
                let restoredPadCount = 0;
                for (const item of savedPadAudios) {
                    const padId = String(item.padId);
                    if (item.blob && padData[padId]) {
                        const ok = await engine.loadCustomPadAudio(padId, item.blob);
                        if (ok) {
                            padData[padId].isCustom = true;
                            padData[padId].fileName = item.fileName || padData[padId].fileName;
                            if (item.title) padData[padId].name = item.title;
                            if (item.duration && item.duration !== '--') {
                                padData[padId].duration = item.duration;
                            } else if (engine.soundboardBuffers[padId]) {
                                padData[padId].duration = formatPadDurationDisplay(engine.soundboardBuffers[padId].duration);
                            }
                            restoredPadCount++;
                        }
                    }
                }
                if (restoredPadCount > 0) {
                    renderSoundboard();
                    renderModalPadListTable();
                    updateCentralController();
                    console.log(`✅ [IndexedDB] Đã nạp lại âm thanh cho ${restoredPadCount} phím hiệu ứng.`);
                }
            }

            if ((savedTracks && savedTracks.length > 0) || (savedPadAudios && savedPadAudios.length > 0)) {
                showToast('⚡ Đã nạp lại đầy đủ kho nhạc đã lưu sẵn sàng hoạt động!');
            }
        } catch (err) {
            console.warn('Lỗi nạp dữ liệu âm thanh lưu trữ:', err);
        }
    }

    // Tự động khôi phục ngay khi mở app
    restorePersistedAudioData();

    // =========================================================
    // 10. HỘP THOẠI CẤU HÌNH Ô HIỆU ỨNG (PAD CONFIG)
    // =========================================================
    function openPadConfigModal(padId) {
        currentEditingPadId = padId;
        const data = padData[padId];
        if (!data) return;

        modalPadTitle.textContent = `Cấu hình Ô hiệu ứng #${padId}`;
        modalPadName.value = data.name;
        modalPadKey.value = data.key;
        if (modalPadType) modalPadType.value = data.type || 'ding';
        modalPadFileInput.value = '';

        if (data.isCustom && data.fileName) {
            modalCustomStatus.textContent = `✅ Đang dùng file: ${data.fileName}`;
            modalCustomStatus.style.color = 'var(--accent-green)';
        } else {
            modalCustomStatus.textContent = 'ℹ️ Chưa nạp file âm thanh. Hãy chọn file từ máy tính của bạn.';
            modalCustomStatus.style.color = 'var(--text-muted)';
        }

        padConfigModal.classList.remove('hidden');
    }

    modalPadFileInput.addEventListener('change', () => {
        if (modalPadFileInput.files && modalPadFileInput.files[0]) {
            const file = modalPadFileInput.files[0];
            modalCustomStatus.textContent = `✅ Đã chọn file: ${file.name}`;
            modalCustomStatus.style.color = 'var(--accent-green)';
            if (!modalPadName.value.trim() || modalPadName.value.startsWith('Hiệu ứng')) {
                modalPadName.value = file.name.replace(/\.[^/.]+$/, '');
            }
        }
    });

    btnModalClose.addEventListener('click', () => {
        padConfigModal.classList.add('hidden');
    });

    btnModalSave.addEventListener('click', async () => {
        if (!currentEditingPadId) return;
        const data = padData[currentEditingPadId];
        data.name = modalPadName.value.trim() || data.name;
        data.key = modalPadKey.value.trim().toUpperCase() || data.key;
        if (!data.isCustom || !data.fileName) {
            data.duration = '--';
            data.type = null;
        }

        if (modalPadFileInput.files && modalPadFileInput.files[0]) {
            const file = modalPadFileInput.files[0];
            const success = await engine.loadCustomPadAudio(currentEditingPadId, file);
            if (success) {
                data.isCustom = true;
                data.fileName = file.name;
                if (window.audioDB) {
                    await window.audioDB.savePadAudio(currentEditingPadId, file, {
                        fileName: data.fileName,
                        title: data.name,
                        duration: data.duration
                    });
                }
                try {
                    const tempAudio = new Audio(URL.createObjectURL(file));
                    tempAudio.addEventListener('loadedmetadata', async () => {
                        data.duration = tempAudio.duration.toFixed(1);
                        if (window.audioDB) {
                            await window.audioDB.savePadAudio(currentEditingPadId, file, {
                                fileName: data.fileName,
                                title: data.name,
                                duration: data.duration
                            });
                        }
                        savePadConfig();
                        renderSoundboard();
                        renderModalPadListTable();
                    });
                } catch (e) {}
            }
        }

        renderSoundboard();
        savePadConfig();
        renderModalPadListTable();
        padConfigModal.classList.add('hidden');
    });

    if (btnModalDeletePad) {
        btnModalDeletePad.addEventListener('click', () => {
            if (!currentEditingPadId || !padData[currentEditingPadId]) {
                padConfigModal.classList.add('hidden');
                return;
            }

            const targetId = currentEditingPadId;
            const data = padData[targetId];
            const padKey = data.key || '';
            const padName = data.name || 'Phím';
            const hasCustomSound = !!(data.isCustom && data.fileName);

            stopPadAnimation(targetId);
            if (engine && engine.stopPad) engine.stopPad(targetId);
            if (engine && engine.soundboardBuffers) delete engine.soundboardBuffers[targetId];
            if (window.audioDB) window.audioDB.deletePadAudio(targetId);

            // Nếu phím đang nạp bài hát: xóa bài hát và khôi phục ô phím về mặc định ban đầu
            if (hasCustomSound) {
                data.isCustom = false;
                data.fileName = '';
                data.name = `Phím ${padKey}`;
                data.type = null;
                data.duration = '--';
                data.volume = 1.0;
                data.isLoop = false;
                showToast(`🗑 Đã xóa bài hát, đặt lại Phím ${padKey}!`);
            } else {
                // Nếu phím đã rỗng hoặc là phím phụ: xóa hoàn toàn ô này khỏi bàn phím
                if (Object.keys(padData).length <= 1) {
                    showToast('⚠️ Cần giữ lại ít nhất 1 ô phím hiệu ứng!');
                    return;
                }
                delete padData[targetId];
                showToast(`🗑 Đã xóa ô phím "${padName}" (${padKey})!`);
            }

            savePadConfig();
            renderSoundboard();
            renderModalPadListTable();
            padConfigModal.classList.add('hidden');
        });
    }

    if (btnModalReset) {
        btnModalReset.addEventListener('click', () => {
            if (!currentEditingPadId || !padData[currentEditingPadId]) {
                padConfigModal.classList.add('hidden');
                return;
            }
            const data = padData[currentEditingPadId];
            data.isCustom = false;
            data.isLoop = false;
            data.fileName = '';
            data.type = null;
            data.duration = '--';
            data.volume = 1.0;
            data.name = `Phím ${data.key || ''}`;
            if (engine && engine.soundboardBuffers) delete engine.soundboardBuffers[currentEditingPadId];
            if (window.audioDB) window.audioDB.deletePadAudio(currentEditingPadId);
            renderSoundboard();
            savePadConfig();
            renderModalPadListTable();
            padConfigModal.classList.add('hidden');
            showToast(`🗑 Đã gỡ bỏ file âm thanh của Phím ${data.key}!`);
        });
    }

    function savePadConfig() {
        try {
            const toSave = {};
            for (const k in padData) {
                toSave[k] = {
                    name: padData[k].name,
                    key: padData[k].key,
                    cat: padData[k].cat || 'Sự kiện',
                    group: padData[k].group || 'group-award',
                    duration: (padData[k].isCustom && padData[k].fileName) ? padData[k].duration : '--',
                    volume: padData[k].volume !== undefined ? padData[k].volume : 1.0,
                    isLoop: !!padData[k].isLoop,
                    isCustom: !!(padData[k].isCustom && padData[k].fileName),
                    fileName: padData[k].fileName || ''
                };
            }
            localStorage.setItem('event_audio_pad_config', JSON.stringify(toSave));
        } catch (e) {
            console.warn('Lỗi lưu LocalStorage', e);
        }
    }

    // =========================================================
    // 11. HỘP THOẠI PHÍM TẮT & TOÀN MÀN HÌNH
    // =========================================================
    btnHotkeyHelp.addEventListener('click', () => {
        hotkeyHelpModal.classList.remove('hidden');
    });

    btnHelpModalClose.addEventListener('click', () => {
        hotkeyHelpModal.classList.add('hidden');
    });

    btnHelpModalOk.addEventListener('click', () => {
        hotkeyHelpModal.classList.add('hidden');
    });

    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.warn('Không thể mở toàn màn hình:', err);
                });
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === padConfigModal) padConfigModal.classList.add('hidden');
        if (e.target === hotkeyHelpModal) hotkeyHelpModal.classList.add('hidden');
    });

    // =========================================================
    // KÉO CHIA ĐÔI (RESIZE SPLIT PANEL)
    // =========================================================
    (function initResizeSplit() {
        const handle = document.getElementById('resizeHandle');
        if (!handle) return;

        const splitContainer = handle.parentElement;
        const topPanel    = splitContainer.querySelector('.workstation-main');
        const bottomPanel = splitContainer.querySelector('.uploaded-music-area');
        if (!topPanel || !bottomPanel) return;

        // Đặt chiều cao mặc định: top 65%, bottom 35%
        function applyHeights(topH, botH) {
            topPanel.style.height    = topH + 'px';
            topPanel.style.flex      = 'none';
            bottomPanel.style.height = botH + 'px';
            bottomPanel.style.flex   = 'none';
        }

        function initDefaultHeights() {
            const total = splitContainer.clientHeight - handle.offsetHeight;
            const savedRatio = parseFloat(localStorage.getItem('splitRatio') || '0.65');
            const ratio = Math.min(0.9, Math.max(0.1, savedRatio));
            applyHeights(Math.round(total * ratio), Math.round(total * (1 - ratio)));
        }

        initDefaultHeights();
        window.addEventListener('resize', initDefaultHeights);

        let isDragging = false;
        let startY = 0;
        let startTopH = 0;
        let startBotH = 0;

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = true;
            startY    = e.clientY;
            startTopH = topPanel.offsetHeight;
            startBotH = bottomPanel.offsetHeight;
            handle.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dy = e.clientY - startY;
            const minH = 60;
            const total = startTopH + startBotH;
            let newTop = startTopH + dy;
            newTop = Math.max(minH, Math.min(total - minH, newTop));
            const newBot = total - newTop;
            applyHeights(newTop, newBot);
            localStorage.setItem('splitRatio', (newTop / total).toFixed(4));
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            handle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });

        // Hỗ trợ cảm ứng (Touch)
        handle.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            isDragging = true;
            startY    = t.clientY;
            startTopH = topPanel.offsetHeight;
            startBotH = bottomPanel.offsetHeight;
            handle.classList.add('dragging');
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const t = e.touches[0];
            const dy = t.clientY - startY;
            const minH = 60;
            const total = startTopH + startBotH;
            let newTop = startTopH + dy;
            newTop = Math.max(minH, Math.min(total - minH, newTop));
            const newBot = total - newTop;
            applyHeights(newTop, newBot);
        }, { passive: true });

        document.addEventListener('touchend', () => {
            isDragging = false;
            handle.classList.remove('dragging');
        });
    })();
});

