/**
 * Trình Quản Lý Cơ Sở Dữ Liệu m Thanh (IndexedDB Audio Storage)
 * Cho phép lưu trữ vĩnh viễn toàn bộ file nhạc kịch bản và âm thanh soundboard
 * Sử dụng mượt mà khi ngoại tuyến (offline) và không bao giờ bị mất khi F5 / tải lại trang.
 */

class EventAudioDB {
    constructor() {
        this.dbName = 'EventAudioProDB';
        this.version = 1;
        this.db = null;
        this.isReady = false;
        this._initPromise = null;
    }

    // Khởi tạo và mở cơ sở dữ liệu IndexedDB
    init() {
        if (this._initPromise) return this._initPromise;

        this._initPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                console.warn('Trình duyệt không hỗ trợ IndexedDB. Dữ liệu sẽ chỉ lưu tạm.');
                resolve(null);
                return;
            }

            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                // Bảng lưu danh sách bài hát kịch bản
                if (!db.objectStoreNames.contains('playlist_tracks')) {
                    const playlistStore = db.createObjectStore('playlist_tracks', { keyPath: 'id' });
                    playlistStore.createIndex('dateAdded', 'dateAdded', { unique: false });
                }
                // Bảng lưu file âm thanh cho từng ô phím hiệu ứng (Soundboard)
                if (!db.objectStoreNames.contains('pad_audios')) {
                    db.createObjectStore('pad_audios', { keyPath: 'padId' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.isReady = true;
                this.requestPersistentStorage();
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('Lỗi khởi tạo IndexedDB:', event.target.error);
                resolve(null);
            };
        });

        return this._initPromise;
    }

    // Yêu cầu trình duyệt cấp quyền lưu trữ vĩnh viễn (không tự động xóa khi dọn dẹp ổ đĩa)
    async requestPersistentStorage() {
        if (navigator.storage && navigator.storage.persist) {
            try {
                const isPersisted = await navigator.storage.persist();
                console.log('Bộ nhớ lưu trữ âm thanh vĩnh viễn (Persistent Storage):', isPersisted ? 'ĐÃ CẤP QUYỀN' : 'MẶC ĐỊNH');
            } catch (e) {
                console.warn('Không thể yêu cầu quyền lưu trữ vĩnh viễn:', e);
            }
        }
    }

    // --- QUẢN LÝ DANH SÁCH BÀI HÁT KỊCH BẢN (PLAYLIST TRACKS) ---

    // Lưu 1 bài hát (bao gồm cả file nhị phân Blob/File)
    async saveTrack(track) {
        await this.init();
        if (!this.db) return false;

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('playlist_tracks', 'readwrite');
                const store = tx.objectStore('playlist_tracks');
                const blobData = track.file instanceof Blob ? track.file : (track.blob instanceof Blob ? track.blob : null);
                const dataToSave = {
                    id: track.id,
                    title: track.title,
                    fileName: track.fileName || (track.file ? track.file.name : 'track.mp3'),
                    duration: track.duration || '00:00',
                    blob: blobData,
                    dateAdded: track.dateAdded || Date.now(),
                    folderId: track.folderId || null
                };
                const req = store.put(dataToSave);
                req.onsuccess = () => resolve(true);
                req.onerror = (err) => {
                    console.warn('Lỗi lưu track vào IndexedDB:', err);
                    resolve(false);
                };
            } catch (e) {
                console.warn('Lỗi transaction saveTrack:', e);
                resolve(false);
            }
        });
    }

    // Lưu hàng loạt bài hát cùng lúc (làm sạch và ghi lại trong cùng 1 transaction nguyên tử)
    async saveAllTracks(tracks) {
        await this.init();
        if (!this.db) return false;

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('playlist_tracks', 'readwrite');
                const store = tx.objectStore('playlist_tracks');
                store.clear();
                tracks.forEach(track => {
                    const blobData = track.file instanceof Blob ? track.file : (track.blob instanceof Blob ? track.blob : null);
                    store.put({
                        id: track.id,
                        title: track.title,
                        fileName: track.fileName || (track.file ? track.file.name : 'track.mp3'),
                        duration: track.duration || '00:00',
                        blob: blobData,
                        dateAdded: track.dateAdded || Date.now(),
                        folderId: track.folderId || null
                    });
                });
                tx.oncomplete = () => resolve(true);
                tx.onerror = (err) => {
                    console.warn('Lỗi transaction saveAllTracks:', err);
                    resolve(false);
                };
            } catch (e) {
                console.warn('Lỗi saveAllTracks:', e);
                resolve(false);
            }
        });
    }

    // Lấy toàn bộ danh sách bài hát đã lưu
    async getAllTracks() {
        await this.init();
        if (!this.db) return [];

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('playlist_tracks', 'readonly');
                const store = tx.objectStore('playlist_tracks');
                const req = store.getAll();
                req.onsuccess = () => {
                    const rawList = req.result || [];
                    // Chuyển đổi Blob thành đối tượng File tương thích hoàn toàn
                    const tracks = rawList.map(item => {
                        let fileObj = null;
                        if (item.blob) {
                            try {
                                fileObj = new File([item.blob], item.fileName, {
                                    type: item.blob.type || 'audio/mpeg',
                                    lastModified: item.dateAdded || Date.now()
                                });
                            } catch (e) {
                                fileObj = item.blob;
                            }
                        }
                        return {
                            id: item.id,
                            title: item.title,
                            fileName: item.fileName,
                            duration: item.duration,
                            file: fileObj,
                            dateAdded: item.dateAdded,
                            folderId: item.folderId || null
                        };
                    });
                    resolve(tracks);
                };
                req.onerror = () => resolve([]);
            } catch (e) {
                resolve([]);
            }
        });
    }

    // Xóa một bài hát theo ID
    async deleteTrack(trackId) {
        await this.init();
        if (!this.db) return false;

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('playlist_tracks', 'readwrite');
                const store = tx.objectStore('playlist_tracks');
                const req = store.delete(trackId);
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
            } catch (e) {
                resolve(false);
            }
        });
    }

    // Xóa toàn bộ danh sách bài hát kịch bản
    async clearAllTracks() {
        await this.init();
        if (!this.db) return false;

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('playlist_tracks', 'readwrite');
                const store = tx.objectStore('playlist_tracks');
                const req = store.clear();
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
            } catch (e) {
                resolve(false);
            }
        });
    }

    // --- QUẢN LÝ FILE ÂM THANH Ô PHÍM SOUNDBOARD (PAD AUDIOS) ---

    // Lưu file âm thanh cho một ô phím
    async savePadAudio(padId, fileOrBlob, meta = {}) {
        await this.init();
        if (!this.db || !fileOrBlob) return false;

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('pad_audios', 'readwrite');
                const store = tx.objectStore('pad_audios');
                const blobData = fileOrBlob instanceof Blob ? fileOrBlob : null;
                const req = store.put({
                    padId: String(padId),
                    fileName: meta.fileName || fileOrBlob.name || 'pad-sound.mp3',
                    title: meta.title || meta.name || '',
                    duration: meta.duration || '--',
                    blob: blobData,
                    savedAt: Date.now()
                });
                req.onsuccess = () => resolve(true);
                req.onerror = (err) => {
                    console.warn('Lỗi savePadAudio:', err);
                    resolve(false);
                };
            } catch (e) {
                console.warn('Lỗi transaction savePadAudio:', e);
                resolve(false);
            }
        });
    }

    // Lấy toàn bộ file âm thanh của tất cả các phím
    async getAllPadAudios() {
        await this.init();
        if (!this.db) return [];

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('pad_audios', 'readonly');
                const store = tx.objectStore('pad_audios');
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch (e) {
                resolve([]);
            }
        });
    }

    // Xóa file âm thanh của một ô phím
    async deletePadAudio(padId) {
        await this.init();
        if (!this.db) return false;

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('pad_audios', 'readwrite');
                const store = tx.objectStore('pad_audios');
                const req = store.delete(String(padId));
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
            } catch (e) {
                resolve(false);
            }
        });
    }

    // Xóa tất cả file âm thanh của bàn phím
    async clearAllPadAudios() {
        await this.init();
        if (!this.db) return false;

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('pad_audios', 'readwrite');
                const store = tx.objectStore('pad_audios');
                const req = store.clear();
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
            } catch (e) {
                resolve(false);
            }
        });
    }
}

