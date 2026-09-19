/**
 * Event Audio Master Pro - Core Audio Engine
 * High-performance Web Audio API Engine for Event DJs, Soundmen & MCs
 */

class EventAudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.duckingGain = null;
        this.analyser = null;
        this.eq = {
            low: null,
            mid: null,
            high: null
        };

        // Decks
        this.decks = {
            A: {
                audio: new Audio(),
                source: null,
                gain: null,
                fadeInterval: null,
                name: 'Chưa nạp bài hát',
                duration: 0,
                isPlaying: false,
                isLooping: false,
                volume: 0.8
            },
            B: {
                audio: new Audio(),
                source: null,
                gain: null,
                fadeInterval: null,
                name: 'Chưa nạp bài hát',
                duration: 0,
                isPlaying: false,
                isLooping: false,
                volume: 0.8
            }
        };

        // Crossfader: 0 = Deck A 100%, 1 = Deck B 100%, 0.5 = cả hai 100%
        this.crossfadeValue = 0.5;

        // Ducking state
        this.isDucking = false;
        this.duckLevel = 0.25; // Giảm xuống 25% khi kích hoạt sound effect
        this.activePadsCount = 0;

        // Soundboard audio buffers cache
        this.soundboardBuffers = {};
        this.activePadSources = {}; // map padId -> array of active AudioBufferSourceNode
        this.padStates = {}; // map padId -> full pad playback state controller
        
        // Microphone pass-through (optional feature)
        this.micStream = null;
        this.micSource = null;
        this.micGain = null;

        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        // Master Chain: Decks -> Ducking Gain -> EQ -> Master Gain -> Analyser -> Destination
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.9, this.ctx.currentTime);

        this.duckingGain = this.ctx.createGain();
        this.duckingGain.gain.setValueAtTime(1.0, this.ctx.currentTime);

        // 3-Band EQ
        this.eq.low = this.ctx.createBiquadFilter();
        this.eq.low.type = 'lowshelf';
        this.eq.low.frequency.setValueAtTime(250, this.ctx.currentTime);
        this.eq.low.gain.setValueAtTime(0, this.ctx.currentTime);

        this.eq.mid = this.ctx.createBiquadFilter();
        this.eq.mid.type = 'peaking';
        this.eq.mid.frequency.setValueAtTime(1500, this.ctx.currentTime);
        this.eq.mid.Q.setValueAtTime(1, this.ctx.currentTime);
        this.eq.mid.gain.setValueAtTime(0, this.ctx.currentTime);

        this.eq.high = this.ctx.createBiquadFilter();
        this.eq.high.type = 'highshelf';
        this.eq.high.frequency.setValueAtTime(4000, this.ctx.currentTime);
        this.eq.high.gain.setValueAtTime(0, this.ctx.currentTime);

        // Visualizer Analyser
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;

        // Routing: duckingGain -> eq.low -> eq.mid -> eq.high -> masterGain -> analyser -> destination
        this.duckingGain.connect(this.eq.low);
        this.eq.low.connect(this.eq.mid);
        this.eq.mid.connect(this.eq.high);
        this.eq.high.connect(this.masterGain);
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        // Setup Decks
        this._setupDeck('A');
        this._setupDeck('B');

        this.initialized = true;
    }

    _setupDeck(deckId) {
        const deck = this.decks[deckId];
        deck.gain = this.ctx.createGain();
        deck.gain.gain.setValueAtTime(deck.volume, this.ctx.currentTime);

        // Deck routes into duckingGain
        deck.gain.connect(this.duckingGain);

        deck.audio.crossOrigin = 'anonymous';
        deck.audio.preload = 'auto';

        // Tạo MediaElementSource khi đã tương tác
        deck.audio.addEventListener('play', () => {
            if (!deck.source) {
                try {
                    deck.source = this.ctx.createMediaElementSource(deck.audio);
                    deck.source.connect(deck.gain);
                } catch (e) {
                    console.warn(`Deck ${deckId} source already connected`, e);
                }
            }
            deck.isPlaying = true;
        });

        deck.audio.addEventListener('pause', () => {
            deck.isPlaying = false;
        });

        deck.audio.addEventListener('ended', () => {
            deck.isPlaying = false;
        });

        deck.audio.addEventListener('loadedmetadata', () => {
            deck.duration = deck.audio.duration;
        });
    }

    async ensureContext() {
        if (!this.initialized) {
            this.init();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    // Set Master Volume (0 - 1)
    setMasterVolume(val) {
        if (!this.masterGain) return;
        const v = Math.max(0, Math.min(1.2, val));
        this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }

    // Set EQ Gains (-12dB to +12dB)
    setEQ(band, db) {
        if (!this.eq[band]) return;
        const v = Math.max(-15, Math.min(15, db));
        this.eq[band].gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }

    // Crossfader: 0 (Deck A 100%, B 0%) -> 0.5 (A 100%, B 100%) -> 1 (A 0%, B 100%)
    setCrossfade(val) {
        this.crossfadeValue = val;
        this._updateDeckGains();
    }

    setDeckVolume(deckId, vol) {
        if (!this.decks[deckId]) return;
        this.decks[deckId].volume = Math.max(0, Math.min(1, vol));
        this._updateDeckGains();
    }

    _updateDeckGains() {
        if (!this.ctx) return;
        const x = this.crossfadeValue;
        const gainA = x <= 0.5 ? 1 : 1 - (x - 0.5) * 2;
        const gainB = x >= 0.5 ? 1 : x * 2;

        const actualGainA = gainA * this.decks.A.volume;
        const actualGainB = gainB * this.decks.B.volume;

        this.decks.A.gain.gain.setTargetAtTime(actualGainA, this.ctx.currentTime, 0.05);
        this.decks.B.gain.gain.setTargetAtTime(actualGainB, this.ctx.currentTime, 0.05);
    }

    // Load track into Deck
    loadTrack(deckId, fileOrUrl, trackName) {
        this.ensureContext();
        const deck = this.decks[deckId];
        if (!deck) return;

        if (deck.isPlaying) {
            deck.audio.pause();
        }

        if (typeof fileOrUrl === 'string') {
            deck.audio.src = fileOrUrl;
        } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
            deck.audio.src = URL.createObjectURL(fileOrUrl);
        }

        deck.name = trackName || (fileOrUrl.name ? fileOrUrl.name.replace(/\.[^/.]+$/, '') : 'Bài hát');
        deck.audio.load();
    }

    // Play Deck
    async playDeck(deckId) {
        await this.ensureContext();
        const deck = this.decks[deckId];
        if (!deck || !deck.audio.src) return false;

        if (deck.fadeInterval) {
            clearInterval(deck.fadeInterval);
            deck.fadeInterval = null;
            this._updateDeckGains();
        }

        try {
            await deck.audio.play();
            deck.isPlaying = true;
            return true;
        } catch (err) {
            console.error(`Không thể phát Deck ${deckId}:`, err);
            return false;
        }
    }

    // Pause Deck
    pauseDeck(deckId) {
        const deck = this.decks[deckId];
        if (!deck) return;
        deck.audio.pause();
        deck.isPlaying = false;
    }

    // Stop Deck (Reset to start)
    stopDeck(deckId) {
        const deck = this.decks[deckId];
        if (!deck) return;
        if (deck.fadeInterval) {
            clearInterval(deck.fadeInterval);
            deck.fadeInterval = null;
        }
        deck.audio.pause();
        deck.audio.currentTime = 0;
        deck.isPlaying = false;
        this._updateDeckGains();
    }

    // Fade Out & Stop
    fadeStopDeck(deckId, durationSec = 2) {
        const deck = this.decks[deckId];
        if (!deck || !deck.isPlaying) return;

        if (deck.fadeInterval) {
            clearInterval(deck.fadeInterval);
        }

        const currentGain = deck.gain.gain.value;
        const steps = 30;
        const intervalMs = (durationSec * 1000) / steps;
        let currentStep = 0;

        deck.fadeInterval = setInterval(() => {
            currentStep++;
            const factor = Math.max(0, 1 - currentStep / steps);
            deck.gain.gain.setValueAtTime(currentGain * factor, this.ctx.currentTime);

            if (currentStep >= steps) {
                clearInterval(deck.fadeInterval);
                deck.fadeInterval = null;
                deck.audio.pause();
                deck.audio.currentTime = 0;
                deck.isPlaying = false;
                this._updateDeckGains();
            }
        }, intervalMs);
    }

    // Seek Deck
    seekDeck(deckId, progress) {
        const deck = this.decks[deckId];
        if (!deck || !deck.duration) return;
        const target = Math.max(0, Math.min(deck.duration, progress * deck.duration));
        deck.audio.currentTime = target;
    }

    toggleDeckLoop(deckId) {
        const deck = this.decks[deckId];
        if (!deck) return false;
        deck.audio.loop = !deck.audio.loop;
        deck.isLooping = deck.audio.loop;
        return deck.isLooping;
    }

    // Auto-ducking
    triggerDucking(enable) {
        if (!this.duckingGain || !this.ctx) return;
        if (enable) {
            this.activePadsCount++;
            if (!this.isDucking) {
                this.isDucking = true;
                this.duckingGain.gain.cancelScheduledValues(this.ctx.currentTime);
                this.duckingGain.gain.setTargetAtTime(this.duckLevel, this.ctx.currentTime, 0.08);
            }
        } else {
            this.activePadsCount = Math.max(0, this.activePadsCount - 1);
            if (this.activePadsCount === 0 && this.isDucking) {
                this.isDucking = false;
                this.duckingGain.gain.cancelScheduledValues(this.ctx.currentTime);
                this.duckingGain.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.25);
            }
        }
    }

    // PANIC STOP
    panicStop() {
        if (!this.ctx) return;

        ['A', 'B'].forEach(id => {
            const deck = this.decks[id];
            if (deck.fadeInterval) clearInterval(deck.fadeInterval);
            deck.audio.pause();
            deck.audio.currentTime = 0;
            deck.isPlaying = false;
        });

        for (const padId in this.activePadSources) {
            const sources = this.activePadSources[padId] || [];
            sources.forEach(src => {
                try {
                    src.stop();
                    src.disconnect();
                } catch (e) {}
            });
            this.activePadSources[padId] = [];
        }

        this.activePadsCount = 0;
        this.isDucking = false;
        if (this.duckingGain) {
            this.duckingGain.gain.cancelScheduledValues(this.ctx.currentTime);
            this.duckingGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
        }
    }

    // --- SOUNDBOARD SYNTHESIZER & SAMPLE GENERATOR ---
    async playSyntheticPad(type, padId = null, padGainVal = 1.0) {
        await this.ensureContext();

        const padGain = this.ctx.createGain();
        padGain.gain.setValueAtTime(padGainVal, this.ctx.currentTime);
        padGain.connect(this.masterGain);

        let duration = 2.0;

        switch (type) {
            case 'applause':
                duration = this._synthApplause(padGain);
                break;
            case 'fanfare':
                duration = this._synthFanfare(padGain);
                break;
            case 'drumroll':
                duration = this._synthDrumroll(padGain);
                break;
            case 'countdown':
                duration = this._synthCountdown(padGain);
                break;
            case 'tada':
                duration = this._synthTada(padGain);
                break;
            case 'buzzer':
                duration = this._synthBuzzer(padGain);
                break;
            case 'tension':
                duration = this._synthTension(padGain);
                break;
            case 'airhorn':
                duration = this._synthAirhorn(padGain);
                break;
            case 'whoosh':
                duration = this._synthWhoosh(padGain);
                break;
            case 'ding':
                duration = this._synthDing(padGain);
                break;
            case 'heartbeat':
                duration = this._synthHeartbeat(padGain);
                break;
            case 'impact':
                duration = this._synthImpact(padGain);
                break;
            case 'shutter':
                duration = this._synthShutter(padGain);
                break;
            case 'laugh':
                duration = this._synthLaugh(padGain);
                break;
            case 'magic':
                duration = this._synthMagic(padGain);
                break;
            case 'lounge':
                duration = this._synthLoungePad(padGain);
                break;
            default:
                duration = this._synthDing(padGain);
                break;
        }


        return duration;
    }

    _synthApplause(dest) {
        const length = 3.5;
        const sampleRate = this.ctx.sampleRate;
        const bufferSize = sampleRate * length;
        const buffer = this.ctx.createBuffer(2, bufferSize, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < bufferSize; i++) {
                const t = i / sampleRate;
                const envelope = Math.min(1, t * 2) * Math.max(0, 1 - (t - 1.5) / 2.0);
                const burst = Math.sin(t * 50 + Math.sin(t * 120)) * 0.3;
                data[i] = (Math.random() * 2 - 1) * (0.4 + burst) * envelope;
            }
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1400, this.ctx.currentTime);
        filter.Q.setValueAtTime(0.8, this.ctx.currentTime);

        source.connect(filter);
        filter.connect(dest);
        source.start();
        return length;
    }

    _synthFanfare(dest) {
        const chords = [
            { time: 0.0, freqs: [261.63, 329.63, 392.00], dur: 0.3 },
            { time: 0.35, freqs: [329.63, 392.00, 523.25], dur: 0.3 },
            { time: 0.7, freqs: [392.00, 493.88, 587.33], dur: 0.4 },
            { time: 1.15, freqs: [523.25, 659.25, 783.99, 1046.50], dur: 2.5 }
        ];

        chords.forEach(c => {
            c.freqs.forEach(freq => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq, this.ctx.currentTime + c.time);

                const startTime = this.ctx.currentTime + c.time;
                gain.gain.setValueAtTime(0.001, startTime);
                gain.gain.exponentialRampToValueAtTime(0.12, startTime + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + c.dur);

                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(2800, startTime);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(dest);

                osc.start(startTime);
                osc.stop(startTime + c.dur + 0.1);
            });
        });

        return 3.8;
    }

    _synthDrumroll(dest) {
        const rollDuration = 2.5;
        const totalDuration = 4.0;
        const sampleRate = this.ctx.sampleRate;
        const bufferSize = sampleRate * rollDuration;
        const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const t = i / sampleRate;
            const flutter = Math.sin(t * 80) * 0.4 + 0.6;
            const crescendo = Math.pow(t / rollDuration, 1.8);
            data[i] = (Math.random() * 2 - 1) * flutter * crescendo * 0.7;
        }

        const rollSource = this.ctx.createBufferSource();
        rollSource.buffer = buffer;
        const rollFilter = this.ctx.createBiquadFilter();
        rollFilter.type = 'bandpass';
        rollFilter.frequency.setValueAtTime(220, this.ctx.currentTime);
        rollFilter.Q.setValueAtTime(2.5, this.ctx.currentTime);

        rollSource.connect(rollFilter);
        rollFilter.connect(dest);
        rollSource.start();

        setTimeout(() => {
            if (!this.ctx) return;
            const crashDur = 1.8;
            const crashBuf = this.ctx.createBuffer(2, sampleRate * crashDur, sampleRate);
            for (let ch = 0; ch < 2; ch++) {
                const cData = crashBuf.getChannelData(ch);
                for (let i = 0; i < cData.length; i++) {
                    const t = i / sampleRate;
                    cData[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.5) * 0.8;
                }
            }
            const crashSrc = this.ctx.createBufferSource();
            crashSrc.buffer = crashBuf;
            const highpass = this.ctx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.setValueAtTime(5000, this.ctx.currentTime);
            crashSrc.connect(highpass);
            highpass.connect(dest);
            crashSrc.start();
        }, rollDuration * 1000);

        return totalDuration;
    }

    _synthCountdown(dest) {
        const beeps = [0.0, 0.7, 1.4];
        beeps.forEach((time) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const t = this.ctx.currentTime + time;
            osc.frequency.setValueAtTime(880, t);
            gain.gain.setValueAtTime(0.3, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.3);
        });

        const goTime = this.ctx.currentTime + 2.1;
        const oscGo = this.ctx.createOscillator();
        const gainGo = this.ctx.createGain();
        oscGo.type = 'triangle';
        oscGo.frequency.setValueAtTime(1760, goTime);
        gainGo.gain.setValueAtTime(0.5, goTime);
        gainGo.gain.exponentialRampToValueAtTime(0.001, goTime + 1.2);
        oscGo.connect(gainGo);
        gainGo.connect(dest);
        oscGo.start(goTime);
        oscGo.stop(goTime + 1.3);

        return 3.5;
    }

    _synthTada(dest) {
        const notes = [
            { f: 523.25, t: 0.0, d: 0.15 },
            { f: 659.25, t: 0.15, d: 0.15 },
            { f: 783.99, t: 0.3, d: 0.2 },
            { f: 1046.50, t: 0.5, d: 1.5 }
        ];

        notes.forEach(n => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const startTime = this.ctx.currentTime + n.t;

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(n.f, startTime);

            gain.gain.setValueAtTime(0.35, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + n.d);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(startTime);
            osc.stop(startTime + n.d + 0.05);
        });

        return 2.2;
    }

    _synthBuzzer(dest) {
        const dur = 0.8;
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc1.type = 'sawtooth';
        osc2.type = 'sawtooth';

        osc1.frequency.setValueAtTime(130.81, this.ctx.currentTime);
        osc2.frequency.setValueAtTime(138.59, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(dest);

        osc1.start(this.ctx.currentTime);
        osc2.start(this.ctx.currentTime);
        osc1.stop(this.ctx.currentTime + dur);
        osc2.stop(this.ctx.currentTime + dur);

        return dur;
    }

    _synthTension(dest) {
        const dur = 3.0;
        const osc = this.ctx.createOscillator();
        const sub = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(75, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(120, this.ctx.currentTime + dur);

        sub.type = 'sine';
        sub.frequency.setValueAtTime(45, this.ctx.currentTime);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, this.ctx.currentTime);
        filter.frequency.linearRampToValueAtTime(1200, this.ctx.currentTime + dur);

        gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.4, this.ctx.currentTime + dur * 0.8);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);

        osc.connect(filter);
        sub.connect(filter);
        filter.connect(gain);
        gain.connect(dest);

        osc.start(this.ctx.currentTime);
        sub.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + dur);
        sub.stop(this.ctx.currentTime + dur);

        return dur;
    }

    _synthAirhorn(dest) {
        const burstTimes = [0.0, 0.18, 0.36, 0.54];
        const dur = 0.12;

        burstTimes.forEach((t) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const startTime = this.ctx.currentTime + t;

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(470, startTime);
            osc.frequency.linearRampToValueAtTime(450, startTime + dur);

            gain.gain.setValueAtTime(0.4, startTime);
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + dur);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(1200, startTime);
            filter.Q.setValueAtTime(1.5, startTime);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(dest);

            osc.start(startTime);
            osc.stop(startTime + dur + 0.05);
        });

        return 1.2;
    }

    _synthWhoosh(dest) {
        const dur = 1.0;
        const sampleRate = this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, sampleRate * dur, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.setValueAtTime(3.0, this.ctx.currentTime);
        filter.frequency.setValueAtTime(200, this.ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(3500, this.ctx.currentTime + dur * 0.6);
        filter.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + dur);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.4, this.ctx.currentTime + dur * 0.5);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(dest);

        source.start();
        return dur;
    }

    _synthDing(dest) {
        const dur = 1.2;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(1567.98, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + dur);

        return dur;
    }

    _synthHeartbeat(dest) {
        const dur = 2.0;
        const beats = [0.0, 0.25, 0.9, 1.15];

        beats.forEach(b => {
            const t = this.ctx.currentTime + b;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(90, t);
            osc.frequency.exponentialRampToValueAtTime(35, t + 0.18);

            gain.gain.setValueAtTime(0.6, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.25);
        });

        return dur;
    }

    _synthImpact(dest) {
        const dur = 2.5;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(160, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.8);

        gain.gain.setValueAtTime(0.7, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + dur);

        return dur;
    }

    _synthShutter(dest) {
        const dur = 0.4;
        const sampleRate = this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, sampleRate * dur, sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < data.length; i++) {
            const t = i / sampleRate;
            if (t < 0.08 || (t > 0.15 && t < 0.25)) {
                data[i] = (Math.random() * 2 - 1) * 0.7;
            } else {
                data[i] = 0;
            }
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(2200, this.ctx.currentTime);

        source.connect(filter);
        filter.connect(dest);
        source.start();
        return dur;
    }

    _synthLaugh(dest) {
        const dur = 2.2;
        const chuckles = [0.0, 0.18, 0.36, 0.58, 0.8, 1.05];
        chuckles.forEach((t, i) => {
            const time = this.ctx.currentTime + t;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sawtooth';
            const basePitch = 240 + Math.sin(i * 1.5) * 40;
            osc.frequency.setValueAtTime(basePitch, time);
            osc.frequency.linearRampToValueAtTime(basePitch - 50, time + 0.14);

            gain.gain.setValueAtTime(0.3, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(900, time);
            filter.Q.setValueAtTime(4, time);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(dest);

            osc.start(time);
            osc.stop(time + 0.16);
        });

        return dur;
    }

    _synthMagic(dest) {
        const dur = 2.0;
        const scale = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];
        scale.forEach((freq, idx) => {
            const t = this.ctx.currentTime + idx * 0.12;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t);

            gain.gain.setValueAtTime(0.25, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.9);
        });

        return dur;
    }

    _synthLoungePad(dest) {
        const dur = 4.0;
        const freqs = [196.00, 246.94, 293.66, 369.99];
        freqs.forEach(f => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(f, this.ctx.currentTime);

            gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 1.2);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(900, this.ctx.currentTime);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(dest);

            osc.start(this.ctx.currentTime);
            osc.stop(this.ctx.currentTime + dur);
        });

        return dur;
    }

    // Load custom audio file for a pad
    async loadCustomPadAudio(padId, file) {
        await this.ensureContext();
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            this.soundboardBuffers[padId] = audioBuffer;
            return true;
        } catch (err) {
            console.error(`Lỗi giải mã audio pad ${padId}:`, err);
            return false;
        }
    }

    // Play custom audio for a pad (hỗ trợ phát tiếp từ vị trí tạm dừng)
    playCustomPad(padId, padGainVal = 1.0, isLoop = false, onEnded = null, fromBeginning = false, seekSeconds = null) {
        const buffer = this.soundboardBuffers[padId];
        if (!buffer || !this.ctx) return 0;

        if (!this.padStates[padId]) {
            this.padStates[padId] = {
                source: null,
                gainNode: null,
                isPlaying: false,
                isPaused: false,
                isLoop: isLoop,
                startTime: 0,
                pauseOffset: 0,
                targetGain: padGainVal,
                fadeTimeout: null
            };
        }

        const state = this.padStates[padId];
        if (state.fadeTimeout) {
            clearTimeout(state.fadeTimeout);
            state.fadeTimeout = null;
        }

        // Dọn dẹp source cũ nếu có
        if (state.source) {
            try {
                state.source.onended = null;
                state.source.stop();
                state.source.disconnect();
            } catch (e) {}
            state.source = null;
        }

        if (fromBeginning) {
            state.pauseOffset = 0;
        }
        if (Number.isFinite(seekSeconds)) {
            state.pauseOffset = Math.max(0, Math.min(seekSeconds, Math.max(0, buffer.duration - 0.01)));
        }

        state.isLoop = isLoop !== undefined ? !!isLoop : state.isLoop;
        state.targetGain = padGainVal;

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = !!state.isLoop;

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0.001, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(padGainVal, this.ctx.currentTime + 0.05);

        source.connect(gainNode);
        gainNode.connect(this.masterGain);

        state.source = source;
        state.gainNode = gainNode;

        const offset = state.pauseOffset % buffer.duration;
        state.startTime = this.ctx.currentTime - offset;
        state.isPlaying = true;
        state.isPaused = false;

        source.onended = () => {
            if (!state.isLoop && !state.isPaused) {
                state.isPlaying = false;
                state.pauseOffset = 0;
                if (typeof onEnded === 'function') {
                    onEnded();
                }
            }
        };

        source.start(0, offset);

        const remainingDur = buffer.duration - offset;
        return remainingDur > 0 ? remainingDur : buffer.duration;
    }

    isPadPlaying(padId) {
        return !!(this.padStates[padId] && this.padStates[padId].isPlaying);
    }

    isPadPaused(padId) {
        return !!(this.padStates[padId] && this.padStates[padId].isPaused);
    }

    getPadState(padId) {
        return this.padStates[padId] || {
            isPlaying: false,
            isPaused: false,
            isLoop: false,
            pauseOffset: 0
        };
    }

    // Tạm dừng phát âm thanh của pad (lưu lại thời điểm để phát tiếp)
    pauseCustomPad(padId) {
        const state = this.padStates[padId];
        const buffer = this.soundboardBuffers[padId];
        if (!state || !state.isPlaying || !state.source || !this.ctx || !buffer) return false;

        const elapsed = (this.ctx.currentTime - state.startTime) % buffer.duration;
        state.pauseOffset = elapsed;
        state.isPlaying = false;
        state.isPaused = true;

        if (state.fadeTimeout) {
            clearTimeout(state.fadeTimeout);
            state.fadeTimeout = null;
        }

        try {
            state.source.onended = null;
            state.gainNode.gain.setValueAtTime(state.gainNode.gain.value, this.ctx.currentTime);
            state.gainNode.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);
            const pausedSource = state.source;
            setTimeout(() => {
                try {
                    pausedSource.stop();
                    pausedSource.disconnect();
                } catch (e) {}
                if (state.source === pausedSource) state.source = null;
            }, 50);
        } catch (e) {}
        return true;
    }

    // Bật/Tắt chế độ lặp lại (Loop) cho pad
    togglePadLoop(padId, forceState = null) {
        if (!this.padStates[padId]) {
            this.padStates[padId] = {
                source: null,
                gainNode: null,
                isPlaying: false,
                isPaused: false,
                isLoop: false,
                startTime: 0,
                pauseOffset: 0,
                targetGain: 1.0,
                fadeTimeout: null
            };
        }
        const state = this.padStates[padId];
        state.isLoop = forceState !== null ? !!forceState : !state.isLoop;
        if (state.source) {
            state.source.loop = state.isLoop;
        }
        return state.isLoop;
    }

    // Hạ âm lượng nhỏ dần từ từ (trong số giây yêu cầu, mặc định 3s)
    fadePad(padId, seconds = 3.0, onComplete = null) {
        const state = this.padStates[padId];
        if (!state || !state.isPlaying || !state.gainNode || !this.ctx) {
            this.stopPad(padId);
            if (onComplete) onComplete();
            return false;
        }

        if (state.fadeTimeout) {
            clearTimeout(state.fadeTimeout);
            state.fadeTimeout = null;
        }

        const now = this.ctx.currentTime;
        state.gainNode.gain.cancelScheduledValues(now);
        state.gainNode.gain.setValueAtTime(state.gainNode.gain.value, now);
        state.gainNode.gain.linearRampToValueAtTime(0.0001, now + seconds);

        state.fadeTimeout = setTimeout(() => {
            this.stopPad(padId);
            if (onComplete) onComplete();
        }, seconds * 1000);

        return true;
    }

    stopPad(padId) {
        const state = this.padStates[padId];
        if (state) {
            if (state.fadeTimeout) {
                clearTimeout(state.fadeTimeout);
                state.fadeTimeout = null;
            }
            if (state.source) {
                try {
                    state.source.onended = null;
                    state.source.stop();
                    state.source.disconnect();
                } catch (e) {}
                state.source = null;
            }
            state.isPlaying = false;
            state.isPaused = false;
            state.pauseOffset = 0;
        }
        if (this.activePadSources[padId]) {
            this.activePadSources[padId].forEach(s => {
                try {
                    s.stop();
                    s.disconnect();
                } catch (e) {}
            });
            this.activePadSources[padId] = [];
        }
    }
}

// Export singleton instance
window.audioEngine = new EventAudioEngine();
