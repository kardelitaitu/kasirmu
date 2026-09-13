# Tinjauan konflik sinkronisasi
#
# Terjemahan bahasa Indonesia untuk SyncConflictReviewScreen dan
# ConflictDiffViewer. Kunci-kunci di sini harus sama dengan `sync.ftl`;
# pemeriksaan i18n (langkah 3 pre-commit) gagal bila berkas bahasa merupakan
# salinan identik dari sumber bahasa Inggrisnya.

sync-conflicts-title = Konflik Sinkronisasi
sync-conflicts-show-resolved = Tampilkan riwayat yang sudah diselesaikan
sync-conflicts-loading = Memuat…
sync-conflicts-empty = Tidak ada konflik untuk ditinjau.

# Tab filter tingkat keparahan. Kosakatanya mengikuti constraint CHECK
# `severity` pada tabel `sync_conflicts`; mengubah salah satunya di sini tanpa
# mengubah nilai kolomnya akan menghasilkan tab yang selalu kosong.
sync-conflicts-severity-high = Tinggi
sync-conflicts-severity-medium = Sedang
sync-conflicts-severity-low = Rendah
sync-conflicts-severity-all = Semua

# Penampil diff. Kedua panel diberi label berdasarkan asalnya, bukan
# "kiri/kanan", agar tata letak yang dibalik tetap menyebut sisi yang benar.
sync-conflicts-pane-local = Terminal { $terminal }
sync-conflicts-pane-remote = Cloud / Terminal B
sync-conflicts-accept-local = Terima Toko A
sync-conflicts-accept-remote = Terima Cloud
sync-conflicts-custom-merge = Gabungkan Manual
