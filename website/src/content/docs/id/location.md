---
title: Lokasi & Topologi
description: Modelkan cabang, register, dan gudang dalam satu editor visual.
category: guides
order: 4
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 2 minor) · Re-audit at HEAD. The prior 2026-09-08 stamp below is preserved verbatim as original evidence, because its finding was CORRECT ON ITS DATE and its resolution is the news. · MAJOR: that stamp reads "status: DRIFT - UNREPAIRED ON PURPOSE (1 finding)" and "en/stores.md gained a 'Deploy history' section … This page does not have it." That is no longer true of the file it is attached to. The section EXISTS here as "## Riwayat deploy", and the page footer (dated 2026-10-01) already records "GAP DITUTUP" — so a reader met a stamp contradicting both its own body and its own footer. The stamp's own warning ("an unreviewed translation is worse than a visible gap because it reads as authoritative") is the reason this is worth correcting rather than leaving: the deliberate-gap label had become a false current-state claim. · The translation shipped with every button label verbatim from the app's Fluent bundle (topology-rev-browser-* in shared-ui/locales/multi-location.id.ftl:62-86, 24 entries), which is the guarantee the footer states; the prose-level copy still has not had a human review, and that caveat is kept. · MINOR 1: the stamp cited page parity as "17 en pages, 17 id pages"; the docs content collection holds 20 of each today. · MINOR 2: its terminology measurement ("across all 17 en pages there are 7 capitalized uses of 'Store' against 2 of 'Location'") is a dated reading of a set that has since changed — re-measured 2026-10-11 at 4 'Store' against 5 'Location' in prose (front matter and comments excluded). Both are shown as readings-of-their-day, not corrected in place. · VERIFIED AND LEFT ALONE at HEAD: the page's Deploy-history copy matches the en page section for section; all section headings correspond; the Fluent labels it names are real. · Prior evidence retained verbatim below: status: DRIFT - UNREPAIRED ON PURPOSE (1 finding) · Indonesian counterpart of en/stores.md. Page parity is intact (17 en pages, 17 id pages, no gaps either way), and terminology is not the problem one would guess: across all 17 en pages there are 7 capitalized uses of “Store” against 2 of “Location”, so the store→location rename did NOT sweep the customer docs - which is a product question, not a doc-vs-code defect to repair unasked. · The real drift: en/stores.md gained a “Deploy history” section on 08-09-26 documenting a shipped, customer-visible capability (ADR #46 revision browser). This page does not have it. · NOT machine-translated. Authoring customer-facing Indonesian product copy from an English draft is a copywriting decision with brand implications, and an unreviewed translation is worse than a visible gap because it reads as authoritative. Needs a translator or a product decision; recorded here so the gap is deliberate rather than accidental. -->

## Editor topologi

Lokasi, register, gudang, dan perangkat keras disusun dalam diagram visual —
**Builder Topologi Visual Lokasi & Workspace**. Node diseret dari palet (atau
ditambah dengan tombol angka) dan dihubungkan dengan kabel di kanvas yang
mendukung zoom, pan, minimap, tata letak otomatis, snap ke grid, serta
undo/redo. Preset siap pakai **Ritel** dan **Resto & KDS** membuat kerangka
lokasi lengkap dalam satu klik, dan **Uji Simulasi Pesanan** mengirim tiket uji
melalui tata letak sehingga Anda dapat melihat alurnya sebelum diluncurkan.

## Node dan koneksi

Setiap node adalah bagian nyata dari bisnis Anda: **Lokasi** (profil cabang),
**POS Ritel**, **POS Restoran**, **Layar Dapur (KDS)**, **Gudang**, **Node
Gudang Stok**, dan **Perangkat Keras** (printer dan periferal). Kartu
menampilkan port berjenis — **Lokasi**, **Operasi**, **Stok Masuk/Keluar**,
**Tiket**, dan **Perangkat** — dan saat menghubungkan dua port, editor
menanyakan makna kabel tersebut: pengalihan stok, transfer inventaris,
perutean tiket, koneksi perangkat, atau operasi. Arah kabel berpindah
satu-arah → terbalik → dua-arah, sehingga diagram menunjukkan dengan tepat ke
mana stok, tiket, dan operasi mengalir.

## Validasi

