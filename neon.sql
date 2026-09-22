-- =============================================================================
-- TRÌNH PHÁT NHẠC SỰ KIỆN NIX BÙI - NEON SERVERLESS POSTGRESQL SCHEMA
-- File: neon.sql
-- Mục đích: Khởi tạo cơ sở dữ liệu trên Neon.tech để lưu trữ và đồng bộ dữ liệu:
--          - Danh sách bài hát kịch bản sự kiện (Playlist Tracks)
--          - Cấu hình & âm thanh bàn phím hiệu ứng tức thì (Soundboard Pads)
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
-- Lưu trữ: Chủ đề sáng/tối, kích cỡ, âm lượng tổng, chế độ phát, tỷ lệ chia màn hình
-- =============================================================================
CREATE TABLE IF NOT EXISTS app_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default_config',
    theme VARCHAR(20) NOT NULL DEFAULT 'dark',              -- 'dark' (Tối) hoặc 'light' (Sáng)
    size_mode VARCHAR(20) NOT NULL DEFAULT 'normal',        -- 'normal' (Chuẩn) hoặc 'compact' (Thu nhỏ)
    split_ratio NUMERIC(5, 4) DEFAULT 0.5000,              -- Tỷ lệ chia thanh kéo giữa (mặc định 50%)
    master_volume NUMERIC(3, 2) DEFAULT 0.90,              -- Âm lượng tổng (0.00 đến 1.20)
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
-- 4. BẢNG: DANH SÁCH BÀI HÁT KỊCH BẢN (PLAYLIST_TRACKS)
-- Lưu trữ: Toàn bộ danh sách bài hát kịch bản sự kiện, độ dài, thứ tự phát, file âm thanh
-- =============================================================================
CREATE TABLE IF NOT EXISTS playlist_tracks (
    id VARCHAR(100) PRIMARY KEY,                           -- Mã định danh track (ví dụ: track_1710000000000)
    title VARCHAR(255) NOT NULL,                           -- Tên bài hát hiển thị
    file_name VARCHAR(255) NOT NULL,                       -- Tên file gốc (ví dụ: chao_mung.mp3)
    duration VARCHAR(20) DEFAULT '00:00',                  -- Thời lượng hiển thị (ví dụ: 03:45)
    duration_seconds NUMERIC(8, 2) DEFAULT 0.00,           -- Thời lượng quy đổi ra giây
    order_index INTEGER DEFAULT 0,                         -- Thứ tự sắp xếp trong kịch bản
    audio_url TEXT,                                        -- Đường link CDN / Cloud Storage (nếu có)
    audio_base64 TEXT,                                     -- Chuỗi Base64 dữ liệu âm thanh (lưu trực tiếp)
    file_size_bytes BIGINT DEFAULT 0,                      -- Dung lượng file âm thanh (bytes)
    mime_type VARCHAR(64) DEFAULT 'audio/mpeg',            -- Loại định dạng âm thanh
    date_added BIGINT DEFAULT (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_playlist_order ON playlist_tracks(order_index ASC);
CREATE INDEX IF NOT EXISTS idx_playlist_date_added ON playlist_tracks(date_added DESC);

-- Trigger cập nhật thời gian sửa đổi cho playlist_tracks
DROP TRIGGER IF EXISTS trg_playlist_tracks_updated_at ON playlist_tracks;
CREATE TRIGGER trg_playlist_tracks_updated_at
BEFORE UPDATE ON playlist_tracks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 5. BẢNG: BÀN PHÍM HIỆU ỨNG TỨC THÌ (SOUNDBOARD_PADS)
-- Lưu trữ: Cấu hình 16+ ô phím hiệu ứng âm thanh nhanh sân khấu
-- =============================================================================
CREATE TABLE IF NOT EXISTS soundboard_pads (
    pad_id VARCHAR(50) PRIMARY KEY,                        -- Mã định danh ô (ví dụ: pad_1, pad_2...)
    name VARCHAR(150) NOT NULL,                            -- Tên hiển thị trên ô phím
    hotkey VARCHAR(10),                                    -- Phím tắt nhanh bàn phím (1, 2, Q, W, A, Z...)
    category VARCHAR(80) DEFAULT 'Sự kiện',                -- Danh mục nhóm (Khai mạc, Trao giải, Hài hước...)
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
-- 6. BẢNG: LỊCH SỬ KỊCH BẢN SỰ KIỆN (EVENT_SCENARIOS)
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
-- 7. CHÈN DỮ LIỆU KHỞI TẠO MẪU (DEFAULT SEED DATA)
-- Đảm bảo ngay sau khi tạo bảng là có sẵn cấu hình chuẩn để sử dụng
-- =============================================================================

-- Cài đặt mặc định
INSERT INTO app_settings (id, theme, size_mode, split_ratio, master_volume, quick_fx_mode)
VALUES ('default_config', 'dark', 'normal', 0.5000, 0.90, 'poly')
ON CONFLICT (id) DO NOTHING;

-- Khởi tạo 16 Ô Phím Hiệu Ứng Sân Khấu Tiêu Chuẩn (Tương thích 100% với giao diện app.js)
INSERT INTO soundboard_pads (pad_id, name, hotkey, category, color_group, sort_order)
VALUES
    ('pad_1',  'Phím 1', '1', 'Sự kiện',   'group-award',    1),
    ('pad_2',  'Phím 2', '2', 'Sự kiện',   'group-award',    2),
    ('pad_3',  'Phím 3', '3', 'Khai mạc',  'group-intro',    3),
    ('pad_4',  'Phím 4', '4', 'Khai mạc',  'group-intro',    4),
    ('pad_5',  'Phím Q', 'Q', 'Hồi hộp',   'group-suspense', 5),
    ('pad_6',  'Phím W', 'W', 'Hồi hộp',   'group-suspense', 6),
    ('pad_7',  'Phím E', 'E', 'Cao trào',  'group-climax',   7),
    ('pad_8',  'Phím R', 'R', 'Cao trào',  'group-climax',   8),
    ('pad_9',  'Phím A', 'A', 'Hiệu ứng',  'group-fx',       9),
    ('pad_10', 'Phím S', 'S', 'Hiệu ứng',  'group-fx',       10),
    ('pad_11', 'Phím D', 'D', 'Vui nhộn',  'group-funny',    11),
    ('pad_12', 'Phím F', 'F', 'Vui nhộn',  'group-funny',    12),
    ('pad_13', 'Phím Z', 'Z', 'Kết thúc',  'group-outro',    13),
    ('pad_14', 'Phím X', 'X', 'Kết thúc',  'group-outro',    14),
    ('pad_15', 'Phím C', 'C', 'Đặc biệt',  'group-special',  15),
    ('pad_16', 'Phím V', 'V', 'Đặc biệt',  'group-special',  16)
ON CONFLICT (pad_id) DO NOTHING;

-- =============================================================================
-- 8. CÁC CÂU LỆNH MẪU HỮU ÍCH ĐỂ TRA CỨU & ĐỒNG BỘ
-- =============================================================================
-- Xem danh sách bài hát kịch bản:
-- SELECT id, title, file_name, duration, order_index FROM playlist_tracks ORDER BY order_index ASC;

-- Xem danh sách các ô phím hiệu ứng:
-- SELECT pad_id, name, hotkey, category, color_group, volume, is_loop FROM soundboard_pads ORDER BY sort_order ASC;

-- Xem cấu hình ứng dụng:
-- SELECT * FROM app_settings WHERE id = 'default_config';
