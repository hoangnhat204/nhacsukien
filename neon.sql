-- =============================================================================
-- TRÌNH PHÁT NHẠC SỰ KIỆN NIX BÙI - NEON SERVERLESS POSTGRESQL SCHEMA
-- File: neon.sql
-- Mục đích: Khởi tạo cơ sở dữ liệu trên Neon.tech để lưu trữ và đồng bộ dữ liệu:
--          - Danh sách bài hát kịch bản sự kiện (Playlist Tracks)
--          - Danh mục thư mục phân loại nhạc (Playlist Folders)
--          - Cấu hình & âm thanh bàn phím hiệu ứng tức thì 36 phím 0-9 & A-Z (Soundboard Pads)
--          - Cài đặt giao diện & âm thanh tổng (App Settings)
--          - Các kịch bản sự kiện mẫu (Event Scenarios)
--
-- HƯỚNG DẪN SỬ DỤNG TRÊN NEON:
-- 1. Truy cập https://console.neon.tech và tạo hoặc chọn một dự án (Project).
-- 2. Vào mục "SQL Editor" ở thanh menu bên trái.
-- 3. Dán toàn bộ nội dung file này vào và bấm nút "Run" để khởi tạo toàn bộ bảng.
-- =============================================================================

-- 1. BẬT TIỆN ÍCH HỖ TRỢ UUID (NẾU CẦN TẠO MÃ TỰ ĐỘNG)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 2. HÀM TỰ ĐỘNG CẬP NHẬT THỜI GIAN (TRIGGER FUNCTION)
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 3. BẢNG: CÀI ĐẶT ỨNG DỤNG TỔNG QUAN (APP_SETTINGS)
-- Lưu trữ: Chủ đề sáng/tối, kích cỡ, âm lượng tổng (mặc định 0%), chế độ phát, tỷ lệ chia màn hình
-- =============================================================================
CREATE TABLE IF NOT EXISTS app_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default_config',
    theme VARCHAR(20) NOT NULL DEFAULT 'dark',              -- 'dark' (Tối) hoặc 'light' (Sáng)
    size_mode VARCHAR(20) NOT NULL DEFAULT 'normal',        -- 'normal' (Chuẩn) hoặc 'compact' (Thu nhỏ)
    split_ratio NUMERIC(5, 4) DEFAULT 0.5000,              -- Tỷ lệ chia thanh kéo giữa (mặc định 50%)
    master_volume NUMERIC(3, 2) DEFAULT 0.00,              -- Âm lượng tổng (mặc định 0.00 = 0%)
    quick_fx_mode VARCHAR(20) DEFAULT 'poly',              -- 'poly' (phát đè) hoặc 'cut' (ngắt âm cũ)
    global_fx_settings JSONB DEFAULT '{}'::jsonb,           -- Cấu hình EQ, Reverb, Ducking nâng cao
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Trigger cập nhật thời gian sửa đổi cho app_settings
DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON app_settings;
CREATE TRIGGER trg_app_settings_updated_at
BEFORE UPDATE ON app_settings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 4. BẢNG: THƯ MỤC PHÂN LOẠI NHẠC (PLAYLIST_FOLDERS)
-- Lưu trữ: Các thư mục do người dùng tạo (Khai mạc, Trao giải, Văn nghệ...)
-- =============================================================================
CREATE TABLE IF NOT EXISTS playlist_folders (
    id VARCHAR(100) PRIMARY KEY,                           -- Mã thư mục (ví dụ: folder-1710000000000-abcd)
    name VARCHAR(255) NOT NULL,                           -- Tên thư mục (Khai mạc, Trao giải...)
    sort_order INTEGER DEFAULT 0,                         -- Thứ tự sắp xếp hiển thị
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_folders_sort ON playlist_folders(sort_order ASC);

-- Trigger cập nhật thời gian sửa đổi cho playlist_folders
DROP TRIGGER IF EXISTS trg_playlist_folders_updated_at ON playlist_folders;
CREATE TRIGGER trg_playlist_folders_updated_at
BEFORE UPDATE ON playlist_folders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 5. BẢNG: DANH SÁCH BÀI HÁT KỊCH BẢN (PLAYLIST_TRACKS)
-- Lưu trữ: Toàn bộ danh sách bài hát kịch bản sự kiện, độ dài, thư mục chứa, file âm thanh
-- =============================================================================
CREATE TABLE IF NOT EXISTS playlist_tracks (
    id VARCHAR(100) PRIMARY KEY,                           -- Mã định danh track (ví dụ: track-1710000000000-abcd)
    title VARCHAR(255) NOT NULL,                           -- Tên bài hát hiển thị
    file_name VARCHAR(255) NOT NULL,                       -- Tên file gốc (ví dụ: chao_mung.mp3)
    duration VARCHAR(20) DEFAULT '00:00',                  -- Thời lượng hiển thị (ví dụ: 03:45)
    duration_seconds NUMERIC(8, 2) DEFAULT 0.00,           -- Thời lượng quy đổi ra giây
    folder_id VARCHAR(100) REFERENCES playlist_folders(id) ON DELETE SET NULL, -- Thư mục chứa bài hát
    order_index INTEGER DEFAULT 0,                         -- Thứ tự sắp xếp trong kịch bản
    audio_url TEXT,                                        -- Đường link CDN / Cloud Storage (nếu có)
    audio_base64 TEXT,                                     -- Chuỗi Base64 dữ liệu âm thanh (lưu trực tiếp)
    file_size_bytes BIGINT DEFAULT 0,                      -- Dung lượng file âm thanh (bytes)
    mime_type VARCHAR(64) DEFAULT 'audio/mpeg',            -- Loại định dạng âm thanh
    date_added BIGINT DEFAULT (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_playlist_folder ON playlist_tracks(folder_id);
CREATE INDEX IF NOT EXISTS idx_playlist_order ON playlist_tracks(order_index ASC);
CREATE INDEX IF NOT EXISTS idx_playlist_date_added ON playlist_tracks(date_added DESC);

-- Trigger cập nhật thời gian sửa đổi cho playlist_tracks
DROP TRIGGER IF EXISTS trg_playlist_tracks_updated_at ON playlist_tracks;
CREATE TRIGGER trg_playlist_tracks_updated_at
BEFORE UPDATE ON playlist_tracks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 6. BẢNG: BÀN PHÍM HIỆU ỨNG TỨC THÌ (SOUNDBOARD_PADS)
-- Lưu trữ: Cấu hình 36 ô phím hiệu ứng âm thanh (0-9 và A-Z)
-- =============================================================================
CREATE TABLE IF NOT EXISTS soundboard_pads (
    pad_id VARCHAR(50) PRIMARY KEY,                        -- Mã định danh ô (1, 2, ... 36)
    name VARCHAR(150) NOT NULL,                            -- Tên hiển thị trên ô phím (VD: Phím 1, Phím A)
    hotkey VARCHAR(10),                                    -- Phím tắt nhanh bàn phím (0-9, A-Z)
    category VARCHAR(80) DEFAULT 'Sự kiện',                -- Danh mục nhóm ('Số', 'Chữ cái', 'Sự kiện'...)
    color_group VARCHAR(50) DEFAULT 'group-award',         -- Nhóm màu hiệu ứng giao diện
    duration VARCHAR(20) DEFAULT '--',                     -- Thời lượng âm thanh
    volume NUMERIC(3, 2) DEFAULT 1.00,                     -- Âm lượng riêng của ô phím (0.00 đến 1.50)
    is_loop BOOLEAN DEFAULT FALSE,                         -- Có lặp lại liên tục hay không
    is_custom BOOLEAN DEFAULT FALSE,                       -- Đã nạp file tùy chỉnh riêng chưa
    file_name VARCHAR(255) DEFAULT '',                     -- Tên file âm thanh đã nạp
    audio_url TEXT,                                        -- Link tải âm thanh từ máy chủ
    audio_base64 TEXT,                                     -- Dữ liệu âm thanh Base64 lưu trực tiếp
    sort_order INTEGER DEFAULT 0,                          -- Thứ tự hiển thị ô phím
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_soundboard_hotkey ON soundboard_pads(hotkey);
CREATE INDEX IF NOT EXISTS idx_soundboard_sort ON soundboard_pads(sort_order ASC);

-- Trigger cập nhật thời gian sửa đổi cho soundboard_pads
DROP TRIGGER IF EXISTS trg_soundboard_pads_updated_at ON soundboard_pads;
CREATE TRIGGER trg_soundboard_pads_updated_at
BEFORE UPDATE ON soundboard_pads
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 7. BẢNG: LỊCH SỬ KỊCH BẢN SỰ KIỆN (EVENT_SCENARIOS)
-- Hỗ trợ lưu trữ nhiều kịch bản khác nhau (Tiệc cưới, Gala Dinner, Hội nghị...)
-- =============================================================================
CREATE TABLE IF NOT EXISTS event_scenarios (
    scenario_id VARCHAR(100) PRIMARY KEY DEFAULT ('scenario_' || uuid_generate_v4()),
    title VARCHAR(255) NOT NULL,                           -- Tên kịch bản (VD: Gala Cuối Năm 2026)
    event_date DATE DEFAULT CURRENT_DATE,                  -- Ngày diễn ra sự kiện
    description TEXT,                                      -- Mô tả chi tiết kịch bản
    tracks_json JSONB DEFAULT '[]'::jsonb,                 -- Danh sách các bài hát trong kịch bản này
    pads_json JSONB DEFAULT '{}'::jsonb,                   -- Cấu hình phím hiệu ứng riêng cho kịch bản này
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Trigger cập nhật thời gian sửa đổi cho event_scenarios
DROP TRIGGER IF EXISTS trg_event_scenarios_updated_at ON event_scenarios;
CREATE TRIGGER trg_event_scenarios_updated_at
BEFORE UPDATE ON event_scenarios
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 8. CHÈN DỮ LIỆU KHỞI TẠO MẪU (DEFAULT SEED DATA)
-- Đảm bảo ngay sau khi chạy SQL là có sẵn cấu hình chuẩn tương thích 100% với app.js
-- =============================================================================

-- Cài đặt mặc định (Âm lượng tổng 0.00 = 0%)
INSERT INTO app_settings (id, theme, size_mode, split_ratio, master_volume, quick_fx_mode)
VALUES ('default_config', 'dark', 'normal', 0.5000, 0.00, 'poly')
ON CONFLICT (id) DO UPDATE SET 
    master_volume = EXCLUDED.master_volume,
    theme = EXCLUDED.theme;

-- Khởi tạo đầy đủ 36 Ô Phím Hiệu Ứng Sân Khấu (0-9 & A-Z) tương thích 100% app.js
INSERT INTO soundboard_pads (pad_id, name, hotkey, category, color_group, sort_order)
VALUES
    ('1',  'Phím 0', '0', 'Số',       'group-applause', 1),
    ('2',  'Phím 1', '1', 'Số',       'group-award',    2),
    ('3',  'Phím 2', '2', 'Số',       'group-drama',    3),
    ('4',  'Phím 3', '3', 'Số',       'group-game',     4),
    ('5',  'Phím 4', '4', 'Số',       'group-hype',     5),
    ('6',  'Phím 5', '5', 'Số',       'group-fx',       6),
    ('7',  'Phím 6', '6', 'Số',       'group-event',    7),
    ('8',  'Phím 7', '7', 'Số',       'group-fun',      8),
    ('9',  'Phím 8', '8', 'Số',       'group-chill',    9),
    ('10', 'Phím 9', '9', 'Số',       'group-applause', 10),
    ('11', 'Phím A', 'A', 'Chữ cái',  'group-award',    11),
    ('12', 'Phím B', 'B', 'Chữ cái',  'group-drama',    12),
    ('13', 'Phím C', 'C', 'Chữ cái',  'group-game',     13),
    ('14', 'Phím D', 'D', 'Chữ cái',  'group-hype',     14),
    ('15', 'Phím E', 'E', 'Chữ cái',  'group-fx',       15),
    ('16', 'Phím F', 'F', 'Chữ cái',  'group-event',    16),
    ('17', 'Phím G', 'G', 'Chữ cái',  'group-fun',      17),
    ('18', 'Phím H', 'H', 'Chữ cái',  'group-chill',    18),
    ('19', 'Phím I', 'I', 'Chữ cái',  'group-applause', 19),
    ('20', 'Phím J', 'J', 'Chữ cái',  'group-award',    20),
    ('21', 'Phím K', 'K', 'Chữ cái',  'group-drama',    21),
    ('22', 'Phím L', 'L', 'Chữ cái',  'group-game',     22),
    ('23', 'Phím M', 'M', 'Chữ cái',  'group-hype',     23),
    ('24', 'Phím N', 'N', 'Chữ cái',  'group-fx',       24),
    ('25', 'Phím O', 'O', 'Chữ cái',  'group-event',    25),
    ('26', 'Phím P', 'P', 'Chữ cái',  'group-fun',      26),
    ('27', 'Phím Q', 'Q', 'Chữ cái',  'group-chill',    27),
    ('28', 'Phím R', 'R', 'Chữ cái',  'group-applause', 28),
    ('29', 'Phím S', 'S', 'Chữ cái',  'group-award',    29),
    ('30', 'Phím T', 'T', 'Chữ cái',  'group-drama',    30),
    ('31', 'Phím U', 'U', 'Chữ cái',  'group-game',     31),
    ('32', 'Phím V', 'V', 'Chữ cái',  'group-hype',     32),
    ('33', 'Phím W', 'W', 'Chữ cái',  'group-fx',       33),
    ('34', 'Phím X', 'X', 'Chữ cái',  'group-event',    34),
    ('35', 'Phím Y', 'Y', 'Chữ cái',  'group-fun',      35),
    ('36', 'Phím Z', 'Z', 'Chữ cái',  'group-chill',    36)
ON CONFLICT (pad_id) DO NOTHING;

-- =============================================================================
-- 9. CÁC CÂU LỆNH MẪU HỮU ÍCH ĐỂ TRA CỨU & QUẢN TRỊ
-- =============================================================================
-- Xem danh sách bài hát kịch bản:
-- SELECT id, title, file_name, duration, folder_id, order_index FROM playlist_tracks ORDER BY order_index ASC;

-- Xem danh sách thư mục:
-- SELECT id, name, sort_order FROM playlist_folders ORDER BY sort_order ASC;

-- Xem danh sách 36 ô phím hiệu ứng:
-- SELECT pad_id, name, hotkey, category, color_group, volume, is_loop FROM soundboard_pads ORDER BY sort_order ASC;

-- Xem cấu hình ứng dụng:
-- SELECT * FROM app_settings WHERE id = 'default_config';