Editor memvalidasi tata letak saat Anda mengerjakan. Panel masalah menandai
kendala secara langsung: tepat satu node cabang per grafik, setiap workspace
terhubung ke cabangnya melalui **Lokasi Masuk**, setiap KDS diumpankan oleh
POS Restoran melalui **Operasi Masuk**, tanpa siklus terarah, dan tanpa node
atau kabel ganda. Peringatan gudang muncul saat penyimpanan penuh atau tidak
ada stok yang dialirkan ke dalamnya.

## Menerapkan perubahan

Menerapkan topologi hanya bisa dilakukan manajer atau pemilik — pengguna lain
melihat kanvas hanya-baca. Terapkan menampilkan ringkasan selisih dari apa
yang akan berubah (dibuat, diperbarui, diarsipkan, berganti tipe, beserta
nomor revisi) sebelum disimpan. Jika topologi berubah di register lain
sementara itu, editor memuat versi terbaru dan meminta Anda menerapkan ulang.

## Riwayat deploy

Setiap perubahan tata letak cabang yang diterapkan dicatat, terbaru di
atas, lengkap dengan siapa yang menerapkannya, kapan, dan catatan yang mereka
tinggalkan. Buka **Riwayat deploy** dari layar topologi untuk menelusurinya;
cabang yang belum pernah diterapkan menyatakan demikian dan tidak
menampilkan apa pun.

Memilih sebuah entri dapat **mempreviewnya**: tata letak lama digambar di
atas kanvas Anda sebagai lapisan hantu lewat **Tampilkan di kanvas** —
tata letak yang sama dengan yang dipakai **Bandingkan Cabang** — sehingga
penambahan, penghapusan, dan perubahan terlihat berdampingan tanpa menyentuh
pekerjaan Anda. Setiap baris memberi tahu berapa banyak perubahan telah
mendarat sejak deploy itu, atau bahwa ia cocok dengan yang sedang berjalan.

**Pratinjau bukan pemulihan.** **Pulihkan ke editor** memuat tata letak
itu sebagai *draf yang belum disimpan*, terlebih dahulu disela bila Anda
punya perubahan yang belum disimpan yang bisa hilang; apa pun menjadi hidup
hanya setelah Anda menerapkannya sendiri, dengan izin manajer-atau-pemilik
dan ringkasan selisih seperti biasa. Menerapkan draf hasil pemulihan
mencatatnya sebagai deploy **baru** — riwayat tidak pernah ditulis ulang,
sehingga rollback itu sendiri dapat diaudit.

**Sematkan deploy ini** menjaga sebuah entri dari pemangkasan retensi.
Entri yang dipangkas tetap terdaftar dengan siapa/kapan/mengapa utuh,
ditandai bahwa snapshotnya hilang, dan hanya pratinjau serta pemulihan yang
ditarik — sehingga "deploy apa yang kami terbitkan hari Selasa" tetap
dapat dijawab setelah tata letaknya sendiri dibuang.

## Cabang, template, dan berbagi

Topologi hidup per cabang. Tampilan **Bandingkan Cabang** menunjukkan apa yang
berbeda antara dua cabang dan dapat memusatkan perhatian pada perbedaannya.
Template menyimpan tata letak untuk dipakai ulang, dan topologi dapat
**diekspor** ke papan klip serta **diimpor** di tempat lain — berguna untuk
menerapkan tata letak yang sama ke setiap cabang.

## Batas paket

Jumlah lokasi, register, dan gudang ditentukan oleh paket Anda. Editor menandai
apa pun yang melebihi batas sebelum Anda menerapkannya, dan beberapa gudang
atau batas kapasitas gudang memerlukan lisensi Premium.

## Jaga perangkat tetap sinkron

Perangkat menarik topologi saat terhubung kembali, sehingga register baru
muncul di setiap layar tanpa pengaturan manual.

> 2026-09-30 · Seruan penamaan ulang **Toko → Lokasi**; halaman berganti
> nama stores.md → location.md. · 2026-10-01 · GAP DITUTUP: bagian "Deploy
> history" kini ada — diterjemahkan dengan setiap label tombol verbatim dari
> bundle id aplikasi (topology-rev-browser-* multi-location.id.ftl:61-86).
> Catatan "NOT machine-translated" tetap berlaku: terjemahan prosa belum
> ditinjau manusia; hanya label yang dijamin asli dari Fluent.
> last audited 11-10-26 by docs-auditor