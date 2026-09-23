---
title: Tingkat Akses Baca API
description: Kontrol akses GET melalui izin JWT terbatas — mint, preset, panggil.
category: reference
order: 8
updated: "2026-09-01"
---

## Ikhtisar

Setiap JWT dapat membawa klaim `permissions` — daftar kunci
[registri izin](/id/docs/user-roles/) yang membatasi akses GET.
Token tanpa klaim ini tetap memiliki akses **baca penuh** (kompatibel
mundur — integrasi yang ada tetap berfungsi seperti sebelumnya).

Pintu baca berjalan di server cloud REST API (spesifikasi 0047).
Semua rute GET yang dilindungi (produk, kategori, kurs, rencana,
penjualan, gambar) mengembalikan `403 insufficient_scope` jika daftar
izin token tidak memiliki kunci yang diperlukan.

## Preset

Preset adalah daftar kunci bernama yang dapat ditentukan saat
pembuatan token, bukan mendaftarkan kunci satu per satu.

| Preset | Izin | Untuk |
|---|---|---|
| `terminal` *(otomatis)* | `products:read`, `categories:read`, `reference:read`, `plan:read` | Terminal POS via kredensial klien |
| `dashboard` | `products:read`, `reports:view`, `analytics:view` | Dasbor pihak ketiga (bebas PII) |
| `audit` | `audit:view`, `reports:view` | Akuntan dan auditor |

> **Perlindungan PII (keputusan 3):** rute yang ditandai `pii: true`
> (saat ini hanya `GET /api/v1/sales/{id}`) dikecualikan dari preset
> `dashboard`. Menambahkan rute baru yang mengandung PII memerlukan
> pengaturan flag `pii` di `READ_KEY_MAP` — tes invarian PII
> (`dashboard ∩ rute-pii = ∅`) akan gagal hingga preset dashboard
> diperbarui.

## Membuat token terbatas

### Kredensial klien terminal (otomatis)

Terminal POS menggunakan `client_id` + `client_secret` (terdaftar
melalui halaman Terminal). Server secara otomatis mengikat preset
`terminal`:

```bash
curl -X POST https://server-anda/api/v1/tokens \
  -H "Content-Type: application/json" \
  -d '{"label":"register-depan","client_id":"term-1","client_secret":"s3cret"}'
```

**Pintu darurat:** `OZ_TERMINAL_READ_TIER=full` di server mengembalikan
akses baca penuh untuk token terminal. Ini **tidak digunakan lagi** dan
akan dihapus setelah satu siklus rilis.

### Kunci admin (berdasarkan preset)

```bash
curl -X POST https://server-anda/api/v1/tokens \
  -H "X-Admin-Key: kunci-admin-anda" \
  -H "Content-Type: application/json" \
  -d '{"label":"dasbor-pihak-ketiga","read_preset":"dashboard"}'
```

### Kunci admin (daftar izin kustom)

```bash
curl -X POST https://server-anda/api/v1/tokens \
  -H "X-Admin-Key: kunci-admin-anda" \
  -H "Content-Type: application/json" \
  -d '{"label":"tampilan-terbatas","read_permissions":["products:read","sales:view"]}'
```

Nama preset yang tidak dikenal atau kunci izin yang tidak terdaftar
mengembalikan `422 UNPROCESSABLE_ENTITY` dengan:
- `"error": "unknown_preset"`
- `"error": "unknown_permission"`

## Memanggil dengan token terbatas

Sertakan JWT di header `Authorization` standar:

```bash
curl https://server-anda/api/v1/products \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

Jika token tidak memiliki izin yang diperlukan, server mengembalikan
`403 Forbidden` dengan:

```json
{"error": "insufficient_scope"}
```

Token lama (tanpa klaim `permissions`) melewati semua rute seperti
sebelumnya.

## Peta kunci baca

Setiap rute GET yang dilindungi dipetakan ke kunci registri:

| Rute | Kunci | PII |
|---|---|---|
| GET /api/v1/products | `products:read` | tidak |
| GET /api/v1/products/{sku} | `products:read` | tidak |
| GET /api/v1/categories | `categories:read` | tidak |
| GET /api/v1/exchange-rates | `reference:read` | tidak |
| GET /api/v1/exchange-rates/latest | `reference:read` | tidak |
| GET /api/v1/exchange-rates/latest/{from}/{to} | `reference:read` | tidak |
| GET /api/v1/tenants/me/plan | `plan:read` | tidak |
| GET /api/v1/sales/{id} | `sales:view` | **ya** |
| GET /api/v1/images:pack | `products:read` | tidak |
| GET /api/v1/images:missing | `products:read` | tidak |
| GET /api/v1/images/{hash16} | `products:read` | tidak |

Penjaga penyimpangan (`every_spec_get_operation_has_read_key_entry`
di `openapi_tests.rs`) memastikan peta ini tetap sinkron dengan
spesifikasi OpenAPI. Rute GET apa pun di spesifikasi dengan
`bearerAuth` harus memiliki entri di sini.

## Registri izin

Kumpulan lengkap kunci izin didefinisikan di
`platform/core/src/permission_registry.rs`. Kunci diatur berdasarkan
keluarga (`products`, `sales`, `staff`, dll.) dan masing-masing
memiliki klasifikasi (sensitif / tidak sensitif). Kunci baca yang
digunakan oleh tingkat akses:

- `products:read`
- `categories:read`
- `reference:read`
- `plan:read`
- `sales:view`
- `reports:view`
- `analytics:view`
- `audit:view`

Kembangkan sistem dengan menambahkan kunci di sini — jangan dengan
menciptakan taksonomi paralel. Lihat [panduan peran pengguna](/id/docs/user-roles/)
untuk registri lengkap.

## Pertanyaan?

Buka issue dengan tag `auth-read-tiers` atau tanyakan di Slack
`#api`.