/**
 * SERVER NODE.JS - HỆ THỐNG PHÁT NHẠC SỰ KIỆN NIX BÙI
 * Hỗ trợ:
 * - Phục vụ toàn bộ giao diện Web, PWA, Audio engine
 * - RESTful API quản lý: Bài hát, Thư mục (Folders), Bàn phím hiệu ứng (Soundboard), Cài đặt
 * - Tự động kết nối cơ sở dữ liệu Neon Serverless PostgreSQL (nếu có DATABASE_URL)
 * - Tự động chuyển đổi sang lưu trữ cục bộ (Local JSON & Uploads) nếu chạy offline hoặc chưa có Neon DB
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Đường dẫn lưu trữ dữ liệu cục bộ
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Cấu hình Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Cấu hình Multer để lưu file âm thanh tải lên
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const safeBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E6);
        cb(null, `${safeBase}_${uniqueSuffix}${ext}`);
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB tối đa mỗi file
});

// =============================================================================
// KẾT NỐI DATABASE (NEON POSTGRES HOẶC LOCAL JSON)
// =============================================================================
let pgPool = null;
let isPostgres = false;

// Dữ liệu bộ nhớ cục bộ khi không có PostgreSQL
let localData = {
    folders: [],
    tracks: [],
    pads: {},
    settings: {
        theme: 'dark',
        size_mode: 'normal',
        split_ratio: 0.5,
        master_volume: 0.0,
        quick_fx_mode: 'poly'
    }
};

function loadLocalData() {
    try {
        if (fs.existsSync(LOCAL_DB_FILE)) {
            const raw = fs.readFileSync(LOCAL_DB_FILE, 'utf8');
            localData = JSON.parse(raw);
            if (!localData.folders) localData.folders = [];
            if (!localData.tracks) localData.tracks = [];
            if (!localData.pads) localData.pads = {};
            if (!localData.settings) localData.settings = {};
        } else {
            saveLocalData();
        }
    } catch (err) {
        console.warn('⚠️ Lỗi đọc db.json cục bộ:', err.message);
    }
}

function saveLocalData() {
    try {
        fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(localData, null, 2), 'utf8');
    } catch (err) {
        console.warn('⚠️ Lỗi ghi db.json cục bộ:', err.message);
    }
}

loadLocalData();

async function initDatabase() {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
        try {
            const { Pool } = require('pg');
            pgPool = new Pool({
                connectionString: dbUrl,
                ssl: { rejectUnauthorized: false }
            });
            const client = await pgPool.connect();
            console.log('✅ Đã kết nối thành công tới cơ sở dữ liệu Neon PostgreSQL!');
            client.release();
            isPostgres = true;

            // Khởi tạo các bảng nếu chưa có
            await runMigrations();
        } catch (err) {
            console.warn('⚠️ Không thể kết nối tới Neon PostgreSQL (sử dụng bộ nhớ cục bộ):', err.message);
            isPostgres = false;
        }
    } else {
        console.log('ℹ️ Không có biến môi trường DATABASE_URL. Ứng dụng chạy ở chế độ lưu trữ cục bộ (Local JSON & Uploads).');
        isPostgres = false;
    }
}

async function runMigrations() {
    if (!pgPool) return;
    try {
        await pgPool.query(`
            CREATE TABLE IF NOT EXISTS playlist_folders (
                id VARCHAR(100) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                id VARCHAR(100) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                duration VARCHAR(20) DEFAULT '00:00',
                duration_seconds NUMERIC(8, 2) DEFAULT 0.00,
                folder_id VARCHAR(100),
                order_index INTEGER DEFAULT 0,
                audio_url TEXT,
                file_size_bytes BIGINT DEFAULT 0,
                mime_type VARCHAR(64) DEFAULT 'audio/mpeg',
                date_added BIGINT DEFAULT (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS soundboard_pads (
                pad_id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                hotkey VARCHAR(10),
                category VARCHAR(80) DEFAULT 'Sự kiện',
                color_group VARCHAR(50) DEFAULT 'group-award',
                duration VARCHAR(20) DEFAULT '--',
                volume NUMERIC(3, 2) DEFAULT 1.00,
                is_loop BOOLEAN DEFAULT FALSE,
                is_custom BOOLEAN DEFAULT FALSE,
                file_name VARCHAR(255) DEFAULT '',
                audio_url TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                id VARCHAR(50) PRIMARY KEY DEFAULT 'default_config',
                theme VARCHAR(20) NOT NULL DEFAULT 'dark',
                size_mode VARCHAR(20) NOT NULL DEFAULT 'normal',
                split_ratio NUMERIC(5, 4) DEFAULT 0.5000,
                master_volume NUMERIC(3, 2) DEFAULT 0.00,
                quick_fx_mode VARCHAR(20) DEFAULT 'poly',
                global_fx_settings JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Đã đồng bộ cấu trúc bảng cơ sở dữ liệu thành công.');
    } catch (e) {
        console.warn('⚠️ Lỗi chạy migration:', e.message);
    }
}

// =============================================================================
// CÁC ĐIỂM CUỐI REST API (ROUTES)
// =============================================================================

// 1. Kiểm tra trạng thái máy chủ & Database
app.get('/api/status', async (req, res) => {
    res.json({
        status: 'online',
        database: isPostgres ? 'Neon PostgreSQL' : 'Local Storage',
        folderCount: localData.folders.length,
        trackCount: localData.tracks.length,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: Date.now()
    });
});

// 2. Lấy danh sách thư mục (Folders)
app.get('/api/folders', async (req, res) => {
    try {
        if (isPostgres) {
            const result = await pgPool.query('SELECT * FROM playlist_folders ORDER BY sort_order ASC, created_at ASC');
            return res.json({ success: true, folders: result.rows });
        }
        res.json({ success: true, folders: localData.folders });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Tạo thư mục mới
app.post('/api/folders', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Tên thư mục không được để trống' });
        }
        const folderId = req.body.id || `folder-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        const newFolder = {
            id: folderId,
            name: name.trim(),
            createdAt: Date.now()
        };

        if (isPostgres) {
            await pgPool.query(
                'INSERT INTO playlist_folders (id, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $2',
                [newFolder.id, newFolder.name, localData.folders.length + 1]
            );
        }

        localData.folders.push(newFolder);
        saveLocalData();

        res.json({ success: true, folder: newFolder });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Đổi tên thư mục
app.put('/api/folders/:id', async (req, res) => {
    try {
        const folderId = req.params.id;
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Tên thư mục không được để trống' });
        }

        if (isPostgres) {
            await pgPool.query('UPDATE playlist_folders SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [name.trim(), folderId]);
        }

        const f = localData.folders.find(x => x.id === folderId);
        if (f) {
            f.name = name.trim();
            saveLocalData();
        }

        res.json({ success: true, folder: { id: folderId, name: name.trim() } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. Xóa thư mục (Các file sẽ về chưa phân loại)
app.delete('/api/folders/:id', async (req, res) => {
    try {
        const folderId = req.params.id;
        if (isPostgres) {
            await pgPool.query('DELETE FROM playlist_folders WHERE id = $1', [folderId]);
            await pgPool.query('UPDATE playlist_tracks SET folder_id = NULL WHERE folder_id = $1', [folderId]);
        }

        localData.folders = localData.folders.filter(x => x.id !== folderId);
        localData.tracks.forEach(t => {
            if (t.folderId === folderId) t.folderId = null;
        });
        saveLocalData();

        res.json({ success: true, message: 'Đã xóa thư mục thành công' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Lấy danh sách bài hát (Tracks)
app.get('/api/tracks', async (req, res) => {
    try {
        const { folderId } = req.query;
        if (isPostgres) {
            let query = 'SELECT * FROM playlist_tracks ORDER BY order_index ASC, date_added DESC';
            let params = [];
            if (folderId !== undefined) {
                if (folderId === 'null' || folderId === '') {
                    query = 'SELECT * FROM playlist_tracks WHERE folder_id IS NULL ORDER BY order_index ASC, date_added DESC';
                } else {
                    query = 'SELECT * FROM playlist_tracks WHERE folder_id = $1 ORDER BY order_index ASC, date_added DESC';
                    params = [folderId];
                }
            }
            const result = await pgPool.query(query, params);
            return res.json({ success: true, tracks: result.rows });
        }

        let tracks = localData.tracks;
        if (folderId !== undefined) {
            if (folderId === 'null' || folderId === '') {
                tracks = tracks.filter(t => !t.folderId);
            } else {
                tracks = tracks.filter(t => t.folderId === folderId);
            }
        }
        res.json({ success: true, tracks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. Tải lên một hoặc nhiều file nhạc từ máy tính (Upload audio)
app.post('/api/upload', upload.array('audioFiles', 50), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'Không có file nào được tải lên' });
        }

        const folderId = req.body.folderId || null;
        const uploadedTracks = [];

        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const title = path.basename(file.originalname, path.extname(file.originalname));
            const trackId = `track-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 4)}`;
            const audioUrl = `/uploads/${file.filename}`;

            const trackObj = {
                id: trackId,
                title: title,
                fileName: file.originalname,
                savedFileName: file.filename,
                audioUrl: audioUrl,
                duration: req.body.duration || '00:00',
                folderId: folderId || null,
                fileSizeBytes: file.size,
                mimeType: file.mimetype,
                dateAdded: Date.now() + i
            };

            if (isPostgres) {
                await pgPool.query(`
                    INSERT INTO playlist_tracks (id, title, file_name, audio_url, duration, folder_id, file_size_bytes, mime_type, date_added)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (id) DO UPDATE SET title = $2, folder_id = $6
                `, [
                    trackObj.id,
                    trackObj.title,
                    trackObj.fileName,
                    trackObj.audioUrl,
                    trackObj.duration,
                    trackObj.folderId,
                    trackObj.fileSizeBytes,
                    trackObj.mimeType,
                    trackObj.dateAdded
                ]);
            }

            localData.tracks.push(trackObj);
            uploadedTracks.push(trackObj);
        }

        saveLocalData();
        res.json({ success: true, count: uploadedTracks.length, tracks: uploadedTracks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 8. Cập nhật bài hát (Chuyển thư mục / Đổi tên)
app.put('/api/tracks/:id', async (req, res) => {
    try {
        const trackId = req.params.id;
        const { folderId, title } = req.body;

        if (isPostgres) {
            await pgPool.query(`
                UPDATE playlist_tracks
                SET folder_id = COALESCE($1, folder_id),
                    title = COALESCE($2, title),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [folderId !== undefined ? folderId : null, title || null, trackId]);
        }

        const trk = localData.tracks.find(t => t.id === trackId);
        if (trk) {
            if (folderId !== undefined) trk.folderId = folderId;
            if (title) trk.title = title;
            saveLocalData();
        }

        res.json({ success: true, track: trk });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 9. Xóa bài hát
app.delete('/api/tracks/:id', async (req, res) => {
    try {
        const trackId = req.params.id;
        const trk = localData.tracks.find(t => t.id === trackId);

        if (trk && trk.savedFileName) {
            const filePath = path.join(UPLOADS_DIR, trk.savedFileName);
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch (e) {}
            }
        }

        if (isPostgres) {
            await pgPool.query('DELETE FROM playlist_tracks WHERE id = $1', [trackId]);
        }

        localData.tracks = localData.tracks.filter(t => t.id !== trackId);
        saveLocalData();

        res.json({ success: true, message: 'Đã xóa bài hát thành công' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 10. Lấy cấu hình phím hiệu ứng Soundboard
app.get('/api/pads', async (req, res) => {
    try {
        if (isPostgres) {
            const result = await pgPool.query('SELECT * FROM soundboard_pads ORDER BY sort_order ASC');
            return res.json({ success: true, pads: result.rows });
        }
        res.json({ success: true, pads: localData.pads });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 11. Lưu cấu hình toàn bộ phím hiệu ứng Soundboard
app.post('/api/pads/sync', async (req, res) => {
    try {
        const { pads } = req.body;
        if (!pads || typeof pads !== 'object') {
            return res.status(400).json({ success: false, error: 'Dữ liệu pads không hợp lệ' });
        }

        localData.pads = pads;
        saveLocalData();

        if (isPostgres) {
            for (const pid in pads) {
                const p = pads[pid];
                await pgPool.query(`
                    INSERT INTO soundboard_pads (pad_id, name, hotkey, category, color_group, duration, volume, is_loop, is_custom, file_name)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    ON CONFLICT (pad_id) DO UPDATE SET
                        name = $2, hotkey = $3, category = $4, color_group = $5,
                        duration = $6, volume = $7, is_loop = $8, is_custom = $9, file_name = $10,
                        updated_at = CURRENT_TIMESTAMP
                `, [
                    String(pid),
                    p.name || '',
                    p.key || '',
                    p.cat || 'Sự kiện',
                    p.group || 'group-award',
                    p.duration || '--',
                    p.volume !== undefined ? p.volume : 1.0,
                    !!p.isLoop,
                    !!p.isCustom,
                    p.fileName || ''
                ]);
            }
        }

        res.json({ success: true, message: 'Đã lưu cấu hình phím thành công' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 12. Tải lên file âm thanh cho một ô phím
app.post('/api/pads/:padId/audio', upload.single('audioFile'), async (req, res) => {
    try {
        const padId = req.params.padId;
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Chưa có file âm thanh' });
        }

        const audioUrl = `/uploads/${req.file.filename}`;
        const fileName = req.file.originalname;

        if (!localData.pads[padId]) {
            localData.pads[padId] = {};
        }
        localData.pads[padId].fileName = fileName;
        localData.pads[padId].audioUrl = audioUrl;
        localData.pads[padId].isCustom = true;
        saveLocalData();

        if (isPostgres) {
            await pgPool.query(`
                UPDATE soundboard_pads
                SET file_name = $1, audio_url = $2, is_custom = TRUE, updated_at = CURRENT_TIMESTAMP
                WHERE pad_id = $3
            `, [fileName, audioUrl, padId]);
        }

        res.json({ success: true, padId, fileName, audioUrl });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 13. Đồng bộ toàn bộ dữ liệu (Sync All)
app.post('/api/sync', async (req, res) => {
    try {
        const { folders, tracks, pads, settings } = req.body;
        if (Array.isArray(folders)) localData.folders = folders;
        if (Array.isArray(tracks)) localData.tracks = tracks;
        if (pads && typeof pads === 'object') localData.pads = pads;
        if (settings && typeof settings === 'object') localData.settings = settings;

        saveLocalData();
        res.json({
            success: true,
            message: 'Đồng bộ toàn bộ dữ liệu thành công',
            timestamp: Date.now()
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================================================
// PHỤC VỤ TÀI NGUYÊN TĨNH (STATIC ASSETS) & GIAO DIỆN WEB
// =============================================================================
// Phục vụ thư mục file âm thanh đã tải lên
app.use('/uploads', express.static(UPLOADS_DIR));

// Phục vụ toàn bộ các file web frontend trong thư mục gốc
app.use(express.static(__dirname));

// Điều hướng mặc định về index.html cho SPA
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Khởi chạy Server
initDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`=================================================================`);
        console.log(`🚀 WEB TRÌNH PHÁT NHẠC SỰ KIỆN NIX BÙI - NODE.JS SERVER`);
        console.log(`📡 Địa chỉ truy cập nội bộ : http://localhost:${PORT}`);
        console.log(`🌐 Lưu trữ dữ liệu        : ${isPostgres ? 'Neon Serverless PostgreSQL' : 'Cục bộ (Local JSON & Uploads)'}`);
        console.log(`📁 Thư mục file nhạc       : ${UPLOADS_DIR}`);
        console.log(`=================================================================`);
    });
});