// Khởi tạo instance toàn cục
window.audioDB = new EventAudioDB();

/**
 * Trình đồng bộ với Node.js Backend Server & Neon PostgreSQL (ServerSyncClient)
 * Tự động đồng bộ bài hát, thư mục và phím hiệu ứng với máy chủ Node.js khi online
 */
class ServerSyncClient {
    constructor() {
        this.baseUrl = window.location.origin;
        this.isServerAvailable = false;
        this.checkServer();
    }

    async checkServer() {
        try {
            const res = await fetch(`${this.baseUrl}/api/status`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                const data = await res.json();
                this.isServerAvailable = true;
                console.log(`📡 [Node.js Server] Đã kết nối máy chủ (${data.database})`);
                return data;
            }
        } catch (e) {
            this.isServerAvailable = false;
        }
        return null;
    }

    async getFolders() {
        if (!this.isServerAvailable) return null;
        try {
            const res = await fetch(`${this.baseUrl}/api/folders`);
            if (res.ok) {
                const data = await res.json();
                return data.folders || [];
            }
        } catch (e) {}
        return null;
    }

    async saveFolder(folder) {
        if (!this.isServerAvailable) return;
        try {
            await fetch(`${this.baseUrl}/api/folders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(folder)
            });
        } catch (e) {}
    }

    async renameFolder(id, name) {
        if (!this.isServerAvailable) return;
        try {
            await fetch(`${this.baseUrl}/api/folders/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
        } catch (e) {}
    }

    async deleteFolder(id) {
        if (!this.isServerAvailable) return;
        try {
            await fetch(`${this.baseUrl}/api/folders/${id}`, { method: 'DELETE' });
        } catch (e) {}
    }

    async syncAll(payload) {
        if (!this.isServerAvailable) return;
        try {
            await fetch(`${this.baseUrl}/api/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {}
    }
}

window.serverSync = new ServerSyncClient();

